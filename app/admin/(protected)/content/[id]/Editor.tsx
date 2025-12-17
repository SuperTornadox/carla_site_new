"use client";

import { useMemo, useState } from "react";

type ContentBlock =
  | { type: "html"; html: string }
  | { type: "image"; src: string; alt?: string; width?: number; height?: number };

type MediaAsset = {
  id: string;
  filename: string;
  url: string;
};

function clampInt(value: string) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

export default function Editor({
  initialBlocks,
  mediaAssets,
}: {
  initialBlocks: ContentBlock[];
  mediaAssets: MediaAsset[];
}) {
  const [blocks, setBlocks] = useState<ContentBlock[]>(
    initialBlocks.length ? initialBlocks : [{ type: "html", html: "" }],
  );

  const serialized = useMemo(() => JSON.stringify(blocks), [blocks]);

  function addHtml() {
    setBlocks((prev) => [...prev, { type: "html", html: "" }]);
  }

  function addImage() {
    setBlocks((prev) => [...prev, { type: "image", src: "", alt: "" }]);
  }

  function move(index: number, dir: -1 | 1) {
    setBlocks((prev) => {
      const next = [...prev];
      const to = index + dir;
      if (to < 0 || to >= next.length) return prev;
      const tmp = next[index];
      next[index] = next[to];
      next[to] = tmp;
      return next;
    });
  }

  function remove(index: number) {
    setBlocks((prev) => prev.filter((_, i) => i !== index));
  }

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <input type="hidden" name="blocksJson" value={serialized} />

      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" onClick={addHtml}>
          + HTML
        </button>
        <button type="button" onClick={addImage}>
          + Image
        </button>
      </div>

      {blocks.map((block, i) => (
        <div
          key={i}
          style={{
            border: "1px solid #ddd",
            borderRadius: 6,
            padding: 10,
            display: "grid",
            gap: 8,
          }}
        >
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <strong style={{ textTransform: "uppercase" }}>{block.type}</strong>
            <div style={{ flex: 1 }} />
            <button type="button" onClick={() => move(i, -1)} disabled={i === 0}>
              ↑
            </button>
            <button
              type="button"
              onClick={() => move(i, 1)}
              disabled={i === blocks.length - 1}
            >
              ↓
            </button>
            <button type="button" onClick={() => remove(i)} disabled={blocks.length <= 1}>
              Remove
            </button>
          </div>

          {block.type === "html" ? (
            <label style={{ display: "grid", gap: 6 }}>
              <span>HTML</span>
              <textarea
                value={block.html}
                onChange={(e) => {
                  const html = e.target.value;
                  setBlocks((prev) =>
                    prev.map((b, idx) => (idx === i ? { type: "html", html } : b)),
                  );
                }}
                rows={10}
              />
            </label>
          ) : (
            <>
              <label style={{ display: "grid", gap: 6 }}>
                <span>Image URL</span>
                <input
                  value={block.src}
                  onChange={(e) => {
                    const src = e.target.value;
                    setBlocks((prev) =>
                      prev.map((b, idx) => (idx === i ? { ...b, src } : b)),
                    );
                  }}
                  placeholder="https://... or /blog/wp-content/uploads/..."
                />
              </label>

              {mediaAssets.length ? (
                <label style={{ display: "grid", gap: 6 }}>
                  <span>Pick from uploaded media</span>
                  <select
                    value=""
                    onChange={(e) => {
                      const url = e.target.value;
                      if (!url) return;
                      setBlocks((prev) =>
                        prev.map((b, idx) => (idx === i ? { ...b, src: url } : b)),
                      );
                    }}
                  >
                    <option value="">Select…</option>
                    {mediaAssets.map((m) => (
                      <option key={m.id} value={m.url}>
                        {m.filename}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}

              <label style={{ display: "grid", gap: 6 }}>
                <span>Alt (optional)</span>
                <input
                  value={block.alt ?? ""}
                  onChange={(e) => {
                    const alt = e.target.value;
                    setBlocks((prev) =>
                      prev.map((b, idx) => (idx === i ? { ...b, alt } : b)),
                    );
                  }}
                />
              </label>

              <div style={{ display: "flex", gap: 12 }}>
                <label style={{ display: "grid", gap: 6 }}>
                  <span>Width (optional)</span>
                  <input
                    inputMode="numeric"
                    value={block.width ?? ""}
                    onChange={(e) => {
                      const width = clampInt(e.target.value);
                      setBlocks((prev) =>
                        prev.map((b, idx) => (idx === i ? { ...b, width } : b)),
                      );
                    }}
                  />
                </label>
                <label style={{ display: "grid", gap: 6 }}>
                  <span>Height (optional)</span>
                  <input
                    inputMode="numeric"
                    value={block.height ?? ""}
                    onChange={(e) => {
                      const height = clampInt(e.target.value);
                      setBlocks((prev) =>
                        prev.map((b, idx) => (idx === i ? { ...b, height } : b)),
                      );
                    }}
                  />
                </label>
              </div>
            </>
          )}
        </div>
      ))}
    </div>
  );
}

