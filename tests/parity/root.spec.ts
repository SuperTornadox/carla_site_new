import { test, expect } from "@playwright/test";
import fs from "node:fs";

function normalizeBaseUrl(raw: string) {
  const u = new URL(raw);
  u.pathname = "";
  u.search = "";
  u.hash = "";
  return u.toString().replace(/\/$/, "");
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
}

async function screenshotForParity(page: import("@playwright/test").Page) {
  const root = page.locator("body");
  return await root.first().screenshot({ timeout: 60_000 });
}

test("Root page visual parity", async ({ browser }, testInfo) => {
  const legacyBaseUrl = normalizeBaseUrl(process.env.LEGACY_BASE_URL ?? "https://carlagannis.com");
  const newBaseUrl = normalizeBaseUrl(process.env.NEW_BASE_URL ?? "http://127.0.0.1:3100");
  const maskMedia = process.env.PARITY_MASK_MEDIA === "0" ? false : true;

  const legacyUrl = `${legacyBaseUrl}/`;
  const newUrl = `${newBaseUrl}/`;

  const maxDiffPixelRatio = Number(process.env.PARITY_MAX_DIFF_PIXEL_RATIO ?? "0.005");

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

    const { PNG } = await import("pngjs");
    const pixelmatch = (await import("pixelmatch")).default;

    const a0 = PNG.sync.read(legacyPng);
    const b0 = PNG.sync.read(newPng);
    const width = Math.max(a0.width, b0.width);
    const height = Math.max(a0.height, b0.height);

    function padTo(png: any) {
      if (png.width === width && png.height === height) return png;
      const out = new PNG({ width, height });
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
      const legacyPath = testInfo.outputPath(`root.legacy.png`);
      const newPath = testInfo.outputPath(`root.new.png`);
      const diffPath = testInfo.outputPath(`root.diff.png`);
      fs.writeFileSync(legacyPath, legacyPng);
      fs.writeFileSync(newPath, newPng);
      fs.writeFileSync(diffPath, PNG.sync.write(diff));
      testInfo.attachments.push({ name: "legacy", path: legacyPath, contentType: "image/png" });
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
