// ═══════════════════════════════════════════════════════════════════════════════════════════════
// contractDoc.js — Square Contracts rebuild (29 Sep 2026). Bidirectional mapping between a TipTap
// document (what the rich editor edits) and `contractBodySchema` (src/documents/body.mjs — the ONE
// validated shape a template body may take; see that file's own header for why it refuses a second
// dialect). The editor is a nicer way to WRITE that shape, never a new format of its own.
//
// ★★★ THE MAPPING'S OWN RULE: a `heading` node starts a new SECTION (its text becomes the section's
//     `title`); every `paragraph`/`bulletList`/`orderedList` until the next heading (or the end)
//     contributes blocks to the section currently open. A document with no heading at all is one
//     section named "Agreement" — the common case for a short agreement, and what the
//     placeholder/starter bodies already produce.
// ★★★ SIGNATURES ARE NEVER PART OF THE EDITED DOCUMENT. Per the rebuild ruling's own §3 ("Pick who
//     signs, and their signature lines appear at the end on their own, like Square"), the signature
//     blocks are entirely DERIVED from the side panel's "who signs" picks, as one auto-generated
//     trailing section — never something the author places with the slash menu. This also keeps
//     `requires_signature` honest: every authored content section carries no signature of its own
//     (`requires_signature: false`), and only the auto-generated section is `true`.
//
// ★★★ FIX, 30 Sep 2026 (documents paragraph-formatting brief) — TWO BUGS the maintainer found and one this file
//     never had a way to represent at all:
//   1. LOAD (`sectionsToTiptapDoc`) used to push every block in a section into ONE TipTap paragraph.
//      A section with two authored paragraphs came back as one, permanently — every reopen+save
//      ratcheted more text together. It now reads `paragraphBreak` blocks (body.mjs's own new
//      addition) to know where a NEW paragraph starts. A section with none (every body saved before
//      today) still renders as one paragraph — UNCHANGED, which is the point: old data is not
//      rewritten by being viewed.
//   2. SAVE (`paragraphToBlocks`) kept only plain text and variable chips — a `hardBreak`, a bold/
//      italic mark, or an entire list was silently dropped. It now reads marks off each text run,
//      turns a `hardBreak` into a `lineBreak` block, and turns a `bulletList`/`orderedList` into a
//      `list` block via the SAME inline-content reader a paragraph uses (`inlineToBlocks`) — a list
//      item is inline content, not a second, simpler shape.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

export const SIGNATURES_SECTION_KEY = "signatures";

const MARK_TYPES = ["bold", "italic"];

/** A prose block's `marks` (body.mjs shape, e.g. `["bold"]`) → TipTap text-node marks. */
function marksToTiptap(marks) {
  return (marks ?? []).filter((m) => MARK_TYPES.includes(m)).map((type) => ({ type }));
}

/** TipTap text-node marks → a body-shaped `marks` array, or `undefined` when there are none — an
 *  empty array would still be a "no marks" fact, but `undefined` matches how every OTHER optional
 *  field on these blocks is written, and keeps a plain run byte-identical to before this fix. */
function tiptapMarksToBody(marks) {
  const out = (marks ?? []).map((m) => m.type).filter((t) => MARK_TYPES.includes(t));
  return out.length ? out : undefined;
}

/** contractBodySchema.sections → a TipTap `doc` node. Drops the auto-generated signatures section —
 *  it is never shown in the editable body, only reconstructed from the Settings tab's own state. */
