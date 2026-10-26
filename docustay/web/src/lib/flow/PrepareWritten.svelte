<script>
  // PREPARE for a WRITTEN document (steps 3 of the document flow): the palette on the left (drag a tile onto the text, or click it once to put it at the cursor), "Fields are for" and "View as" on top,
  // the editable document in the middle, and on the right a panel for the SELECTED field or section. A field's label comes from its type and its person from "Fields are for": nothing is typed to add one.
  import { onMount, onDestroy } from "svelte";
  import { NodeSelection } from "@tiptap/pm/state";
  import { t } from "$lib/i18n/index.svelte.js";
  import { validateFieldValue } from "$lib/validate.js";
  import { tl } from "./flowLabels.js";
  import { AUDIENCES, FILLED_BY, fieldType } from "./flowDefinition.js";
  import { specOf, isMark } from "./palette.js";
  import { slugWord, seatsOnce } from "./roles.js";
  import Palette from "./Palette.svelte";
  import { SEAT_COLOURS } from "../editor/fields.js";
  const senderProblem = (a) => { const v = a?.default; if (!v || typeof v !== "string" || v.startsWith("{{")) return null; return validateFieldValue({ type: "text", validation: a.type, max_length: a.max_length }, v); };
  import { makeSourceEditor, sourceJSON, senderSections, dropField, slashExtension, FIELD_MIME, SOURCE_EDITOR_CSS, SENDER_CSS, SLASH_CSS } from "../editor/sourceEditor.js";
  import Pick from "../ui/Pick.svelte";
  import Seg from "./Seg.svelte";
  import OptionEditor from "./OptionEditor.svelte";
  import FlowIcon from "./FlowIcon.svelte";
  import { chatBridge } from "../chat/bridge.js";
  import StripeGate from "../ai/StripeGate.svelte";
  import { variablesOf } from "./roles.js";
  let { initial, initialCustom = {}, people = [], mode = "document", onchange = () => {}, api = $bindable({}) } = $props();
  const WITH_OPTIONS = ["dropdown", "multiselect", "select"];
  let el, editor = null, ready = $state(false), unregisterChat = null;
  let forRole = $state(people[0]?.roleWord ?? ""), viewAs = $state("everyone");
  let sel = $state(null);      // { kind: "field"|"custom", pos, attrs } the selected chip
  let sec = $state(null);      // { pos, attrs } the heading of the section the cursor is in
  let custom = $state({ ...initialCustom });     // sender-first values: { "custom.company": "Acme" }
  let hasPayment = $state(false);
  const scanPayment = (j) => { let f = false; const w = (n) => { if (n?.type === "fieldTag" && n.attrs?.type === "payment") f = true; (n?.content ?? []).forEach(w); }; w(j); hasPayment = f; };
  // not connected: remove the payment field(s) and leave the payment terms written in the text
  function keepTermsAsText() { if (!editor) return; const hits = []; editor.state.doc.descendants((n, pos) => { if (n.type.name === "fieldTag" && n.attrs.type === "payment") hits.push([pos, n.nodeSize]); }); const tr = editor.state.tr; for (const [pos, size] of hits.reverse()) tr.delete(pos, pos + size); editor.view.dispatch(tr); }
  let empty = $state(true), fieldsHidden = $state(0), full = $state(false);
  const personOpts = $derived(people.map((p, i) => ({ value: p.roleWord, label: p.roleWord && (p.name ?? "").trim() && p.name.trim() !== p.roleWord ? `${p.roleWord} (${p.name.trim()})` : (p.name || p.roleWord), dot: SEAT_COLOURS[i % SEAT_COLOURS.length] })).filter((o, i, all) => all.findIndex((x) => x.value === o.value) === i));   // R10-55: a signing group is several people in ONE seat (one role word): list the seat once, or the keyed lists below see a duplicate key and Prepare never renders
  const viewOpts = $derived([{ value: "everyone", label: t("Everyone") }, { value: "sender", label: t("Sender") }, ...personOpts.map((o) => ({ ...o, label: o.label }))]);
  const colourStyle = $derived(people.map((p, i) => `.rich-body .field-chip[data-field-role="${CSS.escape(p.roleWord)}"]{--chip:${SEAT_COLOURS[i % SEAT_COLOURS.length]}}`).join("\n"));
  const viewStyle = $derived(viewAs === "everyone" ? "" : viewAs === "sender" ? `.rich-body .field-chip{opacity:.35}` : `.rich-body .ds-sender{display:none}.rich-body .field-chip:not([data-field-role="${CSS.escape(viewAs)}"]){opacity:.3}`);

  const uniq = (base) => { const names = new Set(); editor.state.doc.descendants((n) => { if (n.type.name === "fieldTag") names.add(n.attrs.name); }); if (!names.has(base)) return base; let i = 2; while (names.has(`${base} ${i}`)) i++; return `${base} ${i}`; };
  const attrsFor = (id) => { const sp = specOf(id); const label = sp.label ? ({ Name: t("Name"), Email: t("Email"), Company: t("Company"), Title: t("Title") })[sp.label] : tl(fieldType(sp.tag)?.label ?? sp.tag); return { name: uniq(label), type: sp.tag, role: forRole || people[0]?.roleWord || "", label, required: true, ...(sp.autofill ? { autofill: sp.autofill } : {}), ...(WITH_OPTIONS.includes(sp.tag) ? { options: "Option 1, Option 2" } : {}), ...(sp.tag === "payment" ? { amount: "50.00", currency: "usd" } : {}) }; };
  const nodeFor = (type) => [{ type: "fieldTag", attrs: attrsFor(type) }, { type: "text", text: " " }];
  function selectNew(name) { let at = -1; editor.state.doc.descendants((n, pos) => { if (n.type.name === "fieldTag" && n.attrs.name === name) at = pos; return at < 0; }); if (at >= 0) editor.chain().setNodeSelection(at).run(); readSelection(); }
  // SENDER ONLY SECTIONS hold nothing a signer sees, so a field cannot live there: [start, end) of the Sender only section a position is in, or null
  function senderRange(doc, pos) {
    let cut = null, start = 0, hit = null;
    doc.forEach((node, offset) => {
      if (node.type.name !== "heading") return;
      const lv = node.attrs.level ?? 1;
      if (cut != null && lv <= cut) { if (hit == null && pos >= start && pos < offset) hit = [start, offset]; cut = null; }
      if (cut == null && node.attrs.audience === "sender") { cut = lv; start = offset; }
    });
    if (cut != null && pos >= start && hit == null) hit = [start, doc.content.size];
    return hit;
  }
  let note = $state("");
  const flash = (m) => { note = m; setTimeout(() => { if (note === m) note = ""; }, 5000); };
  // a heading is plain text, so a field aimed at one goes on its own line right after it; a field aimed into a Sender only section goes just after the section
  const insertAt = (type, pos) => {
    if (!editor) return; const nodes = nodeFor(type); const c = editor.chain().focus();
    const doc = editor.state.doc, at = Math.min(pos ?? editor.state.selection.from, doc.content.size), rp = doc.resolve(at);
    const sr = senderRange(doc, at);
    if (sr) {
      // a section runs until the next heading, so "after it" means under the next heading (or under a new one when it runs to the end)
      let end = sr[1], guard = 0, extra = null, level = doc.nodeAt(sr[0])?.attrs?.level ?? 2;
      for (;;) {
        const h = end < doc.content.size ? doc.nodeAt(end) : null;
        if (!h) { extra = { type: "heading", attrs: { level }, content: [{ type: "text", text: t("Signatures") }] }; break; }
        end += h.nodeSize; const again = h.attrs.audience === "sender" ? senderRange(doc, end - 1) : null;
        if (!again || ++guard > 20) break; end = again[1];
      }
      c.insertContentAt(end, extra ? [extra, { type: "paragraph", content: nodes }] : { type: "paragraph", content: nodes }); flash(t("That part is Sender only, so signers would never see the field. It went just after it instead.")); }
    else if (rp.parent.type.name === "heading") c.insertContentAt(rp.after(rp.depth), { type: "paragraph", content: nodes });
    else (pos == null ? c.insertContent(nodes) : c.insertContentAt(pos, nodes));
    c.run(); selectNew(nodes[0].attrs.name);
  };
  const clickAdd = (type) => { const s = editor?.state.selection; insertAt(type, s?.node ? s.to : null); };   // a selected field is not replaced: the new one goes after it
  const dropAdd = (type, pos) => insertAt(type, pos);
  function insertMerge(m) {
    if (m.name === "__new_var") {   // a question the sender will be asked when the template is used
      const taken = new Set(); editor.state.doc.descendants((n) => { if (n.type.name === "variableChip") taken.add(n.attrs.name); });
      let i = 1; while (taken.has(`custom.var_${i}`)) i += 1;
      editor?.chain().focus().insertContent([{ type: "variableChip", attrs: { name: `custom.var_${i}`, label: t("Question {n}", { n: i }), kind: "text" } }, { type: "text", text: " " }]).run();
      let at = -1; editor.state.doc.descendants((n, pos) => { if (n.type.name === "variableChip" && n.attrs.name === `custom.var_${i}`) at = pos; return at < 0; }); if (at >= 0) editor.chain().setNodeSelection(at).run(); readSelection(); return;
    }
    editor?.chain().focus().insertContent([{ type: "variableChip", attrs: { name: m.name, label: m.label } }, { type: "text", text: " " }]).run();
  }
  const dragStart = (e, type) => { e.dataTransfer.setData(FIELD_MIME, type); e.dataTransfer.setData("text/plain", type); e.dataTransfer.effectAllowed = "copy"; };

  function readSelection() {
    if (!editor) return;
    const { selection, doc } = editor.state; const n = selection.node;
    sel = n?.type.name === "fieldTag" ? { kind: "field", pos: selection.from, attrs: { ...n.attrs } } : n?.type.name === "variableChip" && String(n.attrs.name).startsWith("custom.") && !String(n.attrs.name).startsWith("custom.p_") ? { kind: "custom", pos: selection.from, attrs: { ...n.attrs } } : null;
    // the section the cursor is in: the nearest heading at or before it
    let found = null; doc.forEach((node, offset) => { if (offset <= selection.from && node.type.name === "heading") found = { pos: offset, attrs: { ...node.attrs }, text: node.textContent }; });
    sec = found;
    // fields that sit inside a Sender only section: signers never see them, so say so
    let hidden = 0, cut = null; doc.forEach((node) => { if (node.type.name === "heading") { const lv = node.attrs.level ?? 1; if (cut != null && lv <= cut) cut = null; if (cut == null && node.attrs.audience === "sender") cut = lv; } else if (cut != null) node.descendants((n) => { if (n.type.name === "fieldTag") hidden += 1; }); });
    fieldsHidden = hidden;
  }
  function patchSel(patch) { if (!sel) return; const pos = sel.pos; editor.chain().command(({ tr }) => { tr.setNodeMarkup(pos, null, { ...sel.attrs, ...patch }); tr.setSelection(NodeSelection.create(tr.doc, pos)); return true; }).run(); readSelection(); }
  function setAudience(v) {
    if (!sec) return; const pos = sec.pos;
    if (v === "sender") { let n = 0, inside = false; const lv = sec.attrs.level ?? 1; editor.state.doc.forEach((node, off) => { if (off === pos) inside = true; else if (inside && node.type.name === "heading" && (node.attrs.level ?? 1) <= lv) inside = false; if (inside) node.descendants((x) => { if (x.type.name === "fieldTag") n++; }); }); if (n) { flash(t("This section has {n} fields in it. Move them out first: signers would never see them.", { n })); return; } } editor.chain().command(({ tr }) => { tr.setNodeMarkup(pos, null, { ...sec.attrs, audience: v === "sender" ? "sender" : null }); return true; }).run(); readSelection(); }
  const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "value";
  function setFilledBy(v) {   // Sender first: the field becomes a merge value the sender types here (printed as plain text, signers cannot change it); back to Signer: a text field again
    if (!sel) return; const pos = sel.pos, a = sel.attrs;
    if (v === "sender" && sel.kind === "field") { const name = `custom.${slug(a.label || a.name)}`; custom[name] = custom[name] ?? ""; editor.chain().command(({ tr, state }) => { tr.replaceWith(pos, pos + 1, state.schema.nodes.variableChip.create({ name, label: a.label || a.name })); tr.setSelection(NodeSelection.create(tr.doc, pos)); return true; }).run(); }
    if (v === "signer" && sel.kind === "custom") editor.chain().command(({ tr, state }) => { tr.replaceWith(pos, pos + 1, state.schema.nodes.fieldTag.create({ name: uniq(a.label || "Text"), type: "text", role: forRole || people[0]?.roleWord || "", label: a.label || "Text", required: true })); tr.setSelection(NodeSelection.create(tr.doc, pos)); return true; }).run();
    readSelection();
  }
  function toggleHeading() {   // a heading holds plain text only: a line with a field in it cannot become one
    const parent = editor.state.selection.$from.parent; let plain = true; parent.descendants((n) => { if (!n.isText) plain = false; });
    if (!plain) { note = t("A heading holds plain text only. Move the fields to their own line first."); setTimeout(() => (note = ""), 4000); editor.commands.focus(); return; }
    note = ""; fmt((c) => c.toggleHeading({ level: 2 }));
  }
  const fmt = (fn) => fn(editor.chain().focus()).run();

  // merge text: one entry per person (their name, their email) and the sender's name. A person's own values are given when the document is made; a reusable template can only use the sender's.
  // R13-D361 (R10-55 again): a signing group is several people in ONE seat, so their merge fields are one pair (named by the seat), not one pair each: two pairs with the same name broke the keyed palette list and Prepare never rendered
  const seatPeople = $derived(seatsOnce(people));
  const merges = $derived([...(mode === "template" ? [] : seatPeople.flatMap((p) => [{ name: `custom.p_${slugWord(p.roleWord ?? p.name)}_name`, label: t("Name of {name}", { name: p.label }) }, { name: `custom.p_${slugWord(p.roleWord ?? p.name)}_email`, label: t("Email of {name}", { name: p.label }) }])), { name: "sender.name", label: t("Sender name") }, ...(mode === "template" ? [{ name: "__new_var", label: t("A question for the sender") }] : [])]);
  const slashItems = () => [
    { id: "heading", label: t("Heading"), hint: t("A section title") }, { id: "table", label: t("Table"), hint: t("Rows and columns") }, { id: "pagebreak", label: t("Page break"), hint: t("Start a new page") },
    ...merges.map((m) => ({ id: `m:${m.name}`, label: m.label, hint: t("Filled in when the document is made") })),
    { id: "f:smart_name", label: t("Name field"), hint: t("Fills in the person's name") }, { id: "f:signature", label: t("Signature field"), hint: t("A place to sign") },
  ];
  const slashList = [];   // the "/" menu reads this list live, so merge text follows the people
  $effect(() => { slashList.splice(0, slashList.length, ...slashItems()); });
  function slashPick(id, { editor: ed }) {
    if (id === "heading") ed.chain().focus().toggleHeading({ level: 2 }).run();
    else if (id === "table") ed.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
    else if (id === "pagebreak") ed.chain().focus().insertContent({ type: "pageBreak" }).run();
    else if (id.startsWith("m:")) insertMerge(merges.find((m) => m.name === id.slice(2)) ?? { name: id.slice(2), label: id.slice(2) });
    else if (id.startsWith("f:")) insertAt(id.slice(2), null);
  }
  onMount(() => {
    editor = makeSourceEditor(el, { content: initial, onUpdate: (j) => { onchange(j); empty = editor.isEmpty; scanPayment(j); readSelection(); }, ariaLabel: t("Document body"), extra: [senderSections, dropField(dropAdd), slashExtension({ items: slashList, label: (i) => i.label, onPick: slashPick })] });
    empty = editor.isEmpty; scanPayment(sourceJSON(editor));
    editor.on("selectionUpdate", readSelection); ready = true; readSelection();
    api = { getSource: () => sourceJSON(editor), getCustom: () => $state.snapshot(custom), setSource: (s) => editor.commands.setContent(s, { emitUpdate: true }) };
    unregisterChat?.(); unregisterChat = chatBridge.register({ getSource: () => sourceJSON(editor), apply: (s) => editor.commands.setContent(s, { emitUpdate: true }) });   // the floating assistant reads and changes THIS editor
  });
  onDestroy(() => { unregisterChat?.(); editor?.destroy(); });
