import { notFound } from "next/navigation";
import BlogBodyClass from "@/app/blog/BlogBodyClass";
import { getContentItemByPath } from "@/lib/content";
import { getSession } from "@/lib/session";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";

function buildBodyClass(legacyWpId?: number | null) {
  const base =
    "home wp-singular page-template-default page custom-background wp-embed-responsive wp-theme-freedom-pro no-sidebar-full-width wide";
  return legacyWpId ? `${base} page-id-${legacyWpId}` : base;
}

type ContentBlock =
  | { type: "html"; html: string }
  | { type: "image"; src: string; alt?: string; width?: number; height?: number };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asContentBlock(value: unknown): ContentBlock | null {
  if (!isRecord(value)) return null;
  if (value.type === "html" && typeof value.html === "string") {
    return { type: "html", html: value.html };
  }
  if (value.type === "image" && typeof value.src === "string") {
    return {
      type: "image",
      src: value.src,
      alt: typeof value.alt === "string" ? value.alt : undefined,
      width: typeof value.width === "number" ? value.width : undefined,
      height: typeof value.height === "number" ? value.height : undefined,
    };
  }
  return null;
}

function renderBlocksToHtml(blocks: unknown) {
  if (!Array.isArray(blocks)) return "";
  return blocks
    .map((raw) => {
      const block = asContentBlock(raw);
      if (!block) return "";
      if (block.type === "html") return block.html;
      const wh =
        typeof block.width === "number" && typeof block.height === "number"
          ? ` width="${block.width}" height="${block.height}"`
          : "";
      return `<img src="${block.src}" alt="${block.alt ?? ""}"${wh} />`;
    })
    .join("\n");
}

export default async function BlogHomePage({
  searchParams,
}: {
  searchParams?: { preview?: string };
}) {
  const session = await getSession();
  const includeDraft = searchParams?.preview === "1" && session.isLoggedIn;

  const item = await getContentItemByPath("", { includeDraft });
  if (!item) notFound();

  const bodyClass = buildBodyClass(item.legacyWpId);
  const innerHtml = renderBlocksToHtml(item.content);

  const articleHtml = `
<article id="post-${item.legacyWpId ?? "0"}" class="post-${
    item.legacyWpId ?? "0"
  } page type-page status-${item.status.toLowerCase()} hentry">
  <header class="entry-header">
    <h1 class="entry-title">${item.title}</h1>
  </header>
  <div class="entry-content clearfix">
    ${innerHtml}
  </div>
</article>`;

  return (
    <>
      <BlogBodyClass className={bodyClass} />
      <div dangerouslySetInnerHTML={{ __html: articleHtml }} />
    </>
  );
}

export async function generateMetadata({
  searchParams,
}: {
  searchParams?: { preview?: string };
}): Promise<Metadata> {
  const session = await getSession();
  const includeDraft = searchParams?.preview === "1" && session.isLoggedIn;
  const item = await getContentItemByPath("", { includeDraft });
  if (!item) return {};
  return {
    title: item.seoTitle ?? item.title,
    description: item.seoDesc ?? undefined,
    alternates: { canonical: "/blog/" },
  };
}
