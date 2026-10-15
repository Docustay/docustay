// ═══════════════════════════════════════════════════════════════════════════════════════════════
// SourceWriter.jsx — the shared document engine's writer for the platform (6 Oct 2026; specs/SHARED-DOCUMENT-ENGINE-DESIGN-6OCT.md §5,
// specs/SHARED-ENGINE-UI-BRIEF.md). Writes the engine's document SOURCE (a closed TipTap node set) and saves it as a TEMPLATE with
// profile "contract" through /api/documents/engine/…. Route: /documents/write[?template=<id>]. Only reachable when the practice
// setting authoring.shared_engine is on (DocsTemplates.jsx shows the door); flag off, nothing here is linked.
// Props: { path, params, app, onNavigate, onRefetch }
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useEffect, useMemo, useRef, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Heading from "@tiptap/extension-heading";
import Link from "@tiptap/extension-link";
import { Table, TableRow, TableCell, TableHeader } from "@tiptap/extension-table";
import { Node, mergeAttributes } from "@tiptap/core";
import { HOST_VARIABLES } from "@keystone/ports/documentsVariables.mjs";
import { FIELD_TYPES, FIELD_GROUPS, WRITER_TABS, SLASH_ITEMS, PREVIEW_VIEWS, AUTOFILL_PRESETS, PAPER_CHOICES, fieldType } from "@keystone/documents/flowDefinition.mjs";
import { previewHtml } from "@keystone/documents/flowPreview.mjs";
import { Tabs } from "radix-ui";
import { Dialog, DialogContent, DialogTitle } from "@/lib/components/ui/dialog.jsx";
import { FlowIcon } from "./flowIcons.jsx";
import { slashExtension, SLASH_CSS } from "./slashSource.js";
import { request, ApiError } from "@/lib/api.js";
import { Button } from "@/lib/components/ui/button.jsx";
import { Input } from "@/lib/components/ui/input.jsx";
import { NativeSelect } from "@/lib/components/ui/native-select.jsx";
import SourceWriterAi from "./SourceWriterAi.jsx";
import { VariableChip } from "./editorExtensions.js";

const ENGINE = "/api/documents/engine";

// ── nodes the starter kit does not have ───────────────────────────────────────────────────────
const SourceHeading = Heading.extend({
  addAttributes() {
    return { ...this.parent?.(), key: { default: null }, owner: { default: null }, requiresSignature: { default: null } };
  },
});
const PageBreak = Node.create({
  name: "pageBreak", group: "block", atom: true, selectable: true,
  parseHTML() { return [{ tag: "div[data-page-break]" }]; },
  renderHTML({ HTMLAttributes }) { return ["div", mergeAttributes(HTMLAttributes, { "data-page-break": "", class: "my-2 border-t border-dashed border-line text-center text-caption text-mute" }), "Page break"]; },
});
const SignatureBlock = Node.create({
  name: "signatureBlock", group: "block", atom: true, selectable: true,
  addAttributes() { return { slots: { default: [] } }; },
  parseHTML() { return [{ tag: "div[data-signature-block]" }]; },
  renderHTML({ node }) {
    const slots = node.attrs.slots ?? [];
    return ["div", { "data-signature-block": "", class: "my-3 rounded-card border border-line bg-surface-sunken p-3 text-ui" },
      ["div", { class: "text-caption font-medium text-mute" }, "Signatures"],
      ...slots.map((s) => ["div", { class: "mt-2 border-b border-line pb-1" }, `${s.label || s.key}${s.role ? ` (${s.role})` : ""}`])];
  },
});
const FieldTag = Node.create({
  name: "fieldTag", group: "inline", inline: true, atom: true, selectable: true,
  addAttributes() {
    return Object.fromEntries(["name", "type", "role", "required", "label", "options", "amount", "currency", "formula", "price", "link", "width", "height", "default", "max_length"].map((k) => [k, { default: null }]));
  },
  parseHTML() { return [{ tag: "span[data-field-tag]" }]; },
  renderHTML({ node }) {
    return ["span", { "data-field-tag": node.attrs.name ?? "", class: "inline-flex items-center rounded-pill border border-line px-2 py-0.5 text-caption text-mute align-baseline", contenteditable: "false" }, `${node.attrs.label || node.attrs.name || "field"} · ${node.attrs.type ?? "text"}`];
  },
});

