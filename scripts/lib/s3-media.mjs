import { S3Client, HeadObjectCommand } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { Readable } from "node:stream";
import crypto from "node:crypto";

export function canonicalizeWpUploadUrl(urlString) {
  const url = new URL(urlString);
  const pathname = url.pathname;
  const lower = pathname.toLowerCase();
  const isImage =
    lower.endsWith(".jpg") ||
    lower.endsWith(".jpeg") ||
    lower.endsWith(".png") ||
    lower.endsWith(".gif") ||
    lower.endsWith(".webp") ||
    lower.endsWith(".avif") ||
    lower.endsWith(".svg");

  if (!isImage) {
    url.search = "";
    url.hash = "";
    return url.toString();
  }

  const parts = url.pathname.split("/");
  const file = parts.pop();
  if (!file) return urlString;

  let next = file.replace(/-\d+x\d+(?=\.[^.]+$)/, "");
  next = next.replace(/-scaled(?=\.[^.]+$)/, "");
  parts.push(next);

  url.pathname = parts.join("/");
  url.search = "";
  url.hash = "";
  return url.toString();
}

export function createS3ClientFromEnv() {
  const region = process.env.AWS_REGION;
  if (!region) throw new Error("AWS_REGION is required for S3 uploads.");
  return new S3Client({ region });
}

export function getS3BucketFromEnv() {
  const bucket = process.env.S3_BUCKET;
  if (!bucket) throw new Error("S3_BUCKET is required for S3 uploads.");
  return bucket;
}

export function getPublicBaseUrlFromEnv() {
  const base = String(process.env.MEDIA_PUBLIC_BASE_URL || "").trim();
  if (!base) return null;
  return base.replace(/\/+$/, "");
}

function normalizeCandidateUrl(candidate, wpBaseUrl) {
  if (candidate.startsWith("//")) return `https:${candidate}`;
  if (candidate.startsWith("/blog/")) {
    const origin = new URL(wpBaseUrl).origin;
    return `${origin}${candidate}`;
  }
  if (candidate.startsWith("/")) return `${wpBaseUrl}${candidate}`;
  return candidate;
}

export async function rewriteWpUploadsInHtml({
  html,
  wpBaseUrl,
  resolve,
}) {
  const seen = new Map(); // canonical source url -> public url or null

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
    seen.set(canonical, mapped);
    return mapped;
  }

  let out = html;

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
      .filter(([, publicUrl]) => Boolean(publicUrl))
      .map(([sourceUrl, publicUrl]) => ({ sourceUrl, publicUrl })),
  };
}

function wpUploadRelativeFromUrl(urlString) {
  const url = new URL(urlString);
  const marker = "/blog/wp-content/uploads/";
  const idx = url.pathname.indexOf(marker);
  if (idx === -1) return null;
  return url.pathname.slice("/blog/".length); // wp-content/uploads/...
}

async function fetchWithRetry(url) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await fetch(url);
    } catch (err) {
      const waitMs = attempt === 1 ? 500 : attempt === 2 ? 1500 : 3000;
      console.warn(`Fetch failed (attempt ${attempt}/3), retrying in ${waitMs}ms: ${url}`);
      console.warn(err?.cause?.message ?? err?.message ?? err);
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
  return null;
}

function toPublicUrl({ region, bucket, key, publicBaseUrl }) {
  if (publicBaseUrl) return `${publicBaseUrl}/${key}`;
  return `https://${bucket}.s3.${region}.amazonaws.com/${key}`;
}

export async function ensureS3ForWpUploadUrl({
  prisma,
  s3,
  bucket,
  region,
  wpBaseUrl,
  sourceUrl,
}) {
  const canonical = canonicalizeWpUploadUrl(sourceUrl);
  const existing = await prisma.mediaAsset.findFirst({
    where: { sourceUrl: canonical, provider: "s3" },
    select: { url: true },
  });
  if (existing?.url) return { url: existing.url, created: false, sourceUrl: canonical };

  const rel = wpUploadRelativeFromUrl(canonical);
  if (!rel) return null;

  const publicBaseUrl = getPublicBaseUrlFromEnv();
  const keyPrefix = String(process.env.S3_KEY_PREFIX || "blog").replace(/^\/+|\/+$/g, "");
  const key = `${keyPrefix}/${rel}`.replaceAll(/\/+/g, "/");

  // Quick existence check to avoid re-upload if DB got reset.
  try {
    await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    const url = toPublicUrl({ region, bucket, key, publicBaseUrl });
    await prisma.mediaAsset.create({
      data: {
        provider: "s3",
        key,
        sourceUrl: canonical,
        filename: rel.split("/").pop() || "file",
        url,
        mimeType: null,
        bytes: null,
      },
    });
    return { url, created: false, sourceUrl: canonical };
  } catch {
    // not found; proceed
  }

  const res = await fetchWithRetry(canonical);
  if (!res) {
    console.warn(`Skipping upload (fetch failed permanently): ${canonical}`);
    return null;
  }
  if (!res.ok) {
    console.warn(`Skipping upload (fetch non-OK): GET ${canonical} -> ${res.status}`);
    return null;
  }

  const contentType = res.headers.get("content-type") || undefined;
  const contentLengthHeader = res.headers.get("content-length");
  const bytes = contentLengthHeader ? Number(contentLengthHeader) : null;

  const bodyStream = res.body ? Readable.fromWeb(res.body) : Readable.from(Buffer.from(await res.arrayBuffer()));

  const uploader = new Upload({
    client: s3,
    params: {
      Bucket: bucket,
      Key: key,
      Body: bodyStream,
      ContentType: contentType,
    },
    queueSize: 4,
    partSize: 8 * 1024 * 1024,
    leavePartsOnError: false,
  });

  try {
    await uploader.done();
  } catch (err) {
    console.warn(`Skipping upload (S3 upload failed): ${canonical}`);
    console.warn(err?.message ?? err);
    return null;
  }

  const url = toPublicUrl({ region, bucket, key, publicBaseUrl });
  await prisma.mediaAsset.create({
    data: {
      provider: "s3",
      key,
      sourceUrl: canonical,
      filename: rel.split("/").pop() || crypto.randomUUID(),
      url,
      mimeType: contentType ?? null,
      bytes: bytes ?? null,
    },
  });

  return { url, created: true, sourceUrl: canonical };
}
