import "dotenv/config";

import fs from "node:fs";
import path from "node:path";

import { chromium } from "playwright";

function normalizeBaseUrl(raw) {
  const u = new URL(raw);
  u.pathname = "";
  u.search = "";
  u.hash = "";
  return u.toString().replace(/\/$/, "");
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function safeFilename(input) {
  return input.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");
}

async function stabilizePage(page) {
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        animation: none !important;
        transition: none !important;
        caret-color: transparent !important;
        scroll-behavior: auto !important;
      }
    `,
  });
  await page.evaluate(async () => {
    // @ts-expect-error - fonts is optional in some contexts
    if (document.fonts?.ready) await document.fonts.ready;
  });
  await page.waitForTimeout(250);
}

function diffObjects(a, b) {
  const out = {};
  const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
  for (const k of keys) {
    const av = a?.[k];
    const bv = b?.[k];
    if (av !== bv) out[k] = { legacy: av, new: bv };
  }
  return out;
}

async function main() {
  const legacyBaseUrl = normalizeBaseUrl(process.env.LEGACY_BASE_URL ?? "https://carlagannis.com");
  const newBaseUrl = normalizeBaseUrl(process.env.NEW_BASE_URL ?? "http://127.0.0.1:3100");

  const urlsFile =
    process.env.PARITY_URLS_FILE ??
    path.join(process.cwd(), "tests", "parity", "legacy-urls.json");

  const outDir = path.resolve(process.cwd(), process.env.PARITY_STYLE_OUT_DIR ?? "test-results/parity-style");
  fs.mkdirSync(outDir, { recursive: true });

  const payload = readJson(urlsFile);
  const urls = Array.isArray(payload.urls) ? payload.urls : [];

  const urlAllow = process.env.PARITY_URL_ALLOW ? new RegExp(process.env.PARITY_URL_ALLOW) : null;
  const urlDeny = process.env.PARITY_URL_DENY ? new RegExp(process.env.PARITY_URL_DENY) : null;
  const limit = process.env.PARITY_URL_LIMIT ? Number(process.env.PARITY_URL_LIMIT) : null;

  const selected = urls
    .filter((u) => u.startsWith(`${legacyBaseUrl}/blog`))
    .filter((u) => (urlAllow ? urlAllow.test(u) : true))
    .filter((u) => (urlDeny ? !urlDeny.test(u) : true))
    .slice(0, limit ?? urls.length);

  const viewports = [
    { name: "desktop", width: 1440, height: 900 },
    { name: "tablet", width: 834, height: 1112 },
    { name: "mobile", width: 390, height: 844 },
  ];

  const selectors = (process.env.PARITY_STYLE_SELECTORS
    ? process.env.PARITY_STYLE_SELECTORS.split(",")
    : [
        "body",
        "#page",
        "#masthead",
        "#site-navigation",
        "#main",
        "#content",
        ".inner-wrap",
        ".entry-title",
        ".entry-content",
      ]
  ).map((s) => s.trim()).filter(Boolean);

  const styleProps = (process.env.PARITY_STYLE_PROPS
    ? process.env.PARITY_STYLE_PROPS.split(",")
    : [
        "display",
        "position",
        "fontFamily",
        "fontSize",
        "fontWeight",
        "fontStyle",
        "lineHeight",
        "letterSpacing",
        "textTransform",
        "color",
        "backgroundColor",
        "textAlign",
        "maxWidth",
        "width",
        "marginTop",
        "marginRight",
        "marginBottom",
        "marginLeft",
        "paddingTop",
        "paddingRight",
        "paddingBottom",
        "paddingLeft",
      ]
  ).map((p) => p.trim()).filter(Boolean);

  const browser = await chromium.launch({ headless: true });
  const summary = [];

  try {
    for (const url of selected) {
      const legacy = new URL(url);
      const pathWithSearch = `${legacy.pathname}${legacy.search}`;
      const newUrl = new URL(pathWithSearch, newBaseUrl).toString();

      for (const vp of viewports) {
        const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
        const legacyPage = await context.newPage();
        const newPage = await context.newPage();

        try {
          const legacyRes = await legacyPage.goto(url, { waitUntil: "domcontentloaded" });
          const newRes = await newPage.goto(newUrl, { waitUntil: "domcontentloaded" });

          await stabilizePage(legacyPage);
          await stabilizePage(newPage);

          const extract = async (page) =>
            await page.evaluate(
              ({ selectors, styleProps }) => {
                function pick(obj, keys) {
                  const out = {};
                  for (const k of keys) out[k] = obj[k];
                  return out;
                }
                const results = {};
                for (const sel of selectors) {
                  const el = document.querySelector(sel);
                  if (!el) {
                    results[sel] = { present: false };
                    continue;
                  }
                  const cs = getComputedStyle(el);
                  const rect = el.getBoundingClientRect();
                  results[sel] = {
                    present: true,
                    rect: {
                      x: rect.x,
                      y: rect.y,
                      width: rect.width,
                      height: rect.height,
                      top: rect.top,
                      left: rect.left,
                      right: rect.right,
                      bottom: rect.bottom,
                    },
                    style: pick(cs, styleProps),
                  };
                }
                return results;
              },
              { selectors, styleProps },
            );

          const legacyData = await extract(legacyPage);
          const newData = await extract(newPage);

          const diffs = {};
          for (const sel of selectors) {
            const a = legacyData[sel];
            const b = newData[sel];
            if (!a?.present || !b?.present) {
              if (!!a?.present !== !!b?.present) diffs[sel] = { present: { legacy: !!a?.present, new: !!b?.present } };
              continue;
            }
            const rectDiff = diffObjects(a.rect, b.rect);
            const styleDiff = diffObjects(a.style, b.style);
            if (Object.keys(rectDiff).length || Object.keys(styleDiff).length) {
              diffs[sel] = { rect: rectDiff, style: styleDiff };
            }
          }

          const record = {
            viewport: vp,
            legacyUrl: url,
            newUrl,
            status: { legacy: legacyRes?.status() ?? 0, new: newRes?.status() ?? 0 },
            selectors,
            styleProps,
            legacy: legacyData,
            new: newData,
            diffs,
          };

          const fileName = safeFilename(`${vp.name}_${legacy.pathname}`);
          const outPath = path.join(outDir, `${fileName}.json`);
          fs.writeFileSync(outPath, JSON.stringify(record, null, 2), "utf8");

          summary.push({
            viewport: vp.name,
            path: legacy.pathname,
            diffs: Object.keys(diffs).length,
            outPath,
          });
        } finally {
          await legacyPage.close().catch(() => {});
          await newPage.close().catch(() => {});
          await context.close().catch(() => {});
        }
      }
    }
  } finally {
    await browser.close().catch(() => {});
  }

  const summaryPath = path.join(outDir, "_summary.json");
  fs.writeFileSync(summaryPath, JSON.stringify({ generatedAt: new Date().toISOString(), legacyBaseUrl, newBaseUrl, count: summary.length, summary }, null, 2));
  process.stdout.write(`Wrote ${summary.length} reports to ${outDir}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

