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

export async function ensureBlobForUploadUrl({
  prisma,
  sourceUrl,
}: {
  prisma: any;
  sourceUrl: string;
}) {
  const existing = await prisma.mediaAsset.findFirst({
    where: { sourceUrl },
    select: { url: true },
  });
  if (existing?.url) return { url: existing.url, created: false };

  const rel = wpUploadRelativeFromUrl(sourceUrl);
  if (!rel) return null;

  const res = await fetch(sourceUrl);
  if (!res.ok) throw new Error(`GET ${sourceUrl} -> ${res.status}`);

  const contentType = res.headers.get("content-type") || undefined;
  const arrayBuffer = await res.arrayBuffer();
  const bytes = arrayBuffer.byteLength;

  const fileName = rel.split("/").pop() || "file";
  const key = `blog/${rel}`.replaceAll(/\/+/g, "/");

  const blob = await put(key, new Blob([arrayBuffer], { type: contentType }), {
    access: "public",
    contentType,
    addRandomSuffix: false,
  });

  await prisma.mediaAsset.create({
    data: {
      sourceUrl,
      filename: fileName,
      url: blob.url,
      mimeType: contentType ?? null,
      bytes,
    },
  });

  return { url: blob.url, created: true };
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
}: {
  html: string;
  wpBaseUrl: string;
  resolve: (sourceUrl: string) => Promise<string | null>;
}) {
  const seen = new Map();

  async function mapUrl(urlString) {
    const abs = normalizeCandidateUrl(urlString, wpBaseUrl).replace(/\?.*$/, "");
    if (!abs.includes("/wp-content/uploads/")) return null;
    if (seen.has(abs)) return seen.get(abs);
    const mapped = await resolve(abs);
    if (mapped) seen.set(abs, mapped);
    return mapped;
  }

  let out = html;

  // Rewrite src/href attributes.
  const attrRe = /\b(?:src|href)=["']([^"']+)["']/gi;
  const attrMatches = Array.from(out.matchAll(attrRe));
  for (const match of attrMatches) {
    const original = match[1];
    if (!original.includes("wp-content/uploads")) continue;
    const mapped = await mapUrl(original);
    if (!mapped) continue;
    out = out.replaceAll(original, mapped);
  }

  // Rewrite srcset lists.
  const srcsetRe = /\bsrcset=["']([^"']+)["']/gi;
  const srcsetMatches = Array.from(out.matchAll(srcsetRe));
  for (const match of srcsetMatches) {
    const original = match[1];
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

    if (changed) {
      out = out.replaceAll(original, rewrittenParts.join(", "));
    }
  }

  return { html: out, mapped: Array.from(seen.entries()).map(([sourceUrl, blobUrl]) => ({ sourceUrl, blobUrl })) };
}
