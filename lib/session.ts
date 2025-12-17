import { getIronSession, type SessionOptions } from "iron-session";
import { cookies } from "next/headers";
import { env } from "@/lib/env";

export type SessionData = {
  isLoggedIn: boolean;
  username?: string;
};

const sessionOptions: SessionOptions = {
  cookieName: "carlasite_admin",
  password: env.SESSION_PASSWORD,
  cookieOptions: {
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    httpOnly: true,
  },
};

export async function getSession() {
  const session = await getIronSession<SessionData>(cookies(), sessionOptions);
  if (typeof session.isLoggedIn !== "boolean") session.isLoggedIn = false;
  return session;
}
