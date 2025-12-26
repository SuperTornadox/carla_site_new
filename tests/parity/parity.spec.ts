import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

function readJson(filePath: string) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function normalizeBaseUrl(raw: string) {
  const u = new URL(raw);
  u.pathname = "";
  u.search = "";
  u.hash = "";
  return u.toString().replace(/\/$/, "");
}

function joinUrl(base: string, pathnameWithSearch: string) {
  const u = new URL(pathnameWithSearch, base);
  u.hash = "";
  return u.toString();
}

function safeFilename(input: string) {
  return input.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");
}

async function stabilizePage(page: import("@playwright/test").Page) {
  const maskMedia = process.env.PARITY_MASK_MEDIA === "0" ? false : true;
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        animation: none !important;
        transition: none !important;
        caret-color: transparent !important;
        scroll-behavior: auto !important;
      }
      ${maskMedia ? "img, video, iframe { visibility: hidden !important; }" : ""}
    `,
  });
  await page.evaluate(async () => {
    // @ts-expect-error - fonts is optional in some contexts
    if (document.fonts?.ready) await document.fonts.ready;
  });
  await page.waitForTimeout(Number(process.env.PARITY_SETTLE_MS || "250"));

  // Best-effort: wait for images in main content to settle.
  if (maskMedia) return;
  await page.evaluate(async () => {
    const root = document.querySelector("#content") ?? document.body;
    const imgs = Array.from(root.querySelectorAll("img"));
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const pending = imgs.filter((img) => !img.complete);
      if (!pending.length) return;
      await new Promise((r) => setTimeout(r, 100));
    }
  });
}

async function screenshotForParity(page: import("@playwright/test").Page) {
  const root = page.locator("#page");
  if (await root.count()) {
    return await root.first().screenshot({ timeout: 60_000 });
  }
  return await page.screenshot({ fullPage: true, timeout: 60_000 });
}

test.describe("Legacy vs new visual parity", () => {
  const legacyBaseUrl = normalizeBaseUrl(process.env.LEGACY_BASE_URL ?? "https://carlagannis.com");
  const newBaseUrl = normalizeBaseUrl(process.env.NEW_BASE_URL ?? "http://127.0.0.1:3100");
  const maskMedia = process.env.PARITY_MASK_MEDIA === "0" ? false : true;

  const urlsFile =
    process.env.PARITY_URLS_FILE ??
    path.join(process.cwd(), "tests", "parity", "legacy-urls.json");

  const maxDiffPixelRatio = Number(process.env.PARITY_MAX_DIFF_PIXEL_RATIO ?? "0.005");
  const urlAllow = process.env.PARITY_URL_ALLOW ? new RegExp(process.env.PARITY_URL_ALLOW) : null;
  const urlDeny = process.env.PARITY_URL_DENY ? new RegExp(process.env.PARITY_URL_DENY) : null;
  const limit = process.env.PARITY_URL_LIMIT ? Number(process.env.PARITY_URL_LIMIT) : null;

  const payload = readJson(urlsFile);
  const urls: string[] = Array.isArray(payload.urls) ? payload.urls : [];

  const selected = urls
    .filter((u) => u.startsWith(`${legacyBaseUrl}/blog`))
    .filter((u) => (urlAllow ? urlAllow.test(u) : true))
    .filter((u) => (urlDeny ? !urlDeny.test(u) : true))
    .slice(0, limit ?? urls.length);

  test(`URL inventory (${selected.length})`, async () => {
    expect(selected.length).toBeGreaterThan(0);
  });

  for (const legacyUrl of selected) {
    const legacy = new URL(legacyUrl);
    const pathWithSearch = `${legacy.pathname}${legacy.search}`;
    const newUrl = joinUrl(newBaseUrl, pathWithSearch);

    test(pathWithSearch, async ({ browser }, testInfo) => {
      const ctxLegacy = await browser.newContext();
      const ctxNew = await browser.newContext();

      const legacyPage = await ctxLegacy.newPage();
      const newPage = await ctxNew.newPage();

      try {
        if (maskMedia) {
          const blockTypes = new Set(["image", "media"]);
          await ctxLegacy.route("**/*", (route) => {
            if (blockTypes.has(route.request().resourceType())) return route.abort();
            return route.continue();
          });
          await ctxNew.route("**/*", (route) => {
            if (blockTypes.has(route.request().resourceType())) return route.abort();
            return route.continue();
          });
        }

        const legacyRes = await legacyPage.goto(legacyUrl, { waitUntil: "domcontentloaded" });
        expect(legacyRes?.ok(), `Legacy non-OK: ${legacyRes?.status()}`).toBeTruthy();
        await stabilizePage(legacyPage);

        const newRes = await newPage.goto(newUrl, { waitUntil: "domcontentloaded" });
        expect(newRes?.ok(), `New non-OK: ${newRes?.status()}`).toBeTruthy();
        await stabilizePage(newPage);

        const legacyPng = await screenshotForParity(legacyPage);
        const newPng = await screenshotForParity(newPage);

        // Compare PNG buffers via pixelmatch at runtime to avoid committing thousands of snapshots.
        const { PNG } = await import("pngjs");
        const pixelmatch = (await import("pixelmatch")).default;
        const a0 = PNG.sync.read(legacyPng);
        const b0 = PNG.sync.read(newPng);

        const width = Math.max(a0.width, b0.width);
        const height = Math.max(a0.height, b0.height);

        function padTo(png: any) {
          if (png.width === width && png.height === height) return png;
          const out = new PNG({ width, height });
          // white background makes “missing area” diffs visible
          out.data.fill(255);
          PNG.bitblt(png, out, 0, 0, png.width, png.height, 0, 0);
          return out;
        }

        const a = padTo(a0);
        const b = padTo(b0);
        const diff = new PNG({ width, height });

        const diffPixels = pixelmatch(a.data, b.data, diff.data, width, height, {
          threshold: Number(process.env.PARITY_PIXELMATCH_THRESHOLD || "0.1"),
          includeAA: false,
        });
        const diffRatio = diffPixels / (width * height);

        if (diffRatio > maxDiffPixelRatio) {
          const prefix = safeFilename(`${testInfo.project.name}_${legacy.pathname}`);
          const legacyPath = testInfo.outputPath(`${prefix}.legacy.png`);
          const newPath = testInfo.outputPath(`${prefix}.new.png`);
          const diffPath = testInfo.outputPath(`${prefix}.diff.png`);
          fs.writeFileSync(legacyPath, legacyPng);
          fs.writeFileSync(newPath, newPng);
          fs.writeFileSync(diffPath, PNG.sync.write(diff));

          testInfo.attachments.push({
            name: "legacy",
            path: legacyPath,
            contentType: "image/png",
          });
          testInfo.attachments.push({ name: "new", path: newPath, contentType: "image/png" });
          testInfo.attachments.push({ name: "diff", path: diffPath, contentType: "image/png" });
        }

        expect(diffRatio, `diffRatio=${diffRatio} legacy=${legacyUrl} new=${newUrl}`).toBeLessThanOrEqual(
          maxDiffPixelRatio,
        );
      } finally {
        await legacyPage.close().catch(() => {});
        await newPage.close().catch(() => {});
        await ctxLegacy.close().catch(() => {});
        await ctxNew.close().catch(() => {});
      }
    });
  }
});
