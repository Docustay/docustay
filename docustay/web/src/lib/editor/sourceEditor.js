// Tiptap editor for the shared document engine's SOURCE format (specs/SHARED-ENGINE-UI-BRIEF.md).
import { Editor, Node, Extension, mergeAttributes } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import { Table, TableRow, TableCell, TableHeader } from "@tiptap/extension-table";
import Heading from "@tiptap/extension-heading";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { MergeField } from "./richEditor.js";

export { MergeField };

const FIELD_ATTRS = ["name", "type", "role", "required", "label", "options", "amount", "currency", "formula", "price", "link", "width", "height", "default", "max_length", "autofill", "editable", "placeholder", "tooltip", "locked", "show", "calc", "places", "filled", "from"];

export const FieldTag = Node.create({
  name: "fieldTag", group: "inline", inline: true, atom: true, selectable: true,
  addAttributes() {
    const a = {};
    for (const k of FIELD_ATTRS) a[k] = { default: null, rendered: false };
    return a;
  },
  parseHTML() { return [{ tag: "span[data-field-tag]" }]; },
  renderHTML({ node, HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes, { "data-field-tag": node.attrs.name || "", "data-field-role": node.attrs.role || "", "data-field-type": node.attrs.type || "", class: "field-chip", contenteditable: "false" }), `${node.attrs.label || node.attrs.name || ""}${node.attrs.role ? " · " + node.attrs.role : ""}`];
  },
});

export const SignatureBlock = Node.create({
  name: "signatureBlock", group: "block", atom: true, selectable: true,
  addAttributes() { return { slots: { default: [], rendered: false } }; },
  parseHTML() { return [{ tag: "div[data-signature-block]" }]; },
  renderHTML({ node, HTMLAttributes }) {
    const slots = Array.isArray(node.attrs.slots) ? node.attrs.slots : [];
    return ["div", mergeAttributes(HTMLAttributes, { "data-signature-block": "", class: "sig-block", contenteditable: "false" }),
      ["div", { class: "sig-title" }, "Signatures"],
      ...slots.map((s) => ["div", { class: "sig-slot" }, `${s.label || s.key}${s.role ? " — " + s.role : ""}`])];
  },
});

export const PageBreak = Node.create({
  name: "pageBreak", group: "block", atom: true, selectable: true,
  parseHTML() { return [{ tag: "div[data-page-break]" }]; },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-page-break": "", class: "page-break", contenteditable: "false" }), "Page break"];
  },
});

// a heading may say who sees its section (Docustay flow v2): `audience: "sender"` = only the sender; absent = everyone
export const SectionHeading = Heading.extend({
  addAttributes() { return { ...this.parent?.(), audience: { default: null, rendered: false }, key: { default: null, rendered: false }, showWhen: { default: null, rendered: false } }; },   // showWhen: Run 9, the section is in the document only when this rule over the sender's own values holds
  renderHTML({ node, HTMLAttributes }) {
    const level = [1, 2, 3].includes(node.attrs.level) ? node.attrs.level : 2;
    return [`h${level}`, mergeAttributes(HTMLAttributes, node.attrs.audience ? { "data-audience": node.attrs.audience } : {}), 0];
  },
});

/** Draws every block of a Sender only section striped (the heading carries the lock note). Pure decoration: nothing in the document changes. */
export const senderSections = Extension.create({
  name: "senderSections",
  addProseMirrorPlugins() {
    return [new Plugin({
      key: new PluginKey("senderSections"),
      props: {
        decorations(state) {
          const decos = []; let skip = null;
          state.doc.forEach((node, offset) => {
            if (node.type.name === "heading") {
              const level = node.attrs.level ?? 2;
              if (skip !== null && level > skip) { decos.push(Decoration.node(offset, offset + node.nodeSize, { class: "ds-sender" })); return; }
              skip = node.attrs.audience === "sender" ? level : null;
              if (skip !== null) decos.push(Decoration.node(offset, offset + node.nodeSize, { class: "ds-sender ds-sender-head" }));
            } else if (skip !== null) decos.push(Decoration.node(offset, offset + node.nodeSize, { class: "ds-sender" }));
          });
          return DecorationSet.create(state.doc, decos);
        },
      },
    })];
  },
});

export const FIELD_MIME = "application/x-docustay-field";
/** Dropping a palette tile on the page puts that field where it was dropped. `onDrop(type, pos)` decides what to insert (the page knows the people). */
export const dropField = (onDrop) => Extension.create({
  name: "dropField",
  addProseMirrorPlugins() {
    return [new Plugin({
      key: new PluginKey("dropField"),
      props: {
        handleDOMEvents: { dragover(view, e) { if (e.dataTransfer?.types?.includes(FIELD_MIME)) { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; return true; } return false; } },
        handleDrop(view, e) {
          const type = e.dataTransfer?.getData(FIELD_MIME); if (!type) return false;
          e.preventDefault(); const at = view.posAtCoords({ left: e.clientX, top: e.clientY });
          onDrop(type, at?.pos ?? view.state.selection.from); return true;
        },
      },
    })];
  },
});

