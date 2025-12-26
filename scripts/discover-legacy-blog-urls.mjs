import "dotenv/config";

import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

function usageAndExit(msg) {
  if (msg) process.stderr.write(`${msg}\n`);
  process.stderr.write(
    [
      "Usage:",
      "  node scripts/discover-legacy-blog-urls.mjs",
      "",
      "Env:",
      "  LEGACY_BASE_URL=https://carlagannis.com",
      "  LEGACY_BLOG_PREFIX=/blog",
      "  URLS_OUT_FILE=tests/parity/legacy-urls.json",
      "  URL_DISCOVERY_MODE=sitemap|crawl|auto",
      "  URL_VALIDATE=1 (default) | 0",
      "  URL_VALIDATE_CONCURRENCY=6",
      "  URL_CRAWL_MAX=4000",
      "",
    ].join("\n"),
  );
  process.exit(msg ? 1 : 0);
}

function uniq(arr) {
  return [...new Set(arr)];
}

function normalizeBaseUrl(raw) {
  const u = new URL(raw);
  u.pathname = "";
  u.search = "";
  u.hash = "";
  return u.toString().replace(/\/$/, "");
}

function normalizePrefix(raw) {
  if (!raw) return "/blog";
  let p = raw.trim();
  if (!p.startsWith("/")) p = `/${p}`;
  if (p.endsWith("/")) p = p.slice(0, -1);
  return p;
}

function isProbablyAssetPath(pathname) {
  if (pathname.includes("/wp-content/")) return true;
  if (pathname.includes("/wp-includes/")) return true;
  if (pathname.includes("/wp-json/")) return true;
  if (pathname.endsWith(".xml")) return true;
  if (pathname.endsWith(".json")) return true;
  if (pathname.endsWith(".txt")) return true;
  if (pathname.endsWith(".css")) return true;
  if (pathname.endsWith(".js")) return true;
  if (pathname.endsWith(".png")) return true;
  if (pathname.endsWith(".jpg") || pathname.endsWith(".jpeg")) return true;
  if (pathname.endsWith(".gif")) return true;
  if (pathname.endsWith(".webp")) return true;
  if (pathname.endsWith(".svg")) return true;
  if (pathname.endsWith(".mp4") || pathname.endsWith(".mov") || pathname.endsWith(".webm"))
    return true;
  if (pathname.endsWith(".pdf")) return true;
  return false;
}

function normalizePageUrl(rawUrl) {
  const u = new URL(rawUrl);
  u.hash = "";
  // Normalize to trailing slash for parity with Next's trailingSlash=true
  if (!u.pathname.endsWith("/") && !u.pathname.includes(".")) u.pathname += "/";
  return u.toString();
}

function extractLocsFromXml(xml) {
  const locs = [];
  const re = /<loc>([^<]+)<\/loc>/gi;
  let m;
  while ((m = re.exec(xml))) {
    locs.push(m[1].trim());
  }
  return locs;
}

async function fetchText(url) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`Fetch failed ${res.status} ${url}`);
  return await res.text();
}

async function discoverFromSitemaps({ baseUrl, blogPrefix }) {
  const candidates = [
    `${baseUrl}${blogPrefix}/sitemap_index.xml`,
    `${baseUrl}${blogPrefix}/sitemap.xml`,
    `${baseUrl}/sitemap_index.xml`,
    `${baseUrl}/sitemap.xml`,
  ];

  for (const sitemapUrl of candidates) {
    try {
      const xml = await fetchText(sitemapUrl);
      const locs = extractLocsFromXml(xml);
      if (!locs.length) continue;

      const looksLikeIndex = /<sitemapindex/i.test(xml);
      if (!looksLikeIndex) {
        return { mode: "sitemap", sitemapUrl, urls: locs };
      }

      const childSitemaps = locs;
      const childXmls = await Promise.all(
        childSitemaps.map(async (u) => {
          try {
            return await fetchText(u);
          } catch {
            return null;
          }
        }),
      );
      const childLocs = childXmls
        .filter(Boolean)
        .flatMap((x) => extractLocsFromXml(x));
      if (childLocs.length) {
        return { mode: "sitemap-index", sitemapUrl, urls: childLocs };
      }
    } catch {
      // try next
    }
  }

  return null;
}

