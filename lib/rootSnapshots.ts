import { readFile } from "node:fs/promises";
import path from "node:path";

function safePathFromSegments(segments: string[]) {
  const cleaned = segments
    .map((s) => s.replace(/\0/g, ""))
    .map((s) => s.replace(/^\/+|\/+$/g, ""))
    .filter(Boolean);
  // prevent traversal
  for (const seg of cleaned) {
    if (seg === "." || seg === ".." || seg.includes("..")) return null;
  }
  return cleaned.join("/");
}

export async function readRootSnapshotHtml(segments: string[]) {
  const rel = safePathFromSegments(segments);
  const base = path.join(process.cwd(), "public", "root-snapshots");
  const full = rel ? path.join(base, rel, "index.html") : path.join(base, "index.html");
  try {
    return await readFile(full, "utf8");
  } catch {
    return null;
  }
}

