import "dotenv/config";

import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

const LEGACY_BASE_URL = (process.env.LEGACY_BASE_URL || "https://carlagannis.com").replace(/\/+$/, "");
const BLOG_PREFIX = "/blog";

function normalizePathname(pathname) {
  const withSlash = pathname.startsWith("/") ? pathname : `/${pathname}`;
  return withSlash.replace(/\/+$/, "") || "/";
}

function toContentPathFromLegacyUrl(urlString) {
  const url = new URL(urlString);
  const pathname = normalizePathname(url.pathname);
  if (!pathname.startsWith(`${BLOG_PREFIX}/`) && pathname !== BLOG_PREFIX) return null;
  const rest = pathname === BLOG_PREFIX ? "" : pathname.slice(`${BLOG_PREFIX}/`.length);
  return rest;
}

async function fetchLegacyBodyClass(urlString) {
  const res = await fetch(urlString, { headers: { Accept: "text/html" } });
  if (!res.ok) throw new Error(`GET ${urlString} -> ${res.status}`);
  const html = await res.text();
  const m = html.match(/<body[^>]*class=\"([^\"]*)\"/i);
  if (!m) return null;
  const cls = String(m[1] || "").trim().replace(/\s+/g, " ");
  return cls || null;
}

async function main() {
  const prisma = new PrismaClient();
  const urlsFile =
    process.env.PARITY_URLS_FILE ??
    path.join(process.cwd(), "tests", "parity", "legacy-urls.json");
  const payload = JSON.parse(fs.readFileSync(urlsFile, "utf8"));
  const urls = Array.isArray(payload.urls) ? payload.urls : [];

  const selected = urls.filter((u) => u.startsWith(`${LEGACY_BASE_URL}${BLOG_PREFIX}`));
  const concurrency = Number(process.env.BODYCLASS_CONCURRENCY || "5");

  let i = 0;
  let updated = 0;
  let skipped = 0;
  let failed = 0;

  async function worker() {
    while (true) {
      const idx = i++;
      if (idx >= selected.length) return;
      const url = selected[idx];
      const contentPath = toContentPathFromLegacyUrl(url);
      if (contentPath === null) {
        skipped++;
        continue;
      }
      try {
        const cls = await fetchLegacyBodyClass(url);
        if (!cls) {
          skipped++;
          continue;
        }
        const exists = await prisma.contentItem.findUnique({
          where: { path: contentPath },
          select: { id: true, legacyBodyClass: true },
        });
        if (!exists) {
          skipped++;
          continue;
        }
        if (exists.legacyBodyClass === cls) {
          skipped++;
          continue;
        }
        await prisma.contentItem.update({
          where: { path: contentPath },
          data: { legacyBodyClass: cls },
        });
        updated++;
      } catch (err) {
        failed++;
        process.stderr.write(`Failed: ${url} (${err?.message ?? err})\n`);
      }
    }
  }

  try {
    await Promise.all(Array.from({ length: concurrency }, () => worker()));
  } finally {
    await prisma.$disconnect();
  }

  process.stdout.write(
    `Backfill done: total=${selected.length} updated=${updated} skipped=${skipped} failed=${failed}\n`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

