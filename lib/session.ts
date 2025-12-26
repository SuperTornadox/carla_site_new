import { getIronSession, type SessionOptions } from "iron-session";
import { cookies } from "next/headers";
import { getAdminEnv } from "@/lib/env";

export type SessionData = {
  isLoggedIn: boolean;
  username?: string;
};

let sessionOptionsCache: SessionOptions | null = null;

function getSessionOptions(): SessionOptions {
  if (sessionOptionsCache) return sessionOptionsCache;
  const adminEnv = getAdminEnv();
  sessionOptionsCache = {
    cookieName: "carlasite_admin",
    password: adminEnv.SESSION_PASSWORD,
    cookieOptions: {
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      httpOnly: true,
    },
  };
  return sessionOptionsCache;
}

export async function getSession() {
  const session = await getIronSession<SessionData>(cookies(), getSessionOptions());
  if (typeof session.isLoggedIn !== "boolean") session.isLoggedIn = false;
  return session;
}
