import { ContentStatus, ContentType } from "@prisma/client";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { put } from "@vercel/blob";
import { prisma } from "@/lib/prisma";
import { normalizePath, updateContentItem, type ContentBlock } from "@/lib/content";
import { getSession } from "@/lib/session";
import Editor from "@/app/admin/(protected)/content/[id]/Editor";

export const dynamic = "force-dynamic";

const formSchema = z.object({
  title: z.string().min(1),
  path: z.string(),
  type: z.nativeEnum(ContentType),
  status: z.nativeEnum(ContentStatus),
  blocksJson: z.string(),
  seoTitle: z.string().optional(),
  seoDesc: z.string().optional(),
});

export default async function AdminEditContentPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams?: { uploaded?: string; uploadError?: string };
}) {
  const item = await prisma.contentItem.findUnique({ where: { id: params.id } });
  if (!item) notFound();

  const blocks = Array.isArray(item.content) ? (item.content as ContentBlock[]) : [];
  const mediaAssets = await prisma.mediaAsset.findMany({
    orderBy: { createdAt: "desc" },
    take: 50,
    select: { id: true, filename: true, url: true },
  });

  async function saveAction(formData: FormData) {
    "use server";
    const parsed = formSchema.safeParse({
      title: String(formData.get("title") ?? ""),
      path: String(formData.get("path") ?? ""),
      type: String(formData.get("type") ?? ""),
      status: String(formData.get("status") ?? ""),
      blocksJson: String(formData.get("blocksJson") ?? "[]"),
      seoTitle: String(formData.get("seoTitle") ?? "") || undefined,
      seoDesc: String(formData.get("seoDesc") ?? "") || undefined,
    });

    if (!parsed.success) redirect(`/admin/content/${params.id}?error=1`);

    const normalized = normalizePath(parsed.data.path);
    let blocks: ContentBlock[] = [];
    try {
      const parsedBlocks = JSON.parse(parsed.data.blocksJson) as unknown;
      if (!Array.isArray(parsedBlocks)) blocks = [];
      else blocks = parsedBlocks.filter(Boolean) as ContentBlock[];
    } catch {
      blocks = [];
    }
    if (blocks.length === 0) blocks = [{ type: "html", html: "" }];
    const publishedAt =
      parsed.data.status === "PUBLISHED" ? new Date() : null;

    await updateContentItem({
      id: params.id,
      type: parsed.data.type,
      path: normalized,
      title: parsed.data.title,
      status: parsed.data.status,
      blocks,
      seoTitle: parsed.data.seoTitle ?? null,
      seoDesc: parsed.data.seoDesc ?? null,
      publishedAt,
    });

    redirect(`/admin/content/${params.id}`);
  }

  async function deleteAction() {
    "use server";
    await prisma.contentItem.delete({ where: { id: params.id } });
    redirect("/admin");
  }

  async function uploadAction(formData: FormData) {
    "use server";
    const session = await getSession();
    if (!session.isLoggedIn) redirect("/admin/login");

    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) {
      redirect(`/admin/content/${params.id}?uploadError=missing`);
    }

    try {
      const key = `blog/media/${Date.now()}-${file.name}`.replaceAll(/\s+/g, "-");
      const blob = await put(key, file, { access: "public" });
      await prisma.mediaAsset.create({
        data: {
          filename: file.name,
          url: blob.url,
          mimeType: file.type || null,
          bytes: file.size,
        },
      });
      redirect(`/admin/content/${params.id}?uploaded=${encodeURIComponent(blob.url)}`);
    } catch (err) {
      console.error(err);
      redirect(`/admin/content/${params.id}?uploadError=failed`);
    }
  }

  const previewUrl =
    item.path === "" ? "/blog/?preview=1" : `/blog/${item.path}/?preview=1`;

  return (
    <main style={{ display: "grid", gap: 12 }}>
      <h1>Edit</h1>
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <a href={previewUrl} target="_blank" rel="noreferrer">
          Preview
        </a>
        <a
          href={item.path === "" ? "/blog/" : `/blog/${item.path}/`}
          target="_blank"
          rel="noreferrer"
        >
          Public
        </a>
        <div style={{ flex: 1 }} />
        <form action={deleteAction}>
          <button type="submit">Delete</button>
        </form>
      </div>

      <form action={saveAction} style={{ display: "grid", gap: 10 }}>
        <label style={{ display: "grid", gap: 6 }}>
          <span>Title</span>
          <input name="title" defaultValue={item.title} required />
        </label>

        <label style={{ display: "grid", gap: 6 }}>
          <span>Path (under /blog)</span>
          <input name="path" defaultValue={item.path} placeholder="e.g. love-and-war" />
        </label>

        <div style={{ display: "flex", gap: 12 }}>
          <label style={{ display: "grid", gap: 6 }}>
            <span>Type</span>
            <select name="type" defaultValue={item.type}>
              <option value="PAGE">PAGE</option>
              <option value="POST">POST</option>
            </select>
          </label>
          <label style={{ display: "grid", gap: 6 }}>
            <span>Status</span>
            <select name="status" defaultValue={item.status}>
              <option value="DRAFT">DRAFT</option>
              <option value="PUBLISHED">PUBLISHED</option>
            </select>
          </label>
        </div>

        <label style={{ display: "grid", gap: 6 }}>
          <span>SEO Title (optional)</span>
          <input name="seoTitle" defaultValue={item.seoTitle ?? ""} />
        </label>
        <label style={{ display: "grid", gap: 6 }}>
          <span>SEO Description (optional)</span>
          <textarea name="seoDesc" defaultValue={item.seoDesc ?? ""} rows={3} />
        </label>

        <label style={{ display: "grid", gap: 6 }}>
          <span>Blocks</span>
          <Editor initialBlocks={blocks} mediaAssets={mediaAssets} />
        </label>

        <button type="submit">Save</button>
      </form>

      <section style={{ display: "grid", gap: 8 }}>
        <h2 style={{ marginTop: 16 }}>Media</h2>
        {searchParams?.uploaded ? (
          <p>
            Uploaded:{" "}
            <a href={searchParams.uploaded} target="_blank" rel="noreferrer">
              {searchParams.uploaded}
            </a>
          </p>
        ) : null}
        {searchParams?.uploadError ? (
          <p style={{ color: "crimson" }}>
            Upload failed. Ensure `BLOB_READ_WRITE_TOKEN` is set.
          </p>
        ) : null}
        <form action={uploadAction} style={{ display: "flex", gap: 8 }}>
          <input type="file" name="file" />
          <button type="submit">Upload</button>
        </form>
      </section>
    </main>
  );
}
