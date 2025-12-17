import { ContentStatus, ContentType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import crypto from "node:crypto";

export type ContentBlock =
  | { type: "html"; html: string }
  | { type: "image"; src: string; alt?: string; width?: number; height?: number };

export function normalizePath(input: string) {
  const trimmed = input.trim();
  if (trimmed === "/") return "";
  return trimmed.replace(/^\/+/, "").replace(/\/+$/, "");
}

export async function getContentItemByPath(path: string, opts?: { includeDraft?: boolean }) {
  const normalized = normalizePath(path);
  const item = await prisma.contentItem.findUnique({ where: { path: normalized } });
  if (!item) return null;
  if (item.status === ContentStatus.PUBLISHED) return item;
  if (opts?.includeDraft) return item;
  return null;
}

export async function listContentItems() {
  return prisma.contentItem.findMany({ orderBy: { updatedAt: "desc" } });
}

export async function createContentItem() {
  const suffix = crypto.randomUUID().slice(0, 8);
  return prisma.contentItem.create({
    data: {
      type: ContentType.PAGE,
      path: `untitled-${suffix}`,
      title: "Untitled",
      status: ContentStatus.DRAFT,
      content: [{ type: "html", html: "" }] satisfies ContentBlock[],
    },
  });
}

export async function updateContentItem(params: {
  id: string;
  type: ContentType;
  path: string;
  title: string;
  status: ContentStatus;
  blocks: ContentBlock[];
  seoTitle?: string | null;
  seoDesc?: string | null;
  publishedAt?: Date | null;
}) {
  const normalizedPath = normalizePath(params.path);
  return prisma.contentItem.update({
    where: { id: params.id },
    data: {
      type: params.type,
      path: normalizedPath,
      title: params.title,
      status: params.status,
      content: params.blocks,
      seoTitle: params.seoTitle ?? null,
      seoDesc: params.seoDesc ?? null,
      publishedAt: params.publishedAt ?? null,
    },
  });
}
