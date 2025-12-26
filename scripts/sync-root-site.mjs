import "dotenv/config";

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

function normalizeBaseUrl(raw) {
  const u = new URL(raw);
  u.pathname = "";
  u.search = "";
  u.hash = "";
  return u.toString().replace(/\/$/, "");
}

function safeFilename(input) {
  return input.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");
}

async function fetchBuffer(url) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`Fetch failed ${res.status} ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  return { buf, contentType: res.headers.get("content-type") || "" };
}

async function fetchText(url) {
  const { buf } = await fetchBuffer(url);
  return buf.toString("utf8");
}

function rewriteLinksToLocal(html, { legacyBaseUrl }) {
  // Rewrite absolute links to local paths (no redirects to the legacy domain).
  let out = html.split(`${legacyBaseUrl}/blog/`).join("/blog/");
  out = out.split(`${legacyBaseUrl}/blog`).join("/blog");
  out = out.split(`${legacyBaseUrl}/`).join("/");
  out = out.split(`${legacyBaseUrl}`).join("/");
  return out;
}

async function main() {
  const legacyBaseUrl = normalizeBaseUrl(process.env.LEGACY_BASE_URL || "https://carlagannis.com");
  const outDir = path.resolve(process.cwd(), process.env.ROOT_SNAPSHOT_DIR || "public/root-snapshots");

  // Start small: snapshot the legacy root HTML (and any same-origin relative background images referenced).
  const html = await fetchText(`${legacyBaseUrl}/`);
  const rewritten = rewriteLinksToLocal(html, { legacyBaseUrl });

  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, "index.html"), rewritten, "utf8");

  // Heuristic: download root-relative assets referenced directly (href/src/url('...')).
  const assetMatches = [];
  const re = /(?:src|href)=["']([^"']+)["']|url\(\s*['"]?([^'")]+)['"]?\s*\)/gi;
  let m;
  while ((m = re.exec(html))) {
    const cand = (m[1] || m[2] || "").trim();
    if (!cand) continue;
    if (cand.startsWith("http://") || cand.startsWith("https://")) {
      try {
        const u = new URL(cand);
        if (u.origin !== legacyBaseUrl) continue;
        assetMatches.push(u.pathname.startsWith("/") ? u.pathname.slice(1) : u.pathname);
      } catch {
        continue;
      }
      continue;
    }
    if (cand.startsWith("data:")) continue;
    if (cand.startsWith("#")) continue;
    if (cand.startsWith("/")) assetMatches.push(cand.slice(1));
    else assetMatches.push(cand);
  }

  const assets = [...new Set(assetMatches)]
    .filter((p) => p && !p.startsWith("blog/")) // blog assets already handled elsewhere
    .filter((p) => !p.includes("wp-content/") && !p.includes("wp-includes/"));

  for (const rel of assets) {
    const url = `${legacyBaseUrl}/${rel}`;
    try {
      const { buf } = await fetchBuffer(url);
      const target = path.resolve(process.cwd(), "public", rel);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, buf);
      process.stdout.write(`synced ${rel}\n`);
    } catch (err) {
      process.stderr.write(`skip ${rel}: ${String(err)}\n`);
    }
  }

  process.stdout.write(`Wrote root snapshot to ${outDir}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

