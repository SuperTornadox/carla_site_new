import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const path = process.argv[2] || "the-garden-of-emoji-delights";

  const item = await prisma.contentItem.findFirst({
    where: { path },
    select: { id: true, path: true, title: true, content: true }
  });

  if (item) {
    console.log("Title:", item.title);
    console.log("Path:", item.path);
    console.log("\nContent preview (first 3000 chars):");
    console.log(JSON.stringify(item.content, null, 2).substring(0, 3000));
  } else {
    console.log("Page not found for path:", path);
  }
}

main().finally(() => prisma.$disconnect());
