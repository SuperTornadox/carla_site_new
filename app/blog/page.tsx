import { notFound } from "next/navigation";
import BlogBodyClass from "@/app/blog/BlogBodyClass";
import HtmlContent from "@/app/blog/HtmlContent";
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
  // Back-compat: imported blocks may omit `type` and only provide `html`.
  if ((value.type === undefined || value.type === "html") && typeof value.html === "string") {
    return { type: "html", html: value.html };
  }
  // Back-compat: allow `{ src: string }` without a `type`.
  if ((value.type === "image" || value.type === undefined) && typeof value.src === "string") {
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

function sanitizeWpContentHtml(html: string) {
  return (
    html
      // We only migrate originals; WordPress `srcset` references size variants we don't serve.
      .replace(/\s+srcset=(["'])[\s\S]*?\1/gi, "")
      .replace(/\s+sizes=(["'])[\s\S]*?\1/gi, "")
      // Add lazy loading and async decoding to all images for better performance
      .replace(/<img\s+/gi, '<img loading="lazy" decoding="async" ')
  );
}

export default async function BlogHomePage({
  searchParams,
}: {
  searchParams?: { preview?: string };
}) {
  let includeDraft = false;
  if (searchParams?.preview === "1") {
    try {
      const session = await getSession();
      includeDraft = session.isLoggedIn;
    } catch {
      includeDraft = false;
    }
  }

  const item = await getContentItemByPath("", { includeDraft });
  if (!item) notFound();

  const bodyClass = item.legacyBodyClass?.trim()
    ? item.legacyBodyClass
    : buildBodyClass(item.legacyWpId);
  const innerHtml = sanitizeWpContentHtml(renderBlocksToHtml(item.content));

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
      <HtmlContent html={articleHtml} />
    </>
  );
}

export async function generateMetadata({
  searchParams,
}: {
  searchParams?: { preview?: string };
}): Promise<Metadata> {
  let includeDraft = false;
  if (searchParams?.preview === "1") {
    try {
      const session = await getSession();
      includeDraft = session.isLoggedIn;
    } catch {
      includeDraft = false;
    }
  }
  const item = await getContentItemByPath("", { includeDraft });
  if (!item) return {};
  return {
    title: item.seoTitle ?? item.title,
    description: item.seoDesc ?? undefined,
    alternates: { canonical: "/blog/" },
  };
}
