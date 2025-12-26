import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { del } from "@vercel/blob";
import { canonicalizeWpUploadUrl } from "./lib/blob-media.mjs";

const prisma = new PrismaClient();

function parseBytes(input) {
  const raw = String(input || "").trim();
  if (!raw) return 0;
  const m = raw.match(/^(\d+(?:\.\d+)?)(kb|mb|gb)?$/i);
  if (!m) return Number(raw) || 0;
  const n = Number(m[1]);
  const unit = (m[2] || "").toLowerCase();
  if (unit === "kb") return Math.round(n * 1024);
  if (unit === "mb") return Math.round(n * 1024 * 1024);
  if (unit === "gb") return Math.round(n * 1024 * 1024 * 1024);
  return Math.round(n);
}

async function main() {
  const targetFree = parseBytes(process.env.BLOB_PRUNE_TARGET_FREE || "64mb");
  const mode = String(process.env.BLOB_PRUNE_MODE || "videos").toLowerCase();

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    throw new Error("BLOB_READ_WRITE_TOKEN is required to prune Blob objects.");
  }

  const total = await prisma.mediaAsset.aggregate({ _sum: { bytes: true }, _count: { _all: true } });
  const totalBytes = total._sum.bytes ?? 0;
  console.log(`DB media assets: ${total._count._all}, total bytes: ${totalBytes}`);
  console.log(`Prune mode: ${mode}, target free: ${targetFree} bytes`);

  const baseSelect = {
    id: true,
    url: true,
    sourceUrl: true,
    filename: true,
    bytes: true,
    mimeType: true,
  };

  let candidates;
  if (mode === "variants") {
    const all = await prisma.mediaAsset.findMany({
      orderBy: [{ bytes: "desc" }, { createdAt: "desc" }],
      select: baseSelect,
    });
    candidates = all.filter((m) => {
      if (!m.sourceUrl) return false;
      return canonicalizeWpUploadUrl(m.sourceUrl) !== m.sourceUrl;
    });
  } else {
    const where =
      mode === "videos"
        ? { OR: [{ mimeType: { startsWith: "video/" } }, { filename: { endsWith: ".mp4" } }] }
        : mode === "largest"
          ? {}
          : { OR: [{ mimeType: { startsWith: "video/" } }, { filename: { endsWith: ".mp4" } }] };

    candidates = await prisma.mediaAsset.findMany({
      where,
      orderBy: [{ bytes: "desc" }, { createdAt: "desc" }],
      select: baseSelect,
    });
  }

  let freed = 0;
  for (const item of candidates) {
    if (freed >= targetFree) break;
    const bytes = item.bytes ?? 0;
    if (!item.url) continue;

    let deleted = false;
    for (let attempt = 1; attempt <= 5; attempt++) {
      try {
        await del(item.url);
        deleted = true;
        break;
      } catch (err) {
        const message = String(err?.message ?? err);
        const isRateLimit = message.toLowerCase().includes("too many requests");
        console.warn(`del failed (attempt ${attempt}/5) for ${item.url}`);
        console.warn(message);
        if (!isRateLimit) break;
        const waitSec = 30;
        console.warn(`Rate limited; waiting ${waitSec}s...`);
        await new Promise((r) => setTimeout(r, waitSec * 1000));
      }
    }
    if (!deleted) continue;

    await prisma.mediaAsset.delete({ where: { id: item.id } });
    freed += bytes;
    console.log(
      `Deleted ${item.filename} (${bytes} bytes) ${item.mimeType ?? ""} source=${item.sourceUrl ?? ""}`,
    );
  }

  console.log(`Freed bytes (approx, from DB): ${freed}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