// table cells may carry a width like "40%"
const withWidth = (base) => base.extend({ addAttributes() { return { ...this.parent?.(), width: { default: null, rendered: false } }; } });

export function makeSourceEditor(element, { content, onUpdate, ariaLabel, extra = [] }) {
  return new Editor({
    element,
    extensions: [
      StarterKit.configure({ heading: false, link: false }),
      SectionHeading.configure({ levels: [1, 2, 3] }),
      Link.configure({ openOnClick: false, autolink: false }),
      Table, TableRow, withWidth(TableCell), withWidth(TableHeader),
      MergeField, FieldTag, SignatureBlock, PageBreak, ...extra,
    ],
    content,
    editorProps: { attributes: { class: "rich-body", "aria-label": ariaLabel || "Document body", role: "textbox", "aria-multiline": "true" } },
    onUpdate: ({ editor }) => onUpdate?.(sourceJSON(editor)),
  });
}

// editor.getJSON() with empty attributes removed, so the source is exactly what the format needs
export function sourceJSON(editor) { return clean(editor.getJSON()); }
function clean(node) {
  if (!node || typeof node !== "object") return node;
  const out = { ...node };
  if (out.attrs) {
    const attrs = {};
    for (const [k, v] of Object.entries(out.attrs)) {
      if (v === null || v === undefined || v === "") continue;
      if (out.type === "fieldTag" && v === false) continue;
      if ((k === "colspan" || k === "rowspan") && v === 1) continue;
      if (k === "colwidth") continue;
      if (k === "slots" && Array.isArray(v)) { attrs[k] = v.map((s) => Object.fromEntries(Object.entries(s).filter(([, x]) => x !== null && x !== undefined && x !== ""))); continue; }
      attrs[k] = v;
    }
    if (Object.keys(attrs).length) out.attrs = attrs; else delete out.attrs;
  }
  if (Array.isArray(out.content)) out.content = out.content.map(clean);
  return out;
}

export function getSlots(doc) {
  const n = (doc?.content ?? []).find((b) => b.type === "signatureBlock");
  return Array.isArray(n?.attrs?.slots) ? n.attrs.slots : [];
}

// replace/insert/remove the single signatureBlock, kept at the END of the document
export function setSlots(editor, slots) {
  const { state, view } = editor;
  const type = state.schema.nodes.signatureBlock;
  let tr = state.tr;
  const found = [];
  state.doc.forEach((child, offset) => { if (child.type === type) found.push({ pos: offset, size: child.nodeSize }); });
  const last = state.doc.lastChild;
  if (slots.length && found.length === 1 && last?.type === type) {
    tr = tr.setNodeMarkup(found[0].pos, null, { slots });
  } else {
    for (const f of found.reverse()) tr = tr.delete(f.pos, f.pos + f.size);
    if (slots.length) tr = tr.insert(tr.doc.content.size, type.create({ slots }));
  }
  view.dispatch(tr);
}

export function insertFieldTag(editor, attrs) {
  const clean = {};
  for (const [k, v] of Object.entries(attrs || {})) if (v !== null && v !== undefined && v !== "") clean[k] = v;
  return editor.chain().focus().insertContent([{ type: "fieldTag", attrs: clean }, { type: "text", text: " " }]).run();
}

export const SOURCE_EDITOR_CSS = `
.rich-body { min-height: 18rem; outline: none; line-height: 1.6; }
.rich-body h1 { font-size: 1.5rem; font-weight: 700; margin: 1rem 0 .5rem; }
.rich-body h2 { font-size: 1.25rem; font-weight: 700; margin: 1rem 0 .4rem; }
.rich-body h3 { font-size: 1.1rem; font-weight: 600; margin: .8rem 0 .3rem; }
.rich-body ul { list-style: disc; padding-left: 1.4rem; margin: .4rem 0; }
.rich-body ol { list-style: decimal; padding-left: 1.4rem; margin: .4rem 0; }
.rich-body a { color: #1d4ed8; text-decoration: underline; }
.rich-body p { margin: .4rem 0; }
.rich-body hr { border: 0; border-top: 1px solid #9ca3af; margin: 1rem 0; }
.rich-body table { border-collapse: collapse; width: 100%; margin: .6rem 0; table-layout: fixed; }
.rich-body th, .rich-body td { border: 1px solid #9ca3af; padding: .3rem .5rem; vertical-align: top; position: relative; }
.rich-body th { background: #f3f4f6; font-weight: 600; text-align: left; }
.rich-body .selectedCell { background: #dbeafe; }
.merge-chip { display: inline-block; border-radius: 999px; background: #e0e7ff; color: #3730a3; padding: 0 .55rem; font-size: .85em; font-weight: 500; }
.field-chip { display: inline-block; border-radius: 6px; background: #fef3c7; color: #92400e; border: 1px solid #f59e0b; padding: 0 .5rem; font-size: .85em; font-weight: 500; }
.field-chip.ProseMirror-selectednode, .merge-chip.ProseMirror-selectednode, .sig-block.ProseMirror-selectednode, .page-break.ProseMirror-selectednode { outline: 2px solid #2563eb; }
.sig-block { border: 1px solid #6b7280; border-radius: 8px; padding: .6rem .8rem; margin: 1rem 0; background: #f9fafb; }
.sig-title { font-weight: 700; margin-bottom: .3rem; }
.sig-slot { font-size: .9em; padding: .15rem 0; border-top: 1px dashed #d1d5db; }
.page-break { border-top: 2px dashed #9ca3af; margin: 1.2rem 0; text-align: center; font-size: .75rem; color: #6b7280; padding-top: .15rem; }
`;

