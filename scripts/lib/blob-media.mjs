import { put } from "@vercel/blob";

export function blobEnabled() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

export function wpUploadRelativeFromUrl(urlString) {
  const url = new URL(urlString);
  const marker = "/blog/wp-content/uploads/";
  const idx = url.pathname.indexOf(marker);
  if (idx === -1) return null;
  return url.pathname.slice("/blog/".length); // wp-content/uploads/...
}

export function canonicalizeWpUploadUrl(urlString) {
  const url = new URL(urlString);
  const pathname = url.pathname.toLowerCase();
  const isImage =
    pathname.endsWith(".jpg") ||
    pathname.endsWith(".jpeg") ||
    pathname.endsWith(".png") ||
    pathname.endsWith(".gif") ||
    pathname.endsWith(".webp") ||
    pathname.endsWith(".avif") ||
    pathname.endsWith(".svg");

  // Only de-variant images. For videos/other files, keep as-is (except strip query/hash).
  if (!isImage) {
    url.search = "";
    url.hash = "";
    return url.toString();
  }

  const parts = url.pathname.split("/");
  const file = parts.pop();
  if (!file) return urlString;

  // Strip WordPress generated size suffixes like `-300x200` and optional `-scaled`.
  // Examples:
  // - image-1024x768.jpg -> image.jpg
  // - image-1024x768-scaled.jpg -> image-scaled.jpg -> image.jpg
  let next = file.replace(/-\d+x\d+(?=\.[^.]+$)/, "");
  next = next.replace(/-scaled(?=\.[^.]+$)/, "");
  parts.push(next);

  url.pathname = parts.join("/");
  url.search = "";
  url.hash = "";
  return url.toString();
}

function isLikelyImageByExt(urlString) {
  return true;
}

export async function ensureBlobForUploadUrl({
  prisma,
  sourceUrl,
}) {
  const canonicalSourceUrl = canonicalizeWpUploadUrl(sourceUrl);
  const existingCanonical = await prisma.mediaAsset.findFirst({
    where: { sourceUrl: canonicalSourceUrl },
    select: { url: true },
  });
  if (existingCanonical?.url) {
    const urlObj = new URL(existingCanonical.url);
    const looksLikeVercelBlob = urlObj.hostname.endsWith(".public.blob.vercel-storage.com");
    if (looksLikeVercelBlob) return { url: existingCanonical.url, created: false, sourceUrl: canonicalSourceUrl };
    // If the stored URL isn't a Vercel Blob public URL, treat as missing so importer can repopulate.
  }

  const rel = wpUploadRelativeFromUrl(canonicalSourceUrl);
  if (!rel) return null;

  let res;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      res = await fetch(canonicalSourceUrl);
      break;
    } catch (err) {
      const waitMs = attempt === 1 ? 500 : attempt === 2 ? 1500 : 3000;
      console.warn(
        `Fetch failed (attempt ${attempt}/3), retrying in ${waitMs}ms: ${canonicalSourceUrl}`,
      );
      console.warn(err?.cause?.message ?? err?.message ?? err);
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }

  if (!res) {
    console.warn(`Skipping upload (fetch failed permanently): ${canonicalSourceUrl}`);
    return null;
  }

  if (!res.ok) {
    console.warn(`Skipping upload (fetch non-OK): GET ${canonicalSourceUrl} -> ${res.status}`);
    return null;
  }

  const contentType = res.headers.get("content-type") || undefined;
  const arrayBuffer = await res.arrayBuffer();
  const bytes = arrayBuffer.byteLength;

  const fileName = rel.split("/").pop() || "file";
  const key = `blog/${rel}`.replaceAll(/\/+/g, "/");

  let blob;
  try {
    blob = await put(key, new Blob([arrayBuffer], { type: contentType }), {
      access: "public",
      contentType,
      addRandomSuffix: false,
      allowOverwrite: true,
    });
  } catch (err) {
    console.warn(`Skipping upload (blob put failed): ${canonicalSourceUrl}`);
    console.warn(err?.message ?? err);
    return null;
  }

  await prisma.mediaAsset.create({
    data: {
      sourceUrl: canonicalSourceUrl,
      provider: "vercel-blob",
      key,
      filename: fileName,
      url: blob.url,
      mimeType: contentType ?? null,
      bytes,
    },
  });

  return { url: blob.url, created: true, sourceUrl: canonicalSourceUrl };
}

function normalizeCandidateUrl(candidate, wpBaseUrl) {
  if (candidate.startsWith("//")) return `https:${candidate}`;
  if (candidate.startsWith("/blog/")) {
    const origin = new URL(wpBaseUrl).origin;
    return `${origin}${candidate}`;
  }
  if (candidate.startsWith("/")) {
    // Some markup could be /blog/wp-content/uploads/...
    return `${wpBaseUrl}${candidate}`;
  }
  return candidate;
}

export async function rewriteUploadsInHtml({
  html,
  wpBaseUrl,
  resolve,
}) {
  const seen = new Map();

  async function replaceAllAsync(input, regex, replacer) {
    let out = "";
    let lastIndex = 0;
    for (const match of input.matchAll(regex)) {
      const index = match.index ?? 0;
      out += input.slice(lastIndex, index);
      out += await replacer(match);
      lastIndex = index + match[0].length;
    }
    out += input.slice(lastIndex);
    return out;
  }

  async function mapUrl(urlString) {
    const abs = normalizeCandidateUrl(urlString, wpBaseUrl).replace(/\?.*$/, "");
    if (!abs.includes("/wp-content/uploads/")) return null;
    const canonical = canonicalizeWpUploadUrl(abs);
    if (seen.has(canonical)) return seen.get(canonical);
    const mapped = await resolve(canonical);
    // Cache both success and failure to avoid repeated work within the same document.
    seen.set(canonical, mapped);
    return mapped;
  }

  let out = html;

  // Rewrite src/href attributes (only the attribute value, not global substrings).
  const attrRe = /\b(src|href)=(["'])([^"']+)\2/gi;
  out = await replaceAllAsync(out, attrRe, async (match) => {
    const attrName = match[1];
    const quote = match[2];
    const original = match[3];
    if (!original.includes("wp-content/uploads")) return match[0];
    const mapped = await mapUrl(original);
    if (!mapped) return match[0];
    return `${attrName}=${quote}${mapped}${quote}`;
  });

  // Rewrite srcset lists.
  const srcsetRe = /\bsrcset=(["'])([^"']+)\1/gi;
  out = await replaceAllAsync(out, srcsetRe, async (match) => {
    const quote = match[1];
    const original = match[2];
    const parts = original
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);

    const rewrittenParts = [];
    let changed = false;

    for (const part of parts) {
      const [url, ...rest] = part.split(/\s+/);
      if (!url) continue;
      if (!url.includes("wp-content/uploads")) {
        rewrittenParts.push(part);
        continue;
      }
      const mapped = await mapUrl(url);
      if (!mapped) {
        rewrittenParts.push(part);
        continue;
      }
      changed = true;
      rewrittenParts.push([mapped, ...rest].join(" "));
    }

    if (!changed) return match[0];
    return `srcset=${quote}${rewrittenParts.join(", ")}${quote}`;
  });

  return {
    html: out,
    mapped: Array.from(seen.entries())
      .filter(([, blobUrl]) => Boolean(blobUrl))
      .map(([sourceUrl, blobUrl]) => ({ sourceUrl, blobUrl })),
  };
}
