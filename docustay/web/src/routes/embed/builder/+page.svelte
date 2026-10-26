<script>
  // The embeddable template builder (<docustay-builder>): write a document, drop fields on it, save it as a template. Runs in an iframe on a website the organisation listed.
  // The key for this session is in the link's #fragment (never sent to any server). It can only read and write templates and ends in an hour. Events go to the parent website, and only to it.
  import { onMount } from "svelte";
  import { page } from "$app/state";
  import { makeSourceEditor, sourceJSON, insertFieldTag, SOURCE_EDITOR_CSS } from "$lib/editor/sourceEditor.js";
  const FIELDS = [["signature", "Signature"], ["initials", "Initials"], ["date", "Date"], ["text", "Text"], ["checkbox", "Checkbox"]];
  let el = $state(null), editor = null, name = $state(""), role = $state("Client"), status = $state("loading"), problem = $state(null), saved = $state(null), count = $state({});
  const parent = $derived(page.url.searchParams.get("o") ?? "");
  const key = () => decodeURIComponent((/[#&]k=([^&]+)/.exec(location.hash) ?? [])[1] ?? "");
  const say = (type, detail = {}) => { try { if (window.parent !== window && parent) window.parent.postMessage({ source: "docustay", version: 1, type, ...detail }, parent); } catch { /* no parent */ } };
  const uniq = (base) => { const names = new Set(); editor.state.doc.descendants((n) => { if (n.type.name === "fieldTag") names.add(n.attrs.name); }); if (!names.has(base)) return base; let i = 2; while (names.has(`${base} ${i}`)) i++; return `${base} ${i}`; };
  const add = (type, label) => { if (editor.state.selection.$from.parent.type.name === "heading") editor.commands.focus("end"); return insertFieldTag(editor, { name: uniq(`${role} ${label.toLowerCase()}`), type, role, required: true }); };
  const fields = () => { const out = []; editor?.state.doc.descendants((n) => { if (n.type.name === "fieldTag") out.push(n.attrs); }); return out; };
  const resize = () => say("resize", { height: document.documentElement.scrollHeight });
  onMount(() => {
    if (!key()) { status = "error"; problem = "This link is missing its key. Ask the website for a new one."; say("error", { message: problem }); return; }
    name = page.url.searchParams.get("n") ?? "";
    editor = makeSourceEditor(el, { content: { type: "doc", content: [{ type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: name || "Untitled agreement" }] }, { type: "paragraph" }] }, ariaLabel: "Template body", onUpdate: () => { count = { n: fields().length }; resize(); } });
    status = "ready"; say("ready"); resize(); editor.commands.focus("end");
    return () => editor?.destroy();
  });
  async function save() {
    problem = null;
    const fs = fields();
    if (!fs.some((f) => f.type === "signature")) { problem = "Add at least one signature field, so the document can be signed."; return; }
    if (!name.trim()) { problem = "Give the template a name."; return; }
    status = "saving";
    const r = await fetch("/api/v1/templates/source", { method: "POST", headers: { authorization: `Bearer ${key()}`, "content-type": "application/json", "idempotency-key": crypto.randomUUID() }, body: JSON.stringify({ name: name.trim(), source: sourceJSON(editor) }) });
    const j = await r.json().catch(() => null);
    if (!r.ok) { status = "ready"; problem = r.status === 401 ? "This session has ended. Ask the website for a new one." : (j?.error?.message ?? "That did not save."); say("error", { message: problem }); return; }
    saved = j; status = "saved"; say("saved", { templateId: j.templateId, name: name.trim(), fields: j.fields ?? fs.length });
  }
</script>
<svelte:head><title>Template builder · Docustay</title><meta name="robots" content="noindex" />{@html `<style>${SOURCE_EDITOR_CSS}</style>`}</svelte:head>
<div class="mx-auto flex max-w-4xl flex-col gap-3 p-3" data-testid="builder">
  <div class="flex flex-wrap items-end gap-2">
    <label class="min-w-48 flex-1"><span class="label">Template name</span><input class="field" bind:value={name} maxlength="120" data-testid="builder-name" /></label>
    <label><span class="label">Fields are for</span><select class="field" bind:value={role} data-testid="builder-role"><option>Client</option><option>Company</option><option>Witness</option></select></label>
    <button class="btn primary" onclick={save} disabled={status !== "ready"} data-testid="builder-save">{status === "saving" ? "Saving…" : "Save template"}</button>
  </div>
  <div class="flex flex-wrap gap-1.5" role="toolbar" aria-label="Add a field">{#each FIELDS as [type, label]}<button class="btn !min-h-9" onclick={() => add(type, label)} disabled={status !== "ready"} data-testid="builder-add-{type}">+ {label}</button>{/each}</div>
  {#if problem}<p class="rounded-lg border border-bad-line bg-bad-bg px-3 py-2 text-sm text-bad" role="alert" data-testid="builder-problem">{problem}</p>{/if}
  {#if status === "saved"}<p class="rounded-lg border border-ok-line bg-ok-bg px-3 py-2 text-sm text-ok" role="status" data-testid="builder-saved">Saved. Template id {saved?.templateId}.</p>{/if}
  <div class="rounded-xl border border-line bg-[var(--paper-doc,#fff)] p-5 text-[var(--ink-doc,#15171c)]"><div bind:this={el} data-testid="builder-editor"></div></div>
</div>