export function sectionsToTiptapDoc(sections) {
  const content = [];
  for (const section of sections ?? []) {
    if (section.key === SIGNATURES_SECTION_KEY) continue;
    if ((section.blocks ?? []).every((b) => b.type === "signature")) continue;
    content.push({ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: section.title || "Untitled" }] });

    let inline = [];
    let wroteAnyParagraph = false;
    const flushParagraph = () => {
      content.push(inline.length ? { type: "paragraph", content: inline } : { type: "paragraph" }); // ★ an EMPTY paragraph has no `content` — ProseMirror refuses an empty text node ("RangeError: Empty text nodes are not allowed")
      inline = [];
      wroteAnyParagraph = true;
    };

    for (const b of section.blocks ?? []) {
      if (b.type === "prose") {
        const marks = marksToTiptap(b.marks);
        if (b.href) marks.push({ type: "link", attrs: { href: b.href } });
        if (b.text) inline.push(marks.length ? { type: "text", text: b.text, marks } : { type: "text", text: b.text });
      } else if (b.type === "variable") {
        inline.push({ type: "variableChip", attrs: { name: b.name, label: b.label } });
      } else if (b.type === "lineBreak") {
        inline.push({ type: "hardBreak" });
      } else if (b.type === "paragraphBreak") {
        flushParagraph();
      } else if (b.type === "list") {
        // ★ A list is a paragraph boundary on both sides: whatever came before it closes as its own
        //   paragraph (even if empty — the list does not absorb the prior run), and whatever comes
        //   after starts a fresh one.
        flushParagraph();
        const listItemNodes = (b.items ?? []).map((item) => {
          const itemInline = [];
          for (const run of item) {
            if (run.type === "prose") {
              const marks = marksToTiptap(run.marks);
              if (run.text) itemInline.push(marks.length ? { type: "text", text: run.text, marks } : { type: "text", text: run.text });
            } else if (run.type === "variable") {
              itemInline.push({ type: "variableChip", attrs: { name: run.name, label: run.label } });
            } else if (run.type === "lineBreak") {
              itemInline.push({ type: "hardBreak" });
            }
          }
          return { type: "listItem", content: [itemInline.length ? { type: "paragraph", content: itemInline } : { type: "paragraph" }] };
        });
        content.push({ type: b.ordered ? "orderedList" : "bulletList", content: listItemNodes });
        wroteAnyParagraph = true; // a list counts as this section's content having been written
      }
      // a signature block inside a content section (hand-authored data from before this rebuild) —
      // it is dropped from the editable body the same way the auto-section is; save() regenerates it.
    }
    // ★ Flush whatever trailing run never hit a paragraphBreak/list — this is what makes an
    //   old-style section (no paragraphBreak anywhere) come back as exactly one paragraph, unchanged.
    if (inline.length || !wroteAnyParagraph) flushParagraph();
  }
  if (content.length === 0) {
    content.push({ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Agreement" }] });
    content.push({ type: "paragraph" });
  }
  return { type: "doc", content };
}

/** A TipTap paragraph's (or list item's) `content` array → body blocks: prose (with marks),
 *  variable, lineBreak. Shared between a top-level paragraph and a list item — a list item is
 *  inline content, the same vocabulary, never a second reader. */
function inlineToBlocks(inlineNodes) {
  const out = [];
  let buf = "";
  let bufHref = undefined;
  let bufMarks = undefined; // undefined = "no run open yet", distinct from [] = "an open run with no marks"
  const flush = () => {
    if (buf.length) out.push({ type: "prose", text: buf, ...(bufMarks && bufMarks.length ? { marks: bufMarks } : {}), ...(bufHref ? { href: bufHref } : {}) });
    buf = ""; bufMarks = undefined; bufHref = undefined;
  };
  for (const inline of inlineNodes ?? []) {
    if (inline.type === "text") {
      const marks = tiptapMarksToBody(inline.marks) ?? [];
      // ★ A mark CHANGE starts a new run — two adjacent runs with different emphasis are two prose
      //   blocks, never one block with the wrong marks silently applied to both.
      const href = (inline.marks ?? []).find((m) => m.type === "link")?.attrs?.href || undefined;
      if (bufMarks !== undefined && (JSON.stringify(marks) !== JSON.stringify(bufMarks) || href !== bufHref)) flush();
      if (bufMarks === undefined) { bufMarks = marks; bufHref = href; }
      buf += inline.text;
    } else if (inline.type === "variableChip") {
      flush();
      out.push({ type: "variable", name: inline.attrs.name, label: inline.attrs.label });
    } else if (inline.type === "hardBreak") {
      flush();
      out.push({ type: "lineBreak" });
    }
  }
  flush();
  return out;
}

// ★★★ FIX, 30 Sep 2026 — body.mjs's `key` schema requires a LEADING LETTER (`^[a-z][a-z0-9_]*$`),
//   but this never guaranteed one: a numbered heading ("1. What coaching is", exactly the maintainer's own real
//   agreement's own section numbering) slugs to "1_what_coaching_is", which starts with a digit and
//   was refused at save with no indication WHERE the problem was — every section in a numbered
//   agreement failed the same way. `section_` prefixes a slug that doesn't already start with a
//   letter, the same fallback this function already used for a title that slugs to nothing at all.
const slug = (s, i) => {
  const base = String(s || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  if (!base) return `section_${i}`;
  return /^[a-z]/.test(base) ? base : `section_${base}`;
};

/** A TipTap `doc` node → contractBodySchema-shaped CONTENT sections (no signatures section — the
 *  caller appends one from the Settings tab's own picks, via `signaturesSection` below). */
export function tiptapDocToSections(doc) {
  const nodes = doc?.content ?? [];
  const sections = [];
  let current = null;
  let i = 0;
  const seenKeys = new Set();
  const uniqueKey = (base) => {
    let k = base, n = 2;
    while (seenKeys.has(k)) k = `${base}_${n++}`;
    seenKeys.add(k);
    return k;
  };
  const start = (title) => {
    i += 1;
    current = { key: uniqueKey(slug(title, i)), title: title || `Section ${i}`, owner: "client", requires_signature: false, blocks: [] };
    sections.push(current);
  };
  for (const node of nodes) {
    if (node.type === "heading") {
      const text = (node.content ?? []).map((n) => n.text ?? "").join("");
      start(text);
      continue;
    }
    if (!current) start("Agreement");

    if (node.type === "paragraph") {
      const blocks = inlineToBlocks(node.content);
      if (blocks.length === 0) continue; // an empty paragraph carries nothing to break BEFORE
      // ★ A paragraphBreak marks "a new paragraph starts here" — so it goes BEFORE this paragraph's
      //   own content, and only once the section already has something to break away from.
      if (current.blocks.length > 0) current.blocks.push({ type: "paragraphBreak" });
      current.blocks.push(...blocks);
    } else if (node.type === "bulletList" || node.type === "orderedList") {
      const items = (node.content ?? [])
        .map((listItem) => {
          // ★ One paragraph per list item (this editor's own shape — see body.mjs's listBlock
          //   header): a list item with more than one paragraph child has no representation here yet,
          //   so only the first is read, same posture as dropping a construct this schema does not
          //   (yet) model rather than guessing at one.
          const itemParagraph = (listItem.content ?? []).find((c) => c.type === "paragraph");
          return inlineToBlocks(itemParagraph?.content);
        })
        .filter((runs) => runs.length > 0);
      if (items.length === 0) continue;
      if (current.blocks.length > 0) current.blocks.push({ type: "paragraphBreak" });
      current.blocks.push({ type: "list", ordered: node.type === "orderedList", items });
    }
  }
  return sections.filter((s) => s.blocks.length > 0);
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ITEM 8 — the Content step's Square-style block outline (30 Sep 2026). The editor stays ONE
// continuous TipTap document (heading = new section) exactly as the rebuild above already has it;
// these two helpers let a UI ABOVE that editor show one row per section — tick box, "…" menu,
// drag handle — and act on the doc by slicing/reordering its top-level `content` ARRAY, never by
// touching ProseMirror positions directly. A structural edit (clone/delete/reorder) always replaces
// the whole doc via `editor.commands.setContent()`; ordinary typing never goes through this path.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

/** Walk a TipTap doc's top-level `content` array and return one row per heading-delimited section:
 *  `{ title, start, end }`, `start`/`end` being indices into that array (`end` exclusive) — the
 *  slice `content.slice(start, end)` is exactly that section's heading node plus everything until
 *  the next heading (or the end of the doc). A doc with no leading heading gets an implicit first
 *  section starting at index 0, matching `tiptapDocToSections`'s own "Agreement" fallback. */
export function docSectionRanges(doc) {
  const content = doc?.content ?? [];
  const ranges = [];
  let cur = null;
  content.forEach((node, idx) => {
    if (node.type === "heading") {
      if (cur) { cur.end = idx; ranges.push(cur); }
      const text = (node.content ?? []).map((n) => n.text ?? "").join("") || "Untitled";
      cur = { title: text, start: idx, end: content.length };
    } else if (!cur) {
      cur = { title: "Agreement", start: idx, end: content.length };
    }
  });
  if (cur) ranges.push(cur);
  return ranges;
}

/** Remove every section whose (0-based) outline index is in `excludedIndexes` from a TipTap doc —
 *  used only at save time (`currentBody()`), never on the doc the editor itself displays: an
 *  unchecked section stays visible (and editable) in the editor so re-checking it costs nothing,
 *  it is simply left out of what actually gets written to contractBodySchema. */
export function docWithoutExcludedSections(doc, excludedIndexes) {
  if (!excludedIndexes || excludedIndexes.size === 0) return doc;
  const content = doc?.content ?? [];
  const ranges = docSectionRanges(doc);
  const dropIdx = new Set();
  ranges.forEach((r, i) => { if (excludedIndexes.has(i)) for (let n = r.start; n < r.end; n++) dropIdx.add(n); });
  return { ...doc, content: content.filter((_, i) => !dropIdx.has(i)) };
}

/** Reorder sections: `order` is a permutation of outline indices (e.g. `[2,0,1]` = "what was third
 *  is now first"). Rebuilds the doc's `content` array by concatenating each section's own slice in
 *  the new order — nothing inside a section is touched, only which whole slice comes first. */
export function reorderDocSections(doc, order) {
  const content = doc?.content ?? [];
  const ranges = docSectionRanges(doc);
  const out = [];
  for (const i of order) {
    const r = ranges[i];
    if (r) out.push(...content.slice(r.start, r.end));
  }
  return { ...doc, content: out };
}

/** Delete one section's slice entirely from the doc. */
export function deleteDocSection(doc, index) {
  const content = doc?.content ?? [];
  const ranges = docSectionRanges(doc);
  const r = ranges[index];
  if (!r) return doc;
  return { ...doc, content: [...content.slice(0, r.start), ...content.slice(r.end)] };
}

/** Duplicate one section's slice, inserting the copy directly after the original — the heading text
 *  is left identical; `tiptapDocToSections`'s own `uniqueKey` already disambiguates two sections
 *  that slug to the same key, so nothing here needs to rename it. */
export function cloneDocSection(doc, index) {
  const content = doc?.content ?? [];
  const ranges = docSectionRanges(doc);
  const r = ranges[index];
  if (!r) return doc;
  const slice = content.slice(r.start, r.end).map((n) => JSON.parse(JSON.stringify(n)));
  return { ...doc, content: [...content.slice(0, r.end), ...slice, ...content.slice(r.end)] };
}

/** The one auto-generated section carrying every selected signer's signature block, or `null` if
 *  nobody is picked to sign yet (a template mid-authoring, before Settings is touched). */
export function signaturesSection(signers) {
  if (!signers || signers.length === 0) return null;
  return {
    key: SIGNATURES_SECTION_KEY,
    title: "Signatures",
    owner: signers[0].owner,
    requires_signature: true,
    blocks: signers.map((s) => ({ type: "signature", key: `${s.owner}_signature`, label: s.label, owner: s.owner })),
  };
}

/** The reverse of `signaturesSection` — read who currently signs out of a loaded body, for the
 *  Settings tab's initial checkbox state. */
export function signersFromSections(sections) {
  const sigSection = (sections ?? []).find((s) => s.key === SIGNATURES_SECTION_KEY)
    ?? (sections ?? []).find((s) => (s.blocks ?? []).some((b) => b.type === "signature"));
  if (!sigSection) return [];
  return (sigSection.blocks ?? [])
    .filter((b) => b.type === "signature")
    .map((b) => ({ owner: b.owner ?? sigSection.owner, label: b.label }));
}

/** Assemble the full, save-ready body from the editor's current TipTap doc and Settings picks. */
export function assembleContractBody(doc, signers) {
  const content = tiptapDocToSections(doc);
  const sig = signaturesSection(signers);
  const sections = sig ? [...content, sig] : content;
  return { kind: "contract", schema_version: 1, sections };
}