// ── THE "/" MENU (TipTap Suggestion, MIT). The items come from the flow definition (SLASH_ITEMS); picking one calls onPick(id, { editor, range }) — the page decides what each does (heading and table and page break act in the
//    editor; field and clause open their tab). The popup is plain DOM, so the same extension works in any framework.
import Suggestion from "@tiptap/suggestion";
export function slashExtension({ items, label, onPick }) {
  return Extension.create({
    name: "slashMenu",
    addProseMirrorPlugins() {
      return [Suggestion({
        editor: this.editor, char: "/", startOfLine: false, allowSpaces: false,
        items: ({ query }) => items.filter((i) => label(i).toLowerCase().includes(query.toLowerCase())).slice(0, 8),
        command: ({ editor, range, props }) => { editor.chain().focus().deleteRange(range).run(); onPick(props.id, { editor }); },
        render: () => {
          let box = null, list = [], at = 0, cmd = null;
          const draw = () => {
            if (!box) return;
            box.innerHTML = "";
            list.forEach((it, i) => {
              const b = document.createElement("button"); b.type = "button"; b.setAttribute("role", "option"); b.dataset.testid = `slash-${it.id}`; b.className = "slash-item" + (i === at ? " on" : "");
              b.innerHTML = `<b></b><span></span>`; b.firstChild.textContent = label(it); b.lastChild.textContent = it.hint ?? "";
              b.onmousedown = (e) => { e.preventDefault(); cmd?.(it); };
              box.appendChild(b);
            });
          };
          const place = (rect) => { if (!box || !rect) return; box.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - 280))}px`; box.style.top = `${rect.bottom + 6}px`; };
          return {
            onStart: (props) => { list = props.items; at = 0; cmd = (it) => props.command({ id: it.id }); box = document.createElement("div"); box.className = "slash-menu"; box.setAttribute("role", "listbox"); box.dataset.testid = "slash-menu"; document.body.appendChild(box); draw(); place(props.clientRect?.()); },
            onUpdate: (props) => { list = props.items; at = 0; cmd = (it) => props.command({ id: it.id }); draw(); place(props.clientRect?.()); },
            onKeyDown: ({ event }) => {
              if (!box) return false;
              if (event.key === "ArrowDown") { at = (at + 1) % Math.max(1, list.length); draw(); return true; }
              if (event.key === "ArrowUp") { at = (at - 1 + list.length) % Math.max(1, list.length); draw(); return true; }
              if (event.key === "Enter") { if (list[at]) cmd?.(list[at]); return true; }
              if (event.key === "Escape") { box.remove(); box = null; return true; }
              return false;
            },
            onExit: () => { box?.remove(); box = null; },
          };
        },
      })];
    },
  });
}
export const SLASH_CSS = `.slash-menu{position:fixed;z-index:70;min-width:260px;background:var(--card,#fff);border:1px solid var(--line-strong,#cfc5af);border-radius:12px;box-shadow:0 12px 32px rgba(0,0,0,.16);padding:4px;display:flex;flex-direction:column}.slash-item{display:flex;flex-direction:column;align-items:flex-start;gap:1px;min-height:44px;padding:6px 10px;border:0;border-radius:8px;background:transparent;color:var(--ink,#1b1a17);text-align:left;cursor:pointer;font:inherit}.slash-item span{font-size:12px;color:var(--mute,#6b655a)}.slash-item.on,.slash-item:hover{background:var(--tint,#ede6d6)}`;

export const SENDER_CSS = `.rich-body .ds-sender{background:repeating-linear-gradient(135deg,rgba(120,100,60,.08) 0 8px,transparent 8px 16px);border-left:3px solid #8a7a52;padding-left:10px;margin-left:-13px}.rich-body .ds-sender-head::before{content:var(--ds-sender-note,"Sender only");display:block;font:600 11px system-ui;color:#6b5a2e;letter-spacing:.04em;margin-bottom:2px}.field-chip{display:inline-block;padding:1px 8px;border-radius:6px;border:1.5px solid var(--chip,#999);background:color-mix(in srgb,var(--chip,#999) 14%,white);font:12px system-ui;cursor:pointer;margin:0 1px}.field-chip.ProseMirror-selectednode,.field-chip.is-sel{outline:2px solid #5b3ad6}.field-chip.dim{opacity:.3}.rich-body .field-chip{background:color-mix(in srgb,var(--chip,#d97706) 12%,#fff);border-color:var(--chip,#d97706);color:#1f2937}.rich-body .merge-chip{white-space:nowrap}`;