// ── helpers ───────────────────────────────────────────────────────────────────────────────────
const EMPTY_DOC = { type: "doc", content: [{ type: "paragraph" }] };

/** Drop null/empty attrs (and default colspan/rowspan 1, colwidth) so only what the closed format knows is sent. */
export function sanitise(node) {
  if (Array.isArray(node)) return node.map(sanitise);
  if (!node || typeof node !== "object") return node;
  const out = {};
  for (const [k, v] of Object.entries(node)) {
    if (k === "attrs") {
      const a = {};
      for (const [ak, av] of Object.entries(v ?? {})) {
        if (av === null || av === undefined || av === "") continue;
        if ((ak === "colspan" || ak === "rowspan") && av === 1) continue;
        if (ak === "colwidth") continue;
        a[ak] = av;
      }
      if (Object.keys(a).length) out.attrs = a;
    } else if (k === "marks") {
      if (Array.isArray(v) && v.length) out.marks = sanitise(v);
    } else if (k === "content") {
      if (Array.isArray(v) && v.length) out.content = sanitise(v);
    } else out[k] = sanitise(v);
  }
  return out;
}

function slotKey(label, taken) {
  let base = String(label || "signer").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  if (!/^[a-z]/.test(base)) base = `s_${base}`.replace(/_$/, "");
  let k = base || "signer", n = 2;
  while (taken.has(k)) k = `${base}_${n++}`;
  return k;
}

const BASE_MERGE = [
  ["signer.name", "Signer name"], ["signer.email", "Signer email"], ["org.name", "Organisation name"], ["org.address", "Organisation address"],
  ["sender.name", "Sender name"], ["sender.email", "Sender email"], ["document.title", "Document title"], ["document.date", "Document date"],
];
const errText = (e) => (typeof e === "string" ? e : e?.message ?? e?.error ?? JSON.stringify(e));

