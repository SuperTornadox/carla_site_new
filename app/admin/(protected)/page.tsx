import Link from "next/link";
import { redirect } from "next/navigation";
import { createContentItem, listContentItems } from "@/lib/content";

export const dynamic = "force-dynamic";

export default async function AdminContentListPage() {
  const items = await listContentItems();

  async function createAction() {
    "use server";
    const item = await createContentItem();
    redirect(`/admin/content/${item.id}`);
  }

  return (
    <main>
      <h1>Content</h1>
      <form action={createAction}>
        <button type="submit">New</button>
      </form>
      <div style={{ height: 12 }} />
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th align="left">Title</th>
            <th align="left">Path</th>
            <th align="left">Type</th>
            <th align="left">Status</th>
            <th align="left">Updated</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id} style={{ borderTop: "1px solid #ddd" }}>
              <td style={{ padding: "8px 0" }}>
                <Link href={`/admin/content/${item.id}`}>{item.title}</Link>
              </td>
              <td style={{ padding: "8px 0" }}>
                <code>{item.path || "(home)"}</code>
              </td>
              <td style={{ padding: "8px 0" }}>{item.type}</td>
              <td style={{ padding: "8px 0" }}>{item.status}</td>
              <td style={{ padding: "8px 0" }}>
                {new Date(item.updatedAt).toLocaleString()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
