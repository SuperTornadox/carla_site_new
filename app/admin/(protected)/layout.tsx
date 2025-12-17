import Link from "next/link";
import { redirect } from "next/navigation";
import { ReactNode } from "react";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const session = await getSession();
  if (!session.isLoggedIn) redirect("/admin/login");

  return (
    <div style={{ maxWidth: 1000, margin: "24px auto", padding: 16 }}>
      <header style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <Link href="/admin">Content</Link>
        <Link href="/admin/site">Site</Link>
        <div style={{ flex: 1 }} />
        <form action="/admin/logout" method="post">
          <button type="submit">Logout</button>
        </form>
      </header>
      <hr style={{ margin: "16px 0" }} />
      {children}
    </div>
  );
}