</script>
<svelte:head>{@html `<style>${SOURCE_EDITOR_CSS}${SENDER_CSS}${SLASH_CSS}</style>`}</svelte:head>
{@html `<style>${colourStyle}${viewStyle}.rich-body{--ds-sender-note:"${t("Sender only: not in what signers see")}"}</style>`}
<svelte:window onkeydown={(e) => { if (e.key === "Escape" && full) full = false; }} />
<!-- R13-D304: one column that may not grow past the screen below lg; the implicit column grew to the palette's full row (22 tools) and pushed the page ~530 px off a phone -->
<div class="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[12.5rem_minmax(0,1fr)_16rem] {full ? 'fixed inset-0 z-40 overflow-auto bg-paper p-4' : ''}" data-testid="prepare" data-full={full ? "1" : "0"}>
  <aside class="min-w-0"><Palette onadd={clickAdd} ondragstart={dragStart} onmerge={insertMerge} {merges} hint={t("Drag onto the document, or click to add at the cursor")} /></aside>
  <section class="min-w-0">
    <div class="flex flex-wrap items-end gap-x-6 gap-y-2">
      <div class="w-56"><Pick options={personOpts} value={forRole} onchange={(v) => (forRole = v)} label={t("Fields are for")} placeholder={t("Choose a person")} testid="pp-for" /></div>
      <Seg options={viewOpts} value={viewAs} onchange={(v) => (viewAs = v)} label={t("View as")} testid="pp-view" inline />
      <button class="btn !min-h-9 !py-1 ml-auto text-sm" onclick={() => (full = !full)} aria-pressed={full} data-testid="pp-full">{full ? t("Exit full screen") : t("Full screen")}</button>
    </div>
    <div class="paper-ground mt-3 rounded-md p-3 sm:p-6"><div class="mx-auto w-full max-w-[816px]">
      {#if hasPayment}<div class="mb-2"><StripeGate ontextonly={keepTermsAsText} testid="pp-pay-gate" /></div>{/if}
      {#if fieldsHidden}<p class="notice warn mb-2" role="status" data-testid="pp-hidden-fields">{t("Fields inside a Sender only section: {n}. No signer will see them.", { n: fieldsHidden })}</p>{/if}
      <div class="mb-2 flex flex-wrap gap-1.5" role="toolbar" aria-label={t("Formatting")} onmousedown={(e) => e.preventDefault()}>
        <button class="btn !min-h-9 !py-1 text-sm" onclick={toggleHeading} data-testid="pp-h">{t("Heading")}</button>
        <button class="btn !min-h-9 !py-1 text-sm font-bold" onclick={() => fmt((c) => c.toggleBold())} aria-label={t("Bold")}>B</button>
        <button class="btn !min-h-9 !py-1 text-sm italic" onclick={() => fmt((c) => c.toggleItalic())} aria-label={t("Italic")}>I</button>
        <button class="btn !min-h-9 !py-1 text-sm" onclick={() => fmt((c) => c.toggleBulletList())}>• {t("List")}</button>
        <button class="btn !min-h-9 !py-1 text-sm" onclick={() => fmt((c) => c.insertTable({ rows: 3, cols: 3, withHeaderRow: true }))}>{t("Table")}</button>
        <button class="btn !min-h-9 !py-1 text-sm" onclick={() => fmt((c) => c.insertContent({ type: "pageBreak" }))}>{t("Page break")}</button>
      </div>
      {#if note}<p class="notice warn mb-2" role="status" data-testid="pp-note">{note}</p>{/if}
      <div class="sheet" role="presentation" onclick={(e) => { if (e.target === e.currentTarget || e.target.classList?.contains("ProseMirror")) editor?.commands.focus("end"); }} data-testid="pp-page">
        {#if empty}<p class="sheet-hint" data-testid="pp-hint">{t("Type here, or drag a field in.")}</p>{/if}
        <div bind:this={el} data-testid="pp-editor"></div>
      </div>
    </div></div>
  </section>
  <aside class="space-y-3" aria-label={t("Settings of the selected item")}>
    {#if sel?.kind === "field"}
      <section class="rounded-xl border border-line p-3" data-testid="pp-field-panel">
        <h2 class="font-semibold">{t("Selected field")}</h2>
        <div class="mt-2 grid gap-3">
          <Pick options={personOpts} value={sel.attrs.role} onchange={(v) => patchSel({ role: v })} label={t("Belongs to")} testid="pp-belongs" />
          <Seg options={FILLED_BY.map((o) => ({ value: o.id, label: tl(o.label) }))} value={sel.attrs.filled === "sender" ? "sender" : "signer"} onchange={(v) => (sel.attrs.filled === "sender" ? (v === "signer" && patchSel({ filled: null, from: null })) : setFilledBy(v))} label={t("Filled in by")} testid="pp-filledby" disabled={mode === "template" && sel.attrs.filled !== "sender"} />
          <!-- Run 9 (R8-57): a ready-made box the sender fills in (filled=sender) keeps its place in the text; the sender's answer is typed here and signers cannot change it -->
          {#if sel.attrs.filled === "sender"}<label class="grid gap-1 text-sm"><span>{t("Your answer")}</span><input class="field !py-1.5" value={sel.attrs.default ?? (sel.attrs.from ? `{{${sel.attrs.from}}}` : "")} oninput={(e) => patchSel({ default: e.currentTarget.value || null, from: null })} data-testid="pp-sender-value" aria-invalid={senderProblem(sel.attrs) ? true : undefined} /></label>{#if senderProblem(sel.attrs)}<p class="text-xs text-danger" role="alert" data-testid="pp-sender-problem">{t("Your answer")} {senderProblem(sel.attrs)}. {t("The signer cannot change it, so fix it here.")}</p>{/if}{#if sel.attrs.from && !sel.attrs.default}<p class="text-xs text-mute">{t("Filled in from your organisation's details when you send. Type over it to use your own words.")}</p>{/if}{/if}
          <label class="flex items-center gap-2 text-sm"><input type="checkbox" checked={sel.attrs.required !== false && sel.attrs.required !== "false"} onchange={(e) => patchSel({ required: e.currentTarget.checked })} data-testid="pp-required" /> {t("Required")}</label>
          {#if sel.attrs.autofill}<label class="flex items-center gap-2 text-sm"><input type="checkbox" checked={sel.attrs.editable === true || sel.attrs.editable === "true"} onchange={(e) => patchSel({ editable: e.currentTarget.checked ? true : null })} data-testid="pp-editable" /> {t("Signer can change it")}</label>{/if}
          <label class="grid gap-1 text-sm"><span>{t("Label")}</span><input class="field !py-1.5" value={sel.attrs.label ?? ""} oninput={(e) => patchSel({ label: e.currentTarget.value })} data-testid="pp-label" /></label>
          {#if ["text", "email", "number", "phone", "zip", "date"].includes(sel.attrs.type) && !sel.attrs.autofill}<Pick options={[{ value: "text", label: t("Anything") }, { value: "email", label: t("Email") }, { value: "number", label: t("Number") }, { value: "phone", label: t("Phone") }, { value: "zip", label: t("ZIP code") }, { value: "date", label: t("Date") }]} value={sel.attrs.type} onchange={(v) => patchSel({ type: v })} label={t("Format")} testid="pp-format" />
            <label class="grid gap-1 text-sm"><span>{t("Placeholder")}</span><input class="field !py-1.5" value={sel.attrs.placeholder ?? ""} oninput={(e) => patchSel({ placeholder: e.currentTarget.value || null })} data-testid="pp-placeholder" /></label>{/if}
          {#if !isMark(sel.attrs.type) && sel.attrs.type !== "payment"}<label class="grid gap-1 text-sm"><span>{t("Tooltip")}</span><input class="field !py-1.5" value={sel.attrs.tooltip ?? ""} oninput={(e) => patchSel({ tooltip: e.currentTarget.value || null })} data-testid="pp-tooltip" /></label>{/if}
          {#if WITH_OPTIONS.includes(sel.attrs.type)}<OptionEditor options={String(sel.attrs.options ?? "").split(",").map((x) => x.trim()).filter(Boolean)} value={sel.attrs.default ?? ""} locked={sel.attrs.locked === true || sel.attrs.locked === "true"} multi={sel.attrs.type === "multiselect"} onchange={(v) => patchSel({ options: v.options.join(", "), default: v.default || null, locked: v.locked ? true : null })} testid="pp-opt" />{/if}
          {#if sel.attrs.type === "text" && !sel.attrs.autofill}<label class="grid gap-1 text-sm"><span>{t("Longest answer (characters)")}</span><input class="field !py-1.5" type="number" min="1" max="5000" value={sel.attrs.max_length ?? ""} oninput={(e) => patchSel({ max_length: e.currentTarget.value || null })} /></label>{/if}
        </div>
        <button type="button" class="btn quiet mt-3 !text-bad" onclick={() => editor?.chain().focus().deleteSelection().run()} data-testid="pp-field-remove">{t("Remove")}</button>   <!-- R10-45: a field could only be deleted with the keyboard -->
      </section>
    {:else if sel?.kind === "custom" && mode === "template"}
      <section class="rounded-xl border border-line p-3" data-testid="pp-var-panel">
        <h2 class="font-semibold">{t("A question for the sender")}</h2>
        <p class="mt-1 text-sm text-mute">{t("Whoever uses this template is asked this before sending, and the answer goes into the words.")}</p>
        <div class="mt-2 grid gap-3">
          <label class="grid gap-1 text-sm"><span>{t("Question")}</span><input class="field !py-1.5" value={sel.attrs.label ?? ""} oninput={(e) => patchSel({ label: e.currentTarget.value })} data-testid="pp-var-label" /></label>
          <Seg options={[{ value: "text", label: t("Text") }, { value: "number", label: t("Number") }, { value: "money", label: t("Money") }, { value: "date", label: t("Date") }]} value={sel.attrs.kind ?? "text"} onchange={(v) => patchSel({ kind: v })} label={t("Answer is")} testid="pp-var-kind" />
          <label class="grid gap-1 text-sm"><span>{t("Starting answer")}</span><input class="field !py-1.5" value={sel.attrs.default ?? ""} oninput={(e) => patchSel({ default: e.currentTarget.value || null })} data-testid="pp-var-default" /></label>
          <label class="grid gap-1 text-sm"><span>{t("A line of help")}</span><input class="field !py-1.5" value={sel.attrs.help ?? ""} oninput={(e) => patchSel({ help: e.currentTarget.value || null })} data-testid="pp-var-help" /></label>
        </div>
      </section>
    {:else if sel?.kind === "custom"}
      <section class="rounded-xl border border-line p-3" data-testid="pp-custom-panel">
        <h2 class="font-semibold">{t("Filled in by you")}</h2>
        <p class="mt-1 text-sm text-mute">{t("Signers see this but cannot change it.")}</p>
        <label class="mt-2 grid gap-1 text-sm"><span>{sel.attrs.label}</span><input class="field !py-1.5" bind:value={custom[sel.attrs.name]} data-testid="pp-custom-value" /></label>
        <div class="mt-2"><Seg options={FILLED_BY.map((o) => ({ value: o.id, label: tl(o.label) }))} value="sender" onchange={setFilledBy} label={t("Filled in by")} testid="pp-filledby" /></div>
      </section>
    {/if}
    {#if sec}
      <section class="rounded-xl border border-line p-3" data-testid="pp-section-panel">
        <h2 class="font-semibold">{t("Selected section")}</h2>
        <p class="mt-1 truncate text-sm text-mute">{sec.text}</p>
        <div class="mt-2"><Seg options={AUDIENCES.map((o) => ({ value: o.id, label: tl(o.label) }))} value={sec.attrs.audience === "sender" ? "sender" : "everyone"} onchange={setAudience} label={t("Who sees it")} testid="pp-audience" /></div>
        {#if sec.attrs.audience === "sender"}<p class="mt-2 text-xs text-mute">{tl("Only you see this. It is not in what signers see, sign or receive.")}</p>
        {/if}
      </section>
    {/if}
    {#if !sel && !sec}
      <section class="rounded-xl border border-line p-3" data-testid="pp-people-panel">
        <p class="text-sm text-mute">{t("Click a field or a heading to change it.")}</p>
        <ul class="mt-3 space-y-1.5">{#each people as p, i (`${p.roleWord}:${i}`)}<li class="flex items-center gap-2 text-sm"><span class="inline-block size-2.5 rounded-full" style="background:{SEAT_COLOURS[i % SEAT_COLOURS.length]}"></span>{p.name || p.roleWord}</li>{/each}</ul>
      </section>
    {/if}
  </aside>
</div>
<style>
  /* R8-39: the page margins follow the SHEET's width (a full 816px page keeps 72/80px); at 1024px wide the sheet is ~390px and fixed 80px margins left the words 226px */
  .sheet { background-image: repeating-linear-gradient(to bottom, transparent 0, transparent 1055px, rgba(150,130,90,.35) 1055px, rgba(150,130,90,.35) 1056px); position: relative; background: #fff; color: #1a1a1a; border: 1px solid var(--line, #ddd6c5); box-shadow: 0 1px 2px rgba(0,0,0,.06), 0 8px 24px rgba(60,50,30,.08); border-radius: 4px; min-height: 1056px; padding: clamp(28px, 8.8%, 72px) clamp(22px, 9.8%, 80px); }
  .sheet :global(.ProseMirror) { min-height: 880px; outline: none; }
  .sheet-hint { position: absolute; top: clamp(28px, 8.8%, 72px); left: clamp(22px, 9.8%, 80px); right: clamp(22px, 9.8%, 80px); margin: 0; color: #9a927f; pointer-events: none; }
  @media (max-width: 820px) { .sheet :global(.ProseMirror) { min-height: 50vh; } .sheet { min-height: 60vh; padding: 28px 22px; } .sheet-hint { top: 28px; left: 22px; right: 22px; } }
</style>