export default function SourceWriter({ path = "/documents/write", params = null, app = null, onNavigate = null, onRefetch = null }) {
  function go(href) { if (onNavigate) onNavigate(href); else window.location.assign(href); }
  const templateId = app?.query?.template ?? null;

  const [name, setName] = useState("");
  const [slots, setSlots] = useState([]);
  const [loadError, setLoadError] = useState(null);
  const [loading, setLoading] = useState(!!templateId);
  const [check, setCheck] = useState(null);
  const [checkError, setCheckError] = useState(null);
  const [saveError, setSaveError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [rev, setRev] = useState(0);
  const [mergePick, setMergePick] = useState("");
  const [tab, setTab] = useState("fields");
  const [fType, setFType] = useState("signature"), [fRole, setFRole] = useState(""), [fLabel, setFLabel] = useState(""), [fOptions, setFOptions] = useState("");
  const [clauses, setClauses] = useState(null);
  const [previewOpen, setPreviewOpen] = useState(false), [pView, setPView] = useState("see_it"), [pAs, setPAs] = useState("");
  const [attempted, setAttempted] = useState(false);
  const [paper, setPaper] = useState("letter");
  const slashPickRef = useRef(null);

  const extensions = useMemo(() => [
    StarterKit.configure({ heading: false, link: false }),
    SourceHeading.configure({ levels: [1, 2, 3] }),
    Link.configure({ openOnClick: false }),
    Table, TableRow, TableCell, TableHeader,
    VariableChip, SignatureBlock, FieldTag, PageBreak,
    slashExtension({ items: SLASH_ITEMS, label: (i) => i.label, onPick: (id, ctx) => slashPickRef.current?.(id, ctx) }),
  ], []);
  const editor = useEditor({ extensions, content: EMPTY_DOC, onUpdate: () => setRev((n) => n + 1) });

  const mergeNames = useMemo(() => {
    const seen = new Set(); const list = [];
    for (const [n, l] of BASE_MERGE) { seen.add(n); list.push({ name: n, label: l }); }
    for (const v of HOST_VARIABLES) if (!seen.has(v.name)) { seen.add(v.name); list.push({ name: v.name, label: v.label ?? v.name }); }
    return list;
  }, []);

  // load an existing source template
  useEffect(() => {
    if (!templateId || !editor) return;
    let alive = true;
    (async () => {
      try {
        const r = await request(`${ENGINE}/templates/${encodeURIComponent(templateId)}/source`);
        const d = r?.data ?? r;
        if (!alive) return;
        setName(d.name ?? "");
        const sig = (d.source?.content ?? []).find((b) => b.type === "signatureBlock");
        setSlots((sig?.attrs?.slots ?? []).map((s) => ({ key: s.key, label: s.label ?? "", role: s.role ?? "" })));
        editor.commands.setContent(d.source ?? EMPTY_DOC, { emitUpdate: true });
      } catch (err) { if (alive) setLoadError(err); }
      finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
  }, [templateId, editor]);

  const currentSource = () => sanitise(editor.getJSON());
  function applyAiSource(source, title) {
    if (!editor || !source) return;
    editor.commands.setContent(source, { emitUpdate: true });
    const sig = (source.content ?? []).find((b) => b.type === "signatureBlock");
    setSlots((sig?.attrs?.slots ?? []).map((s) => ({ key: s.key, label: s.label ?? "", role: s.role ?? "" })));
    if (title && !name.trim() && !templateId) setName(String(title));
    setRev((n) => n + 1);
  }

  // Check panel, debounced 600 ms
  useEffect(() => {
    if (!editor || loading) return undefined;
    const t = setTimeout(async () => {
      try {
        const r = await request(`${ENGINE}/check`, { method: "POST", body: { source: currentSource(), profile: "contract", requireSignature: true } });
        setCheck(r?.data ?? r); setCheckError(null);
      } catch (err) { setCheckError(err); }
    }, 600);
    return () => clearTimeout(t);
  }, [rev, editor, loading]); // eslint-disable-line react-hooks/exhaustive-deps

  // the document's single signatureBlock mirrors the slot list
  function applySlots(next) {
    setSlots(next);
    if (!editor) return;
    const json = editor.getJSON();
    const blocks = (json.content ?? []).filter((b) => b.type !== "signatureBlock");
    if (next.length) blocks.push({ type: "signatureBlock", attrs: { slots: next.map((s) => ({ key: s.key, label: s.label, role: s.role })) } });
    editor.commands.setContent({ ...json, content: blocks }, { emitUpdate: true });
  }
  const addSlot = () => applySlots([...slots, { key: slotKey("signer", new Set(slots.map((s) => s.key))), label: "Signer", role: "Signer" }]);
  const editSlot = (i, patch) => applySlots(slots.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const removeSlot = (i) => applySlots(slots.filter((_, j) => j !== i));

  function insertMerge(n) {
    if (!n || !editor) return;
    const m = mergeNames.find((x) => x.name === n);
    editor.chain().focus().insertContent({ type: "variableChip", attrs: { name: n, label: m?.label ?? n } }).run();
    setMergePick("");
  }

  slashPickRef.current = (id, { editor: ed }) => {
    if (id === "heading") ed.chain().focus().toggleHeading({ level: 2 }).run();
    else if (id === "table") ed.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
    else if (id === "pagebreak") ed.chain().focus().insertContent({ type: "pageBreak" }).run();
    else if (id === "field") setTab("fields");
    else if (id === "clause") { setTab("clauses"); loadClauses(); }
  };
  async function loadClauses() {
    if (clauses) return;
    try { const r = await request(`${ENGINE}/clauses`); setClauses((r?.data ?? r)?.clauses ?? []); } catch { setClauses([]); }
  }
  const people = slots.map((s) => ({ value: s.role || s.label, label: s.label || s.role }));
  function insertField(over) {
    const ft = fieldType(fType); const label = over?.label ?? (fLabel.trim() || ft?.label || fType); const type = over?.type ?? fType;
    editor.chain().focus().insertContent([{ type: "fieldTag", attrs: { name: label, type, role: fRole || slots[0]?.role || "", label, ...(["dropdown", "select", "multiselect"].includes(type) && fOptions.trim() ? { options: fOptions.trim() } : {}) } }, { type: "text", text: " " }]).run();
    setFLabel(""); setFOptions("");
  }
  const previewSrc = previewOpen ? previewHtml(check.html ?? (editor ? editor.getHTML() : ""), { view: pView, roles: slots.map((s) => s.role || s.label), asRole: pAs, title: name || "Document", hash: check.hash ?? "" }) : "";

  async function save() {
    setAttempted(true);
    setSaveError(null); setSaving(true);
    try {
      const source = currentSource();
      if (templateId) await request(`${ENGINE}/templates/version`, { method: "POST", body: { templateId, source } });
      else await request(`${ENGINE}/templates`, { method: "POST", body: { name: name.trim(), source, profile: "contract", origin: "written", paper } });
      onRefetch?.();
      go("/documents/templates");
    } catch (err) { setSaveError(err); }
    finally { setSaving(false); }
  }

  function setLink() {
    const href = window.prompt("Link address (https://…)");
    if (href === null) return;
    if (href === "") editor.chain().focus().unsetLink().run();
    else editor.chain().focus().setLink({ href }).run();
  }

  const tb = (label, run, active) => (
    <Button type="button" size="sm" variant={active ? "default" : "outline"} onClick={run}>{label}</Button>
  );
  const hasText = editor ? editor.getText().trim().length > 0 : false; const errors = (attempted || hasText) ? (check?.errors ?? []) : []; const warnings = check?.warnings ?? []; const roles = check?.roles ?? [];
  const canSave = !saving && !loading && (templateId || name.trim() !== "");

  if (loadError) return <div className="p-6 text-ui text-bad" data-testid="sw-load-error">{loadError instanceof ApiError ? loadError.message : String(loadError?.message ?? loadError)}</div>;

  return (
    <div className="flex flex-col gap-4 p-4" data-testid="source-writer">
      <div className="flex flex-wrap items-center gap-2">
        <Input className="min-w-[220px] max-w-[420px]" placeholder="Template name" data-testid="sw-name" value={name} disabled={!!templateId} onChange={(e) => setName(e.target.value)} />
        <div className="ml-auto flex gap-2">
          <Button variant="outline" onClick={() => { setPreviewOpen(true); }} data-testid="sw-preview"><FlowIcon name="eye" size={14} />Preview</Button>
          <Button variant="outline" onClick={() => go("/documents/templates")}>Cancel</Button>
          <Button onClick={save} disabled={!canSave} data-testid="sw-save">{saving ? "Saving…" : "Next"}</Button>
        </div>
      </div>
      <style>{SLASH_CSS}</style>
      <p className="text-caption text-mute">Type / to add a heading, field, clause, table or page break.</p>
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-4xl" data-testid="sw-preview-dialog">
          <DialogTitle>Preview</DialogTitle>
          <div className="flex flex-wrap gap-2">
            <NativeSelect value={pView} onChange={(e) => setPView(e.target.value)} data-testid="sw-preview-view">{PREVIEW_VIEWS.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}</NativeSelect>
            <NativeSelect value={pAs} onChange={(e) => setPAs(e.target.value)} data-testid="sw-preview-as"><option value="">Everyone</option>{people.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}</NativeSelect>
          </div>
          <iframe title="Preview" srcDoc={previewSrc} sandbox="" className="h-[60vh] w-full border-0" data-testid="sw-preview-frame" />
        </DialogContent>
      </Dialog>
      {saveError ? <div className="text-ui text-bad" data-testid="sw-save-error">{saveError.message ?? String(saveError)}</div> : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="rounded-card border border-line bg-surface">
          {editor ? (
            <div className="flex flex-wrap gap-1 border-b border-line p-2" data-testid="sw-toolbar">
              {tb("H1", () => editor.chain().focus().toggleHeading({ level: 1 }).run(), editor.isActive("heading", { level: 1 }))}
              {tb("H2", () => editor.chain().focus().toggleHeading({ level: 2 }).run(), editor.isActive("heading", { level: 2 }))}
              {tb("H3", () => editor.chain().focus().toggleHeading({ level: 3 }).run(), editor.isActive("heading", { level: 3 }))}
              {tb("Bold", () => editor.chain().focus().toggleBold().run(), editor.isActive("bold"))}
              {tb("Italic", () => editor.chain().focus().toggleItalic().run(), editor.isActive("italic"))}
              {tb("Underline", () => editor.chain().focus().toggleUnderline().run(), editor.isActive("underline"))}
              {tb("Link", setLink, editor.isActive("link"))}
              {tb("Bullets", () => editor.chain().focus().toggleBulletList().run(), editor.isActive("bulletList"))}
              {tb("Numbered", () => editor.chain().focus().toggleOrderedList().run(), editor.isActive("orderedList"))}
              {tb("Table", () => editor.chain().focus().insertTable({ rows: 2, cols: 2, withHeaderRow: true }).run(), editor.isActive("table"))}
              {tb("Rule", () => editor.chain().focus().setHorizontalRule().run(), false)}
            </div>
          ) : null}
          <div className="min-h-[360px] p-4 text-ui" data-testid="sw-editor"><EditorContent editor={editor} /></div>
        </div>

        <div className="flex flex-col gap-4">
          <section className="rounded-card border border-line bg-surface p-3" data-testid="sw-slots">
            <div className="mb-2 flex items-center justify-between"><h3 className="text-ui font-medium">People</h3><Button size="sm" variant="outline" onClick={addSlot} data-testid="sw-slot-add">Add person</Button></div>
            {slots.length === 0 ? <p className="text-caption text-mute">Nobody yet. A contract needs at least one signer.</p> : null}
            {slots.map((s, i) => (
              <div key={s.key} className="mb-2 flex gap-1" data-testid="sw-slot">
                <Input placeholder="Name" value={s.label} onChange={(e) => editSlot(i, { label: e.target.value, role: e.target.value })} />
                <Button size="sm" variant="outline" onClick={() => removeSlot(i)} aria-label="Remove signer">×</Button>
              </div>
            ))}
          </section>

          <section className="rounded-card border border-line bg-surface p-3" data-testid="sw-tabs">
            <Tabs.Root value={tab} onValueChange={(v) => { setTab(v); if (v === "clauses") loadClauses(); }}>
              <Tabs.List className="mb-3 flex gap-1 border-b border-line">
                {WRITER_TABS.map((wt) => (
                  <Tabs.Trigger key={wt.id} value={wt.id} data-testid={`sw-tab-${wt.id}`} className="inline-flex min-h-9 items-center gap-1.5 border-b-2 border-transparent px-3 text-ui data-[state=active]:border-ink data-[state=active]:font-medium"><FlowIcon name={wt.icon} size={14} />{wt.label}</Tabs.Trigger>
                ))}
              </Tabs.List>
              <Tabs.Content value="fields">
                {FIELD_GROUPS.map((g) => (
                  <div key={g.id} className="mb-2">
                    <p className="mb-1 text-caption uppercase tracking-wide text-mute">{g.label}</p>
                    <div className="grid grid-cols-3 gap-1.5">
                      {FIELD_TYPES.filter((f) => f.group === g.id).map((f) => (
                        <button key={f.id} type="button" aria-pressed={fType === f.id} onClick={() => setFType(f.id)} data-testid={`sw-ft-${f.id}`} className={`flex min-h-14 flex-col items-center justify-center gap-1 rounded-control border border-line px-1 text-caption ${fType === f.id ? "bg-ink text-white" : "bg-surface"}`}><FlowIcon name={f.icon} size={16} />{f.label}</button>
                      ))}
                    </div>
                  </div>
                ))}
                <label className="mb-1 mt-2 block text-caption text-mute">Who fills it in</label>
                <NativeSelect value={fRole} onChange={(e) => setFRole(e.target.value)} disabled={!people.length} data-testid="sw-field-role">
                  <option value="">{people.length ? "Choose a person" : "Add a person first"}</option>
                  {people.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                </NativeSelect>
                <Input className="mt-2" placeholder="Label (optional)" value={fLabel} onChange={(e) => setFLabel(e.target.value)} data-testid="sw-field-label" />
                {["dropdown", "select", "multiselect"].includes(fType) ? <Input className="mt-2" placeholder="Choices, separated by commas" value={fOptions} onChange={(e) => setFOptions(e.target.value)} data-testid="sw-field-options" /> : null}
                <Button className="mt-2" size="sm" disabled onClick={() => insertField()} data-testid="sw-field-insert">Insert field</Button>
                <p className="mt-1 text-caption text-mute" data-testid="sw-field-note">Agreements in Workbench collect signatures in the signature block and take client details from merge fields, so blanks for a person to fill in are not available here.</p>
                <p className="mb-1 mt-3 text-caption uppercase tracking-wide text-mute">Fill in with the signer's own details</p>
                <div className="flex flex-wrap gap-1.5">{AUTOFILL_PRESETS.map((pr) => <Button key={pr.id} size="sm" variant="outline" disabled onClick={() => insertField({ label: pr.label, type: pr.type })} data-testid={`sw-auto-${pr.id}`}><FlowIcon name={pr.icon} size={14} />{pr.label}</Button>)}</div>
                <p className="mb-1 mt-3 text-caption uppercase tracking-wide text-mute">Merge field</p>
                <NativeSelect value={mergePick} onChange={(e) => insertMerge(e.target.value)} data-testid="sw-merge">
                  <option value="">Insert a merge field…</option>
                  {mergeNames.map((m) => <option key={m.name} value={m.name}>{m.label} ({m.name})</option>)}
                </NativeSelect>
              </Tabs.Content>
              <Tabs.Content value="clauses">
                {!clauses ? <p className="text-caption text-mute">Loading…</p> : clauses.length === 0 ? <p className="text-caption text-mute" data-testid="sw-clauses-empty">No clauses saved yet.</p> : clauses.map((c) => (
                  <div key={c.id} className="mb-2 rounded-control border border-line p-2"><p className="text-ui font-medium">{c.name}</p>{c.gist ? <p className="text-caption text-mute">{c.gist}</p> : null}<Button className="mt-1" size="sm" variant="outline" onClick={() => editor.chain().focus().insertContent(c.nodes).run()} data-testid={`sw-clause-${c.id}`}>Insert</Button></div>
                ))}
              </Tabs.Content>
              <Tabs.Content value="settings">
                <label className="mb-1 block text-caption text-mute">Paper</label>
                <NativeSelect value={paper} onChange={(e) => setPaper(e.target.value)} data-testid="sw-paper">{PAPER_CHOICES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</NativeSelect>
              </Tabs.Content>
            </Tabs.Root>
          </section>

          <section className="rounded-card border border-line bg-surface p-3" data-testid="sw-check">
            <h3 className="mb-2 text-ui font-medium">Check</h3>
            {checkError ? <p className="text-caption text-bad">{checkError.message ?? String(checkError)}</p> : null}
            {check?.message ? <p className="text-caption text-mute">{check.message}</p> : null}
            {errors.map((e, i) => <p key={`e${i}`} className="text-caption text-bad">{errText(e)}</p>)}
            {warnings.map((w, i) => <p key={`w${i}`} className="text-caption text-mute">{errText(w)}</p>)}
            {check && errors.length === 0 && warnings.length === 0 ? <p className="text-caption text-mute">Nothing to fix.</p> : null}
            {roles.length ? <p className="mt-2 text-caption text-mute">Roles: {roles.map(errText).join(", ")}</p> : null}
          </section>

          <SourceWriterAi getSource={currentSource} onSource={applyAiSource} />
        </div>
      </div>
    </div>
  );
}
