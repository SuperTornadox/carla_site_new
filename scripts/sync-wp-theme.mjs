import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

const WP_BASE_URL = (process.env.WP_BASE_URL || "https://carlagannis.com/blog").replace(
  /\/+$/,
  "",
);

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

function toLocalPublicPath(urlString) {
  const url = new URL(urlString);
  const pathname = url.pathname;
  if (!pathname.startsWith("/blog/")) {
    throw new Error(`Unexpected URL path (expected /blog/*): ${urlString}`);
  }
  return path.join(process.cwd(), "public", pathname.slice(1));
}

async function download(urlString) {
  const res = await fetch(urlString);
  if (!res.ok) throw new Error(`GET ${urlString} -> ${res.status}`);
  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

async function writeFileForUrl(urlString, contents) {
  const localPath = toLocalPublicPath(urlString);
  await ensureDir(path.dirname(localPath));
  await fs.writeFile(localPath, contents);
  return localPath;
}

function extractFirst(html, regex) {
  const match = html.match(regex);
  return match ? match[0] : null;
}

function extractAll(html, regex) {
  const matches = html.matchAll(regex);
  return Array.from(matches, (m) => m[0]);
}

function extractUrlAttrs(html, attrName) {
  const re = new RegExp(`${attrName}=["']([^"']+)["']`, "gi");
  const out = [];
  for (const m of html.matchAll(re)) out.push(m[1]);
  return out;
}

function normalizeToAbsolute(urlString) {
  if (urlString.startsWith("//")) return `https:${urlString}`;
  if (urlString.startsWith("/")) return `${WP_BASE_URL}${urlString}`;
  if (urlString.startsWith("http://") || urlString.startsWith("https://")) return urlString;
  return `${WP_BASE_URL}/${urlString}`;
}

async function main() {
  const homeUrl = `${WP_BASE_URL}/`;
  const homeHtml = (await (await fetch(homeUrl)).text()).toString();

  const headerHtml = extractFirst(homeHtml, /<header id="masthead"[\s\S]*?<\/header>/i);
  const footerHtml = extractFirst(homeHtml, /<footer id="colophon"[\s\S]*?<\/footer>/i);
  const styleBlocks = extractAll(homeHtml, /<style\b[^>]*>[\s\S]*?<\/style>/gi);

  await ensureDir(path.join(process.cwd(), "public", "blog", "_fragments"));
  const headerOut = headerHtml ? headerHtml.replaceAll(WP_BASE_URL, "/blog") : null;
  const footerOut = footerHtml ? footerHtml.replaceAll(WP_BASE_URL, "/blog") : null;
  if (headerHtml) {
    await fs.writeFile(
      path.join(process.cwd(), "public", "blog", "_fragments", "header.html"),
      headerOut,
    );
  }
  if (footerHtml) {
    await fs.writeFile(
      path.join(process.cwd(), "public", "blog", "_fragments", "footer.html"),
      footerOut,
    );
  }

  const inlineCss = styleBlocks
    .map((s) => s.replace(/^<style\b[^>]*>/i, "").replace(/<\/style>\s*$/i, ""))
    .join("\n\n");
  await fs.writeFile(path.join(process.cwd(), "public", "blog", "wp-inline.css"), inlineCss);

  const linkHrefs = extractUrlAttrs(homeHtml, "href")
    .map(normalizeToAbsolute)
    .filter((u) => u.startsWith(`${WP_BASE_URL}/wp-content/themes/freedom-pro/`));

  const scriptSrcs = extractUrlAttrs(homeHtml, "src")
    .map(normalizeToAbsolute)
    .filter(
      (u) =>
        u.startsWith(`${WP_BASE_URL}/wp-content/themes/freedom-pro/`) ||
        u.startsWith(`${WP_BASE_URL}/wp-includes/js/jquery/`),
    );

  const assets = Array.from(new Set([...linkHrefs, ...scriptSrcs])).map((u) =>
    u.replace(/\?.*$/, ""),
  );

  for (const assetUrl of assets) {
    const buf = await download(assetUrl);
    await writeFileForUrl(assetUrl, buf);
  }

  // Pull font files referenced by Font Awesome.
  const faCssUrl = `${WP_BASE_URL}/wp-content/themes/freedom-pro/fontawesome/css/font-awesome.min.css`;
  const faCssText = (await (await fetch(faCssUrl)).text()).toString();
  const localFaCssPath = await writeFileForUrl(faCssUrl, faCssText);

  const cssDirUrl = new URL(faCssUrl);
  const urlMatches = faCssText.matchAll(/url\(([^)]+)\)/g);
  const fontUrls = [];
  for (const m of urlMatches) {
    const raw = m[1].trim().replace(/^['"]|['"]$/g, "");
    if (raw.startsWith("data:")) continue;
    const abs = new URL(raw, cssDirUrl).toString().replace(/\?.*$/, "");
    if (abs.startsWith(`${WP_BASE_URL}/wp-content/themes/freedom-pro/fontawesome/`)) {
      fontUrls.push(abs);
    }
  }

  for (const fontUrl of Array.from(new Set(fontUrls))) {
    const buf = await download(fontUrl);
    await writeFileForUrl(fontUrl, buf);
  }

  let dbSeeded = false;
  if (process.env.DATABASE_URL) {
    const prisma = new PrismaClient();
    try {
      try {
        if (headerOut) {
          await prisma.siteSetting.upsert({
            where: { key: "blog.headerHtml" },
            update: { value: headerOut },
            create: { key: "blog.headerHtml", value: headerOut },
          });
        }
        if (footerOut) {
          await prisma.siteSetting.upsert({
            where: { key: "blog.footerHtml" },
            update: { value: footerOut },
            create: { key: "blog.footerHtml", value: footerOut },
          });
        }
        await prisma.siteSetting.upsert({
          where: { key: "blog.inlineCss" },
          update: { value: inlineCss },
          create: { key: "blog.inlineCss", value: inlineCss },
        });
        dbSeeded = true;
      } catch (err) {
        console.warn("Skipping DB seeding (database not reachable).");
        console.warn(err?.message ?? err);
      }
    } finally {
      await prisma.$disconnect();
    }
  }

  await fs.writeFile(
    path.join(process.cwd(), "scripts", "generated-theme-sync.json"),
    JSON.stringify(
      {
        wpBaseUrl: WP_BASE_URL,
        homeUrl,
        assetsDownloaded: assets.length,
        dbSeeded,
        wrote: [
          "public/blog/_fragments/header.html",
          "public/blog/_fragments/footer.html",
          "public/blog/wp-inline.css",
          path.relative(process.cwd(), localFaCssPath),
        ],
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