function extractLinksFromHtml(html) {
  const urls = [];
  const re = /<a\s[^>]*href=["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(html))) {
    urls.push(m[1].trim());
  }
  return urls;
}

async function discoverByCrawl({ baseUrl, blogPrefix, maxPages }) {
  const start = `${baseUrl}${blogPrefix}/`;
  const q = [start];
  const seen = new Set();
  const out = [];

  while (q.length && out.length < maxPages) {
    const url = q.shift();
    if (!url || seen.has(url)) continue;
    seen.add(url);

    let html;
    try {
      html = await fetchText(url);
    } catch {
      continue;
    }

    out.push(url);
    const hrefs = extractLinksFromHtml(html);
    for (const href of hrefs) {
      let abs;
      try {
        abs = new URL(href, url).toString();
      } catch {
        continue;
      }
      const u = new URL(abs);
      if (u.origin !== baseUrl) continue;
      if (!u.pathname.startsWith(`${blogPrefix}/`) && u.pathname !== blogPrefix) continue;
      if (isProbablyAssetPath(u.pathname)) continue;
      q.push(normalizePageUrl(abs));
    }
  }

  return { mode: "crawl", startUrl: start, urls: out };
}

async function validateUrls(urls, { concurrency }) {
  const results = [];
  let idx = 0;

  async function worker() {
    while (idx < urls.length) {
      const i = idx++;
      const url = urls[i];
      try {
        const res = await fetch(url, { redirect: "follow" });
        results[i] = { url, status: res.status, ok: res.ok };
      } catch (err) {
        results[i] = { url, status: 0, ok: false, error: String(err) };
      }
    }
  }

  const workers = Array.from({ length: concurrency }, () => worker());
  await Promise.all(workers);
  return results;
}

async function main() {
  if (process.argv.includes("-h") || process.argv.includes("--help")) usageAndExit();

  const legacyBaseUrl = normalizeBaseUrl(process.env.LEGACY_BASE_URL || "https://carlagannis.com");
  const blogPrefix = normalizePrefix(process.env.LEGACY_BLOG_PREFIX || "/blog");
  const mode = (process.env.URL_DISCOVERY_MODE || "auto").toLowerCase();
  const validate = process.env.URL_VALIDATE === "0" ? false : true;
  const validateConcurrency = Number(process.env.URL_VALIDATE_CONCURRENCY || "6");
  const maxPages = Number(process.env.URL_CRAWL_MAX || "4000");

  const defaultOut = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "tests",
    "parity",
    "legacy-urls.json",
  );
  const outFile = process.env.URLS_OUT_FILE
    ? path.resolve(process.cwd(), process.env.URLS_OUT_FILE)
    : path.resolve(defaultOut);

  let discovery = null;
  if (mode === "sitemap" || mode === "auto") {
    discovery = await discoverFromSitemaps({ baseUrl: legacyBaseUrl, blogPrefix });
  }
  if (!discovery && (mode === "crawl" || mode === "auto")) {
    discovery = await discoverByCrawl({ baseUrl: legacyBaseUrl, blogPrefix, maxPages });
  }
  if (!discovery) usageAndExit("Failed to discover URLs (no sitemap and crawl failed).");

  const filtered = discovery.urls
    .map((u) => {
      try {
        const abs = new URL(u, legacyBaseUrl).toString();
        const nu = new URL(abs);
        if (nu.origin !== legacyBaseUrl) return null;
        if (!nu.pathname.startsWith(`${blogPrefix}/`) && nu.pathname !== blogPrefix) return null;
        if (isProbablyAssetPath(nu.pathname)) return null;
        return normalizePageUrl(abs);
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  const urls = uniq(filtered).sort();

  let validation = null;
  if (validate) {
    const results = await validateUrls(urls, { concurrency: validateConcurrency });
    const okUrls = results.filter((r) => r.ok).map((r) => r.url);
    validation = {
      total: results.length,
      ok: okUrls.length,
      nonOk: results.filter((r) => !r.ok).length,
      nonOkSample: results.filter((r) => !r.ok).slice(0, 50),
    };
    discovery.urls = okUrls;
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    legacyBaseUrl,
    blogPrefix,
    discovery,
    validation,
    urls: (validate ? discovery.urls : urls).sort(),
  };

  await writeFile(outFile, JSON.stringify(payload, null, 2), "utf8");
  process.stdout.write(`Wrote ${payload.urls.length} URLs to ${outFile}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

