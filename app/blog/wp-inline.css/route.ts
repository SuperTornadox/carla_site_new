import { NextResponse } from "next/server";
import { getBlogInlineCss } from "@/lib/blogFragments";

export const dynamic = "force-dynamic";

export async function GET() {
  const css = (await getBlogInlineCss()) ?? "";
  return new NextResponse(css, {
    headers: {
      "content-type": "text/css; charset=utf-8",
      "cache-control": "public, max-age=0, must-revalidate",
    },
  });
}

