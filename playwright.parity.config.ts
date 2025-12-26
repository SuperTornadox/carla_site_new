import { defineConfig } from "@playwright/test";

const legacyBaseUrl = process.env.LEGACY_BASE_URL ?? "https://carlagannis.com";
const newBaseUrl = process.env.NEW_BASE_URL ?? "http://127.0.0.1:3100";

export default defineConfig({
  testDir: "./tests/parity",
  timeout: 180_000,
  expect: { timeout: 30_000 },
  reporter: [
    ["./tests/parity/progressReporter.ts"],
    ["list"],
    ["html", { open: "never" }],
  ],
  use: {
    // Tests compare 2 sites; keep baseURL unused to avoid confusion.
    trace: "retain-on-failure",
  },
  metadata: {
    legacyBaseUrl,
    newBaseUrl,
  },
  workers: Number(process.env.PARITY_WORKERS || "4"),
  projects: [
    { name: "desktop", use: { browserName: "chromium", viewport: { width: 1440, height: 900 } } },
    { name: "tablet", use: { browserName: "chromium", viewport: { width: 834, height: 1112 } } },
    { name: "mobile", use: { browserName: "chromium", viewport: { width: 390, height: 844 } } },
  ],
});
