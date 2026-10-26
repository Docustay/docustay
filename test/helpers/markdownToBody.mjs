// Turns the practice's real Coaching Agreement (specs/documents/EXAMPLE_PRACTICE-COACHING-AGREEMENT.md) into a contract body, so the structural tests render the REAL 19-section agreement,
// with its mixed bold and plain paragraphs, its bullet lists and its signature section — the document whose copy came out with overlapping text on 2 Oct 2026.
// Used by tests only. Reads the file; never writes it.
import { readFileSync } from "node:fs";
import { BODY_SCHEMA_VERSION } from "../../src/documents/body.mjs";

const inline = (text) => {
  const runs = [];
  for (const part of text.split(/(\*\*[^*]+\*\*)/g)) {
    if (!part) continue;
    if (part.startsWith("**") && part.endsWith("**")) runs.push({ type: "prose", text: part.slice(2, -2), marks: ["bold"] });
    else runs.push({ type: "prose", text: part });
  }
  return runs;
};

export function agreementBody(path = new URL("../../specs/documents/EXAMPLE_PRACTICE-COACHING-AGREEMENT.md", import.meta.url)) {
  const lines = readFileSync(path, "utf8").split("\n");
  const sections = [];
  let cur = null;
  let para = [];
  let list = null;
  const flushPara = () => { if (para.length) { if (cur.blocks.length && cur.blocks.at(-1).type !== "list") cur.blocks.push({ type: "paragraphBreak" }); else if (cur.blocks.length) cur.blocks.push({ type: "paragraphBreak" }); cur.blocks.push(...inline(para.join(" "))); para = []; } };
  const flushList = () => { if (list) { if (cur.blocks.length) cur.blocks.push({ type: "paragraphBreak" }); cur.blocks.push({ type: "list", ordered: false, items: list }); list = null; } };
  const open = (title) => { cur = { key: `s${sections.length + 1}`, title, owner: "client", requires_signature: false, blocks: [] }; sections.push(cur); };
  let started = false;
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!started) { if (line.startsWith("---")) started = true; continue; }       // skip the title and the editor's note above the first rule
    if (/^---+$/.test(line)) continue;
    if (line.startsWith("**Signatures:**")) { if (cur) { flushPara(); flushList(); } open("Signatures"); cur.requires_signature = true;
      cur.blocks.push({ type: "signature", key: "client_sig", label: "Client signature", owner: "client" }, { type: "signature", key: "parent_sig", label: "Parent or guardian signature (if under 18)", owner: "parent" }, { type: "signature", key: "coach_sig", label: "Coach, for Example Practice", owner: "coach" });
      continue; }
    const h = line.match(/^## (.+)$/);
    if (h) { if (cur) { flushPara(); flushList(); } open(h[1]); continue; }
    if (!cur) { if (!line) continue; open("Agreement"); }
    if (!line) { flushPara(); continue; }
    const li = line.match(/^- (.+)$/);
    if (li) { flushPara(); (list ??= []).push(inline(li[1])); continue; }
    flushList(); para.push(line);
  }
  if (cur) { flushPara(); flushList(); }
  for (const s of sections) if (!s.blocks.length) s.blocks.push({ type: "prose", text: " " });
  return { kind: "contract", schema_version: BODY_SCHEMA_VERSION, sections };
}
