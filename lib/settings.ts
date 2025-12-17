import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";

export async function getSettingJson<T>(key: string): Promise<T | null> {
  const row = await prisma.siteSetting.findUnique({ where: { key } });
  return (row?.value as T | undefined) ?? null;
}

export async function setSettingJson(key: string, value: unknown) {
  const jsonValue = (value === undefined ? null : value) as Prisma.InputJsonValue;
  return prisma.siteSetting.upsert({
    where: { key },
    update: { value: jsonValue },
    create: { key, value: jsonValue },
  });
}

export async function getSettingString(key: string): Promise<string | null> {
  const value = await getSettingJson<unknown>(key);
  return typeof value === "string" ? value : null;
}

export async function setSettingString(key: string, value: string) {
  return setSettingJson(key, value);
}
