import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { blobEnabled, rewriteUploadsInHtml, ensureBlobForUploadUrl } from "./lib/blob-media.mjs";

const prisma = new PrismaClient();

const WP_BASE_URL = (process.env.WP_BASE_URL || "https://carlagannis.com/blog").replace(/\/+$/, "");

function rewriteWpUrls(html) {
  let out = html;
  out = out.replaceAll(WP_BASE_URL, "/blog");
  out = out.replaceAll("https://carlagannis.com/blog", "/blog");
  return out;
}

async function fetchLegacyBodyClass(url) {
  try {
    const res = await fetch(url, { headers: { Accept: "text/html" } });
    if (!res.ok) return null;
    const html = await res.text();
    const m = html.match(/<body[^>]*class=\"([^\"]*)\"/i);
    if (!m) return null;
    return String(m[1] || "").trim().replace(/\s+/g, " ") || null;
  } catch {
    return null;
  }
}

async function main() {
  const slug = process.argv[2];
  if (!slug) {
    console.error("Usage: node scripts/reimport-page.mjs <slug>");
    console.error("Example: node scripts/reimport-page.mjs the-garden-of-emoji-delights");
    process.exit(1);
  }

  console.log(`Fetching page with slug: ${slug}`);

  // Try pages first
  let res = await fetch(`${WP_BASE_URL}/wp-json/wp/v2/pages?slug=${slug}`);
  let items = await res.json();
  let kind = "PAGE";

  if (!Array.isArray(items) || items.length === 0) {
    // Try posts
    res = await fetch(`${WP_BASE_URL}/wp-json/wp/v2/posts?slug=${slug}`);
    items = await res.json();
    kind = "POST";
  }

  if (!Array.isArray(items) || items.length === 0) {
    console.error(`No page or post found with slug: ${slug}`);
    process.exit(1);
  }

  const item = items[0];
  console.log(`Found ${kind}: ${item.title.rendered} (ID: ${item.id})`);

  const status = item.status === "publish" ? "PUBLISHED" : "DRAFT";
  const title = String(item.title?.rendered ?? "");
  const rendered = String(item.content?.rendered ?? "");
  let html = rewriteWpUrls(rendered);

  // Fetch body class from live site
  const legacyBodyClass = await fetchLegacyBodyClass(item.link);
  console.log(`Legacy body class: ${legacyBodyClass?.substring(0, 50)}...`);

  // Get SEO data
  const yoast = item.yoast_head_json || {};
  const seoTitle = typeof yoast.title === "string" ? yoast.title : null;
  const seoDesc = typeof yoast.description === "string" ? yoast.description : null;

  // Rewrite media URLs to Vercel Blob
  if (blobEnabled()) {
    console.log("Rewriting media URLs to Vercel Blob...");
    let uploadCount = 0;
    const rewritten = await rewriteUploadsInHtml({
      html,
      wpBaseUrl: WP_BASE_URL,
      resolve: async (sourceUrl) => {
        const res = await ensureBlobForUploadUrl({ prisma, sourceUrl });
        if (!res) return null;
        if (res.created) {
          uploadCount++;
          console.log(`  Uploaded: ${sourceUrl.split('/').pop()}`);
        }
        return res.url;
      },
    });
    html = rewritten.html;
    console.log(`Uploaded ${uploadCount} new media files, rewritten ${rewritten.mapped.length} URLs`);
  }

  // Content path from slug
  const contentPath = slug;

  // Upsert to database
  const blocks = [{ type: "html", html }];
  await prisma.contentItem.upsert({
    where: { path: contentPath },
    update: {
      type: kind,
      legacyWpId: item.id,
      legacyBodyClass,
      title,
      status,
      content: blocks,
      seoTitle: seoTitle || null,
      seoDesc: seoDesc || null,
      publishedAt: status === "PUBLISHED" ? new Date() : null,
    },
    create: {
      type: kind,
      legacyWpId: item.id,
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

  console.log(`\n✅ Successfully reimported: ${title}`);
  console.log(`   Path: /blog/${contentPath}/`);
  console.log(`   Status: ${status}`);
  console.log(`   HTML length: ${html.length} characters`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
