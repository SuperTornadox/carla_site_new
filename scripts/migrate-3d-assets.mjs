import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { put } from "@vercel/blob";

const prisma = new PrismaClient();

// Pattern to match 3D asset URLs from carlagannis.com
const ASSET_URL_PATTERN = /https?:\/\/carlagannis\.com\/website_overhaul\/[^"'\s<>]+\.(glb|gltf|hdr|jpg|jpeg|png|webp)/gi;

async function downloadAsset(url) {
  console.log(`Downloading: ${url}`);

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) {
        console.warn(`Failed to download (${res.status}): ${url}`);
        return null;
      }
      const contentType = res.headers.get("content-type") || undefined;
      const arrayBuffer = await res.arrayBuffer();
      return { arrayBuffer, contentType };
    } catch (err) {
      const waitMs = attempt === 1 ? 500 : attempt === 2 ? 1500 : 3000;
      console.warn(`Fetch failed (attempt ${attempt}/3), retrying in ${waitMs}ms: ${url}`);
      console.warn(err?.message ?? err);
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }

  console.warn(`Permanently failed to download: ${url}`);
  return null;
}

async function uploadToBlob(url, arrayBuffer, contentType) {
  // Extract path from URL: website_overhaul/wwwunderkammer/file.glb -> 3d-assets/wwwunderkammer/file.glb
  const urlObj = new URL(url);
  const pathParts = urlObj.pathname.split('/').filter(Boolean);

  // Remove 'website_overhaul' and create new path
  const idx = pathParts.indexOf('website_overhaul');
  const relativePath = pathParts.slice(idx + 1).join('/');
  const blobKey = `blog/3d-assets/${relativePath}`;

  console.log(`Uploading to Blob: ${blobKey}`);

  try {
    const blob = await put(blobKey, new Blob([arrayBuffer], { type: contentType }), {
      access: "public",
      contentType,
      addRandomSuffix: false,
      allowOverwrite: true,
    });

    // Store in MediaAsset for tracking
    await prisma.mediaAsset.upsert({
      where: { sourceUrl: url },
      update: {
        provider: "vercel-blob",
        key: blobKey,
        url: blob.url,
        mimeType: contentType ?? null,
        bytes: arrayBuffer.byteLength,
      },
      create: {
        sourceUrl: url,
        provider: "vercel-blob",
        key: blobKey,
        filename: relativePath.split('/').pop() || 'file',
        url: blob.url,
        mimeType: contentType ?? null,
        bytes: arrayBuffer.byteLength,
      },
    });

    return blob.url;
  } catch (err) {
    console.error(`Failed to upload to Blob: ${url}`, err?.message ?? err);
    return null;
  }
}

async function main() {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    throw new Error("BLOB_READ_WRITE_TOKEN is required");
  }

  console.log("Fetching all content items from database...");

  // Get all content items
  const items = await prisma.contentItem.findMany({
    select: {
      id: true,
      path: true,
      content: true,
    },
  });

  console.log(`Found ${items.length} content items`);

  // Collect all unique 3D asset URLs
  const allAssetUrls = new Set();
  const itemsWithAssets = [];

  for (const item of items) {
    const contentStr = JSON.stringify(item.content);
    const matches = contentStr.match(ASSET_URL_PATTERN);

    if (matches && matches.length > 0) {
      console.log(`Found ${matches.length} 3D asset URLs in: ${item.path || '(home)'}`);
      itemsWithAssets.push(item);
      for (const url of matches) {
        allAssetUrls.add(url);
      }
    }
  }

  if (allAssetUrls.size === 0) {
    console.log("No 3D asset URLs found in database");
    return;
  }

  console.log(`\nFound ${allAssetUrls.size} unique 3D asset URLs to migrate:`);
  for (const url of allAssetUrls) {
    console.log(`  - ${url}`);
  }

  // Download and upload each asset
  const urlMap = new Map(); // sourceUrl -> blobUrl

  for (const sourceUrl of allAssetUrls) {
    // Check if already migrated
    const existing = await prisma.mediaAsset.findFirst({
      where: { sourceUrl },
      select: { url: true },
    });

    if (existing?.url?.includes('.blob.vercel-storage.com')) {
      console.log(`Already migrated: ${sourceUrl} -> ${existing.url}`);
      urlMap.set(sourceUrl, existing.url);
      continue;
    }

    const downloaded = await downloadAsset(sourceUrl);
    if (!downloaded) continue;

    const blobUrl = await uploadToBlob(sourceUrl, downloaded.arrayBuffer, downloaded.contentType);
    if (blobUrl) {
      urlMap.set(sourceUrl, blobUrl);
      console.log(`Migrated: ${sourceUrl} -> ${blobUrl}`);
    }
  }

  // Update content in database
  console.log("\nUpdating database content with new URLs...");

  let updatedCount = 0;
  for (const item of itemsWithAssets) {
    let contentStr = JSON.stringify(item.content);
    let changed = false;

    for (const [sourceUrl, blobUrl] of urlMap) {
      if (contentStr.includes(sourceUrl)) {
        contentStr = contentStr.split(sourceUrl).join(blobUrl);
        changed = true;
      }
    }

    if (changed) {
      const newContent = JSON.parse(contentStr);
      await prisma.contentItem.update({
        where: { id: item.id },
        data: { content: newContent },
      });
      console.log(`Updated content: ${item.path || '(home)'}`);
      updatedCount++;
    }
  }

  console.log(`\n=== Migration Complete ===`);
  console.log(`Assets migrated: ${urlMap.size}`);
  console.log(`Content items updated: ${updatedCount}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
