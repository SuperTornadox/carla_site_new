import { NextResponse } from "next/server";
import { getBlogInlineCss, getBlogInlineCssPost, getBlogInlineCssPre } from "@/lib/blogFragments";

export const dynamic = "force-dynamic";

export async function GET() {
  const combinedFromDb = await getBlogInlineCss();
  const pre = (await getBlogInlineCssPre()) ?? "";
  const post = (await getBlogInlineCssPost()) ?? "";
  const css = combinedFromDb ?? `${pre}\n\n${post}`.trim();
  return new NextResponse(css, {
    headers: {
      "content-type": "text/css; charset=utf-8",
      "cache-control": "public, max-age=0, must-revalidate",
    },
  });
}
