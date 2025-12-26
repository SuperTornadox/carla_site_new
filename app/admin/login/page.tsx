import { redirect } from "next/navigation";
import crypto from "node:crypto";
import { getAdminEnv } from "@/lib/env";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

function safeEqual(a: string, b: string) {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams?: { error?: string };
}) {
  try {
    getAdminEnv();
  } catch (err) {
    return (
      <main style={{ maxWidth: 720, margin: "40px auto", padding: 16 }}>
        <h1>Admin not configured</h1>
        <p style={{ color: "crimson" }}>
          Admin auth requires <code>SESSION_PASSWORD</code> (min 32 chars),{" "}
          <code>ADMIN_USERNAME</code>, and <code>ADMIN_PASSWORD</code>.
        </p>
        <pre style={{ whiteSpace: "pre-wrap" }}>{String(err)}</pre>
      </main>
    );
  }

  const session = await getSession();
  if (session.isLoggedIn) redirect("/admin");

  async function loginAction(formData: FormData) {
    "use server";
    const adminEnv = getAdminEnv();
    const username = String(formData.get("username") ?? "");
    const password = String(formData.get("password") ?? "");

    const ok =
      safeEqual(username, adminEnv.ADMIN_USERNAME) &&
      safeEqual(password, adminEnv.ADMIN_PASSWORD);
    if (!ok) redirect("/admin/login?error=1");

    const s = await getSession();
    s.isLoggedIn = true;
    s.username = username;
    await s.save();
    redirect("/admin");
  }

  return (
    <main style={{ maxWidth: 420, margin: "40px auto", padding: 16 }}>
      <h1>Admin Login</h1>
      {searchParams?.error ? (
        <p style={{ color: "crimson" }}>Invalid credentials.</p>
      ) : null}
      <form action={loginAction} style={{ display: "grid", gap: 12 }}>
        <label style={{ display: "grid", gap: 6 }}>
          <span>Username</span>
          <input name="username" autoComplete="username" required />
        </label>
        <label style={{ display: "grid", gap: 6 }}>
          <span>Password</span>
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
        </label>
        <button type="submit">Sign in</button>
      </form>
    </main>
  );
}
