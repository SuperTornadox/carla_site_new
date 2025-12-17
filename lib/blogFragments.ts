import { readFile } from "node:fs/promises";
import path from "node:path";
import { getSettingString } from "@/lib/settings";

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
  if (fromDb) return fromDb;
  return readPublicFile("blog/_fragments/header.html");
}

export async function getBlogFooterHtml() {
  const fromDb = await getSettingString("blog.footerHtml");
  if (fromDb) return fromDb;
  return readPublicFile("blog/_fragments/footer.html");
}

export async function getBlogInlineCss() {
  const fromDb = await getSettingString("blog.inlineCss");
  if (fromDb) return fromDb;
  return readPublicFile("blog/wp-inline.css");
}
