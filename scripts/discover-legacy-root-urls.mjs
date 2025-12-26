import "dotenv/config";

import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

function usageAndExit(msg) {
  if (msg) process.stderr.write(`${msg}\n`);
  process.stderr.write(
    [
      "Usage:",
      "  node scripts/discover-legacy-root-urls.mjs",
      "",
      "Env:",
      "  LEGACY_BASE_URL=https://carlagannis.com",
      "  EXCLUDE_PREFIX=/blog",
      "  URLS_OUT_FILE=tests/parity/root-urls.json",
      "  URL_DISCOVERY_MODE=crawl (default)",
      "  URL_VALIDATE=1 (default) | 0",
      "  URL_VALIDATE_CONCURRENCY=6",
      "  URL_CRAWL_MAX=2000",
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
  if (u.pathname !== "/" && !u.pathname.endsWith("/") && !u.pathname.includes(".")) u.pathname += "/";
  return u.toString();
}

async function fetchText(url) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`Fetch failed ${res.status} ${url}`);
  return await res.text();
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

async function discoverByCrawl({ baseUrl, excludePrefix, maxPages }) {
  const start = `${baseUrl}/`;
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
      if (excludePrefix && (u.pathname === excludePrefix || u.pathname.startsWith(`${excludePrefix}/`))) continue;
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
  const excludePrefix = normalizePrefix(process.env.EXCLUDE_PREFIX || "/blog");
  const mode = (process.env.URL_DISCOVERY_MODE || "crawl").toLowerCase();
  const validate = process.env.URL_VALIDATE === "0" ? false : true;
  const validateConcurrency = Number(process.env.URL_VALIDATE_CONCURRENCY || "6");
  const maxPages = Number(process.env.URL_CRAWL_MAX || "2000");

  const defaultOut = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "tests",
    "parity",
    "root-urls.json",
  );
  const outFile = process.env.URLS_OUT_FILE
    ? path.resolve(process.cwd(), process.env.URLS_OUT_FILE)
    : path.resolve(defaultOut);

  if (mode !== "crawl") usageAndExit("Only URL_DISCOVERY_MODE=crawl is supported for root URLs right now.");
  const discovery = await discoverByCrawl({ baseUrl: legacyBaseUrl, excludePrefix, maxPages });

  const filtered = discovery.urls
    .map((u) => {
      try {
        const abs = new URL(u, legacyBaseUrl).toString();
        const nu = new URL(abs);
        if (nu.origin !== legacyBaseUrl) return null;
        if (excludePrefix && (nu.pathname === excludePrefix || nu.pathname.startsWith(`${excludePrefix}/`))) return null;
        if (isProbablyAssetPath(nu.pathname)) return null;
        return normalizePageUrl(abs);
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  const urls = uniq(filtered).sort();

  let validation = null;
  let okUrls = urls;
  if (validate) {
    const results = await validateUrls(urls, { concurrency: validateConcurrency });
    okUrls = results.filter((r) => r.ok).map((r) => r.url);
    validation = {
      total: results.length,
      ok: okUrls.length,
      nonOk: results.filter((r) => !r.ok).length,
      nonOkSample: results.filter((r) => !r.ok).slice(0, 50),
    };
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    legacyBaseUrl,
    excludePrefix,
    discovery: { ...discovery, urls: okUrls },
    validation,
    urls: okUrls.sort(),
  };

  await writeFile(outFile, JSON.stringify(payload, null, 2), "utf8");
  process.stdout.write(`Wrote ${payload.urls.length} URLs to ${outFile}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

