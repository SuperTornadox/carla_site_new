import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { blobEnabled, ensureBlobForUploadUrl, rewriteUploadsInHtml } from "./lib/blob-media.mjs";
import {
  createS3ClientFromEnv,
  ensureS3ForWpUploadUrl,
  getS3BucketFromEnv,
  rewriteWpUploadsInHtml,
} from "./lib/s3-media.mjs";

const prisma = new PrismaClient();

const WP_BASE_URL = (process.env.WP_BASE_URL || "https://carlagannis.com/blog").replace(
  /\/+$/,
  "",
);

function getMediaMode() {
  const raw = String(process.env.MEDIA_MODE || "").trim().toLowerCase();
  if (raw === "blob" || raw === "s3" || raw === "public" || raw === "none") return raw;
  return blobEnabled() ? "blob" : "public";
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

function rewriteWpUrls(html) {
  let out = html;
  out = out.replaceAll(WP_BASE_URL, "/blog");
  out = out.replaceAll("https://carlagannis.com/blog", "/blog");
  return out;
}

function toContentPathFromLink(link) {
  const url = new URL(link);
  const pathname = url.pathname;
  if (!pathname.startsWith("/blog/")) return null;
  const rest = pathname.slice("/blog/".length);
  return rest.replace(/\/+$/, "");
}

function extractUploadUrls(html) {
  const urls = new Set();

  for (const m of html.matchAll(/https?:\/\/[^"' )]+\/wp-content\/uploads\/[^"' )]+/g)) {
    urls.add(m[0].replace(/\?.*$/, ""));
  }

  for (const m of html.matchAll(/srcset=["']([^"']+)["']/gi)) {
    const value = m[1];
    for (const part of value.split(",")) {
      const url = part.trim().split(/\s+/)[0];
      if (url.startsWith("http")) urls.add(url.replace(/\?.*$/, ""));
    }
  }

  return Array.from(urls);
}

async function downloadToPublic(urlString) {
  const url = new URL(urlString);
  const idx = url.pathname.indexOf("/blog/wp-content/uploads/");
  if (idx === -1) return null;
  const rel = url.pathname.slice("/blog/".length); // wp-content/uploads/...
  const localPath = path.join(process.cwd(), "public", "blog", rel);
  await ensureDir(path.dirname(localPath));

  try {
    await fs.access(localPath);
    return localPath;
  } catch {}

  const res = await fetch(urlString);
  if (!res.ok) throw new Error(`GET ${urlString} -> ${res.status}`);
  const arrayBuffer = await res.arrayBuffer();
  await fs.writeFile(localPath, Buffer.from(arrayBuffer));
  return localPath;
}

async function fetchAll(endpoint) {
  const out = [];
  for (let page = 1; page < 200; page++) {
    const url = `${WP_BASE_URL}/wp-json/wp/v2/${endpoint}?per_page=100&page=${page}`;
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (res.status === 400) break; // no more pages (WP REST API)
    if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
    const batch = await res.json();
    if (!Array.isArray(batch) || batch.length === 0) break;
    out.push(...batch);
  }
  return out;
}

async function getHomeWpPageId() {
  const res = await fetch(`${WP_BASE_URL}/`);
  if (!res.ok) return null;
  const html = await res.text();
  const m = html.match(/wp-json\/wp\/v2\/pages\/(\d+)/);
  return m ? Number(m[1]) : null;
}

async function upsertContentItem({
  type,
  legacyWpId,
  legacyBodyClass,
  path: contentPath,
  title,
  status,
  html,
  seoTitle,
  seoDesc,
}) {
  const blocks = [{ type: "html", html }];
  await prisma.contentItem.upsert({
    where: { path: contentPath },
    update: {
      type,
      legacyWpId,
      legacyBodyClass,
      title,
      status,
      content: blocks,
      seoTitle: seoTitle || null,
      seoDesc: seoDesc || null,
      publishedAt: status === "PUBLISHED" ? new Date() : null,
    },
    create: {
      type,
      legacyWpId,
      legacyBodyClass,
      path: contentPath,
      title,
      status,
      content: blocks,
      seoTitle: seoTitle || null,
      seoDesc: seoDesc || null,
      publishedAt: status === "PUBLISHED" ? new Date() : null,
    },
  });
}

async function fetchLegacyBodyClass(url) {
  try {
    const res = await fetch(url, { headers: { Accept: "text/html" } });
    if (!res.ok) return null;
    const html = await res.text();
    const m = html.match(/<body[^>]*class=\"([^\"]*)\"/i);
    if (!m) return null;
    const cls = String(m[1] || "").trim().replace(/\s+/g, " ");
    return cls || null;
  } catch {
    return null;
  }
}

async function main() {
  await ensureDir(path.join(process.cwd(), "public", "blog", "wp-content", "uploads"));

  const homeId = await getHomeWpPageId();
  const pages = await fetchAll("pages");
  const posts = await fetchAll("posts");

  const all = [
    ...pages.map((x) => ({ ...x, __kind: "PAGE" })),
    ...posts.map((x) => ({ ...x, __kind: "POST" })),
  ];

  const mediaMode = getMediaMode();
  if (mediaMode === "blob" && !blobEnabled()) {
    throw new Error(
      "MEDIA_MODE=blob requires BLOB_READ_WRITE_TOKEN to be set (see Vercel Blob store token).",
    );
  }

  let s3 = null;
  let s3Bucket = null;
  let s3Region = null;
  if (mediaMode === "s3") {
    s3 = createS3ClientFromEnv();
    s3Bucket = getS3BucketFromEnv();
    s3Region = process.env.AWS_REGION;
    if (!s3Region) throw new Error("AWS_REGION is required for MEDIA_MODE=s3.");
  }

  const useBlob = mediaMode === "blob";
  const useS3 = mediaMode === "s3";
  const usePublic = mediaMode === "public";
  let uploadedToPublic = 0;
  let uploadedToBlob = 0;
  let uploadedToS3 = 0;
  let rewrittenUploads = 0;
  const mediaMap = new Map(); // sourceUrl -> blobUrl
  const mediaUsedBy = new Map(); // sourceUrl -> Set(contentPath)

  for (const item of all) {
    const contentPath = toContentPathFromLink(item.link);
    if (contentPath === null) continue;

    const isHome = homeId && item.id === homeId;
    const finalPath = isHome ? "" : contentPath;

    const status = item.status === "publish" ? "PUBLISHED" : "DRAFT";
    const title = String(item.title?.rendered ?? "");
    const rendered = String(item.content?.rendered ?? "");
    let html = rewriteWpUrls(rendered);
    const legacyBodyClass =
      process.env.IMPORT_BODY_CLASS === "0" ? null : await fetchLegacyBodyClass(item.link);

    const yoast = item.yoast_head_json || {};
    const seoTitle = typeof yoast.title === "string" ? yoast.title : null;
    const seoDesc = typeof yoast.description === "string" ? yoast.description : null;

    if (useBlob) {
      const rewritten = await rewriteUploadsInHtml({
        html,
        wpBaseUrl: WP_BASE_URL,
        resolve: async (sourceUrl) => {
          const res = await ensureBlobForUploadUrl({ prisma, sourceUrl });
          if (!res) return null;
          if (res.created) uploadedToBlob++;
          return res.url;
        },
      });
      html = rewritten.html;
      for (const { sourceUrl, blobUrl } of rewritten.mapped) {
        mediaMap.set(sourceUrl, blobUrl);
        const key = sourceUrl;
        const set = mediaUsedBy.get(key) ?? new Set();
        set.add(finalPath || "(home)");
        mediaUsedBy.set(key, set);
      }
      rewrittenUploads += rewritten.mapped.length;
    }

    if (useS3) {
      const rewritten = await rewriteWpUploadsInHtml({
        html,
        wpBaseUrl: WP_BASE_URL,
        resolve: async (sourceUrl) => {
          const res = await ensureS3ForWpUploadUrl({
            prisma,
            s3,
            bucket: s3Bucket,
            region: s3Region,
            wpBaseUrl: WP_BASE_URL,
            sourceUrl,
          });
          if (!res) return null;
          if (res.created) uploadedToS3++;
          return res.url;
        },
      });

      html = rewritten.html;
      for (const { sourceUrl, publicUrl } of rewritten.mapped) {
        mediaMap.set(sourceUrl, publicUrl);
        const key = sourceUrl;
        const set = mediaUsedBy.get(key) ?? new Set();
        set.add(finalPath || "(home)");
        mediaUsedBy.set(key, set);
      }
      rewrittenUploads += rewritten.mapped.length;
    }

    await upsertContentItem({
      type: item.__kind,
      legacyWpId: item.id,
      legacyBodyClass,
      path: finalPath,
      title,
      status,
      html,
      seoTitle,
      seoDesc,
    });

    if (!useBlob) {
      if (useS3) continue;
      if (!usePublic) continue;
      const urls = extractUploadUrls(rendered);
      for (const u of urls) {
        if (!u.includes("/blog/wp-content/uploads/")) continue;
        await downloadToPublic(u);
        uploadedToPublic++;
      }
    }
  }

  await fs.writeFile(
    path.join(process.cwd(), "scripts", "generated-import.json"),
    JSON.stringify(
      {
        wpBaseUrl: WP_BASE_URL,
        pagesImported: pages.length,
        postsImported: posts.length,
        mediaMode,
        uploadsDownloadedToPublic: uploadedToPublic,
        uploadsUploadedToBlob: uploadedToBlob,
        uploadsUploadedToS3: uploadedToS3,
        uploadsRewrittenInHtml: rewrittenUploads,
        homeWpPageId: homeId,
      },
      null,
      2,
    ),
  );

  if (useBlob || useS3) {
    const report = Array.from(mediaMap.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([sourceUrl, blobUrl]) => ({
        sourceUrl,
        blobUrl,
        usedBy: Array.from(mediaUsedBy.get(sourceUrl) ?? []).sort(),
      }));

    await fs.writeFile(
      path.join(process.cwd(), "scripts", "generated-media-map.json"),
      JSON.stringify(
        {
          wpBaseUrl: WP_BASE_URL,
          createdAt: new Date().toISOString(),
          items: report,
        },
        null,
        2,
      ),
    );
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
