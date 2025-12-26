import { test, expect } from "@playwright/test";

test("health endpoint responds", async ({ request }) => {
  const res = await request.get("/health");
  expect(res.ok()).toBeTruthy();
  await expect(res.json()).resolves.toMatchObject({ ok: true });
});

test("blog home renders", async ({ page }) => {
  await page.goto("/blog/");
  await expect(page.locator("#page")).toBeVisible();
  await expect(page.locator("#masthead")).toBeVisible();
  await expect(page.locator("#content")).toBeVisible();
});

test("root home renders", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("CARLA GANNIS STUDIO")).toBeVisible();
  await expect(page.getByRole("link", { name: "ENTER" })).toHaveAttribute("href", "/blog/");
});

test("blog home link routes to root", async ({ page }) => {
  await page.goto("/blog/");
  await expect(page.locator("#site-title a")).toHaveAttribute("href", "/");
  await expect(page.locator("#menu-item-2506 a")).toHaveAttribute("href", "/");
});

test("admin login renders", async ({ page }) => {
  await page.goto("/admin/login");
  await expect(page.getByRole("heading", { name: "Admin Login" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
});
