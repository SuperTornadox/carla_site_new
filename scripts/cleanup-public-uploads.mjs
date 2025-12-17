import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";

const uploadsDir = path.join(process.cwd(), "public", "blog", "wp-content", "uploads");
const markerFile = path.join(process.cwd(), "scripts", "generated-media-map.json");

async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const hasReport = await exists(markerFile);
  if (!hasReport) {
    throw new Error(
      `Refusing to delete local uploads because ${path.relative(process.cwd(), markerFile)} does not exist. Run Blob import first.`,
    );
  }

  const hasUploads = await exists(uploadsDir);
  if (!hasUploads) {
    console.log("No local uploads directory to clean.");
    return;
  }

  const report = JSON.parse(await fs.readFile(markerFile, "utf8"));
  const count = Array.isArray(report?.items) ? report.items.length : 0;

  await fs.rm(uploadsDir, { recursive: true, force: true });
  console.log(`Deleted local uploads dir: ${uploadsDir}`);
  console.log(`Blob media map items: ${count}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

