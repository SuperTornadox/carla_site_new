import { readFile } from "node:fs/promises";
import path from "node:path";
import { getSettingString } from "@/lib/settings";

function rewriteLegacyLinksToLocal(html: string | null) {
  if (!html) return null;
  const legacy = (process.env.LEGACY_BASE_URL || "https://carlagannis.com").replace(/\/$/, "");

  // Most links are under `/blog/**`; normalize absolute legacy links to local paths.
  let out = html.split(`${legacy}/blog/`).join("/blog/");
  out = out.split(`${legacy}/blog`).join("/blog");

  // The top nav "home" item may point to the legacy root; keep users within the local app root.
  out = out.replaceAll(`href="${legacy}"`, `href="/"`);
  out = out.replaceAll(`href='${legacy}'`, `href="/"`);

  // Explicitly map the site title + home nav item to the local app root (not `/blog/`).
  out = out.replace(
    /href="\/blog\/"\s+title="Carla Gannis Studio"\s+rel="home"/g,
    'href="/" title="Carla Gannis Studio" rel="home"',
  );
  out = out.replace(/href="\/blog\/"\s+title="home"/g, 'href="/" title="home"');
  return out;
}

async function readPublicFile(relPath: string) {
  try {
    const fullPath = path.join(process.cwd(), "public", relPath);
    return await readFile(fullPath, "utf8");
  } catch {
    return null;
  }
}

export async function getBlogHeaderHtml() {
  const fromDb = await getSettingString("blog.headerHtml");
  if (fromDb) return rewriteLegacyLinksToLocal(fromDb);
  return rewriteLegacyLinksToLocal(await readPublicFile("blog/_fragments/header.html"));
}

export async function getBlogFooterHtml() {
  const fromDb = await getSettingString("blog.footerHtml");
  if (fromDb) return rewriteLegacyLinksToLocal(fromDb);
  return rewriteLegacyLinksToLocal(await readPublicFile("blog/_fragments/footer.html"));
}

export async function getBlogInlineCss() {
  const fromDb = await getSettingString("blog.inlineCss");
  if (fromDb) return fromDb;
  return readPublicFile("blog/wp-inline.css");
}

export async function getBlogInlineCssPre() {
  const fromDb = await getSettingString("blog.inlineCssPre");
  if (fromDb) return fromDb;
  return readPublicFile("blog/wp-inline.pre.css");
}

export async function getBlogInlineCssPost() {
  const fromDb = await getSettingString("blog.inlineCssPost");
  if (fromDb) return fromDb;
  return readPublicFile("blog/wp-inline.post.css");
}
