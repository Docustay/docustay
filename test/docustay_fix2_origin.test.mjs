// D-007: a document the Write editor made must not be described as "uploaded" on its certificate.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readdirSync } from "node:fs";
const langDir = new URL("../src/documents/lang/", import.meta.url);
test("the original-fingerprint line says file, not upload, in every language", async () => {
  for (const f of readdirSync(langDir).filter((n) => n.endsWith(".mjs"))) {
    const src = readFileSync(new URL(f, langDir), "utf8");
    const m = src.match(/"originalFp": "([^"]*)"/);
    if (m) assert.doesNotMatch(m[1], /upload|yükleme|上传|업로드/i, `${f}: ${m[1]}`);
  }
});
test("documents made by the editor or from source record origin=created, and the timeline reads 'Document created'", () => {
  assert.match(readFileSync(new URL("../src/documents/richDrafts.mjs", import.meta.url), "utf8"), /origin: "created"/);
  assert.match(readFileSync(new URL("../src/documents/templateSources.mjs", import.meta.url), "utf8"), /origin: "created"/);
  assert.match(readFileSync(new URL("../src/documents/pdfSend.mjs", import.meta.url), "utf8"), /origin === "created" \? "Document created"/);
  assert.match(readFileSync(new URL("../src/documents/files.mjs", import.meta.url), "utf8"), /origin === "created" \? \{ origin \} : \{\}/);
});
