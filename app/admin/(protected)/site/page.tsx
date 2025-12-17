import { redirect } from "next/navigation";
import { getBlogFooterHtml, getBlogHeaderHtml, getBlogInlineCss } from "@/lib/blogFragments";
import { setSettingString } from "@/lib/settings";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function AdminSiteSettingsPage({
  searchParams,
}: {
  searchParams?: { saved?: string };
}) {
  const headerHtml = (await getBlogHeaderHtml()) ?? "";
  const footerHtml = (await getBlogFooterHtml()) ?? "";
  const inlineCss = (await getBlogInlineCss()) ?? "";

  async function saveAction(formData: FormData) {
    "use server";
    const header = String(formData.get("headerHtml") ?? "");
    const footer = String(formData.get("footerHtml") ?? "");
    const css = String(formData.get("inlineCss") ?? "");

    await setSettingString("blog.headerHtml", header);
    await setSettingString("blog.footerHtml", footer);
    await setSettingString("blog.inlineCss", css);
    redirect("/admin/site?saved=1");
  }

  async function resetToFilesAction() {
    "use server";
    await prisma.siteSetting.deleteMany({
      where: { key: { in: ["blog.headerHtml", "blog.footerHtml", "blog.inlineCss"] } },
    });
    redirect("/admin/site?saved=1");
  }

  return (
    <main style={{ display: "grid", gap: 12 }}>
      <h1>Site Settings</h1>
      {searchParams?.saved ? <p>Saved.</p> : null}

      <form action={saveAction} style={{ display: "grid", gap: 10 }}>
        <label style={{ display: "grid", gap: 6 }}>
          <span>Blog Header HTML</span>
          <textarea name="headerHtml" defaultValue={headerHtml} rows={14} />
        </label>
        <label style={{ display: "grid", gap: 6 }}>
          <span>Blog Footer HTML</span>
          <textarea name="footerHtml" defaultValue={footerHtml} rows={10} />
        </label>
        <label style={{ display: "grid", gap: 6 }}>
          <span>Inline CSS (served at /blog/wp-inline.css)</span>
          <textarea name="inlineCss" defaultValue={inlineCss} rows={18} />
        </label>
        <button type="submit">Save</button>
      </form>

      <form action={resetToFilesAction}>
        <button type="submit">Reset to synced files</button>
      </form>
    </main>
  );
}

