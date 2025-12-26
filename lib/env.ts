import { z } from "zod";

const baseEnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
});

const adminEnvSchema = z.object({
  SESSION_PASSWORD: z.string().min(32),
  ADMIN_USERNAME: z.string().min(1),
  ADMIN_PASSWORD: z.string().min(1),
});

let baseEnvCache: z.infer<typeof baseEnvSchema> | null = null;
let adminEnvCache: z.infer<typeof adminEnvSchema> | null = null;

export function getBaseEnv() {
  if (baseEnvCache) return baseEnvCache;
  baseEnvCache = baseEnvSchema.parse({
    DATABASE_URL: process.env.DATABASE_URL,
  });
  return baseEnvCache;
}

export function getAdminEnv() {
  if (adminEnvCache) return adminEnvCache;
  adminEnvCache = adminEnvSchema.parse({
    SESSION_PASSWORD: process.env.SESSION_PASSWORD,
    ADMIN_USERNAME: process.env.ADMIN_USERNAME,
    ADMIN_PASSWORD: process.env.ADMIN_PASSWORD,
  });
  return adminEnvCache;
}
