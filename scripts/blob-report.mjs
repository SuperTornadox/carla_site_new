import "dotenv/config";
import { list } from "@vercel/blob";

async function main() {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    throw new Error("BLOB_READ_WRITE_TOKEN is required.");
  }

  let cursor = undefined;
  let totalBytes = 0;
  let count = 0;
  for (;;) {
    const r = await list({ cursor, limit: 1000, prefix: "blog/" });
    for (const b of r.blobs) {
      totalBytes += b.size || 0;
      count++;
    }
    if (!r.hasMore) break;
    cursor = r.cursor;
  }

  console.log(JSON.stringify({ count, totalBytes }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

