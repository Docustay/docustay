<script>
  // A AUTOMATION THAT RUNS (Run 9 Part 3.6, board "Automation"; R9-a, R9-b; Pro `automations`). One column on a dotted canvas — When, Only if, Then send, Wait, Then — joined by moving wires,
  // with "+" under the last card and the step's settings on the right. "On · ran N times", Test run (walks it with the last signed answers and sends nothing) and Save. The server checks
  // the flow again and says what is wrong, on the card it is about. Free sees the whole screen; Save and On wear the Pro lock (the server refuses them anyway).
  import { onMount, untrack } from "svelte";
  import { page } from "$app/state";
  import { goto } from "$app/navigation";
  import { SvelteFlow, Background, BackgroundVariant, Controls } from "@xyflow/svelte";
  import "@xyflow/svelte/dist/style.css";
  import { api } from "$lib/api.js";
  import { live } from "$lib/live.js";
  import { t, i18n } from "$lib/i18n/index.svelte.js";
  import ProLock from "$lib/pro/ProLock.svelte";
  import { entitled, loadPlan } from "$lib/pro/plan.svelte.js";
  import StepNode from "$lib/automations/StepNode.svelte";
  import AddNode from "$lib/automations/AddNode.svelte";
  import FitOnChange from "$lib/automations/FitOnChange.svelte";
  import { blankFlow, blankStep, canvas, kindLabel, logLine, ruleFrom, ruleParts, runStatus } from "$lib/automations/flow.js";
  import { problemText } from "$lib/automations/problems.js";
  const un = (r) => r.json?.data ?? r.json;
  const id = $derived(page.params.id);
  let templates = $state([]), book = $state(null), runs = $state([]), flow = $state(blankFlow()), title = $state(""), selected = $state("when");
  let loaded = $state(false), problem = $state(null), problems = $state([]), saving = $state(false), note = $state(null), adding = $state(false), test = $state(null), testing = $state(false), dirty = $state(false);
  const nodeTypes = { step: StepNode, add: AddNode };
  let nodes = $state.raw([]), edges = $state.raw([]);
  $effect(() => { const c = canvas(flow, { templates, selected, problems, add: { open: adding, ontoggle: () => (adding = !adding), onadd: add } }); void i18n.lang; nodes = c.nodes; edges = c.edges; });

  async function load() {
    const [tr, br] = await Promise.all([api("/api/documents/automations/templates"), id === "new" ? Promise.resolve(null) : api(`/api/documents/automations/${id}`)]);
    loaded = true;
    if (!tr.ok) { problem = tr.error ?? t("The templates could not be loaded."); return; }
    templates = un(tr).templates ?? [];
    if (br) {
      if (!br.ok) { problem = br.error ?? t("That automation could not be loaded."); return; }
      const d = un(br); book = d.automation; runs = d.runs ?? [];
      if (!dirty) { flow = structuredClone(d.automation.flow); title = d.automation.title; }
    }
    problem = null;
  }
  onMount(() => { loadPlan?.(); load(); return live(["documents", "plays"], () => { if (id !== "new") load(); }); });
  const touch = () => { dirty = true; note = null; test = null; };

  const pro = $derived(entitled("playbooks") !== false);
  const src = $derived(templates.find((x) => x.id === flow.when.templateId) ?? null);
  const sendable = $derived(templates.filter((x) => x.signers === 1));
  // Run 9 Part 4R: a built-in template from the library the workspace has not used yet is listed as builtin:<slug>; choosing it makes the workspace's copy first, then names that
  async function chosen(value, set) {
    if (!String(value).startsWith("builtin:")) { set(value); touch(); return; }
    const r = await api("/api/documents/library/master", { method: "POST", body: { slug: value.slice(8) } });
    if (!r.ok) { problem = r.error ?? t("That template could not be used."); return; }
    const tr = await api("/api/documents/automations/templates"); if (tr.ok) templates = un(tr).templates ?? [];
    set(un(r).templateId); touch();
  }
  const optLabel = (x) => (x.kind === "form" ? t("{name} (form)", { name: x.name }) : x.name) + (x.builtin ? ` · ${t("built-in")}` : "");
  const step = $derived(selected === "when" ? { id: "when", kind: "when" } : flow.steps.find((s) => s.id === selected) ?? null);
  const stepIndex = $derived(flow.steps.findIndex((s) => s.id === selected));
  const onnodeclick = ({ node }) => { if (node.id === "add") return; selected = node.id; adding = false; };

  function add(kind) { const s = blankStep(kind); flow.steps = [...flow.steps, s]; selected = s.id; adding = false; touch(); }
  function remove() { const i = stepIndex; if (i < 0) return; flow.steps = flow.steps.filter((_, j) => j !== i); selected = flow.steps[Math.max(0, i - 1)]?.id ?? "when"; touch(); }
  function move(d) { const i = stepIndex, j = i + d; if (i < 0 || j < 0 || j >= flow.steps.length) return; const s = [...flow.steps]; [s[i], s[j]] = [s[j], s[i]]; flow.steps = s; touch(); }
  // "Only if": the parts are kept on the step while it is being built, and the rule is made from them
  let rp = $state({ box: "", op: "is", value: "" });
  $effect(() => { const s = step; if (s?.kind === "only_if") untrack(() => { rp = ruleParts(s.rule) ?? { box: "", op: "is", value: "" }; }); });
  const rbox = $derived(src?.boxes.find((b) => b.id === rp.box) ?? null);
  function setRule(patch) { rp = { ...rp, ...patch }; if (rbox?.type === "checkbox" && !["ticked", "not_ticked"].includes(rp.op)) rp.op = "ticked"; if (rbox && rbox.type !== "checkbox" && ["ticked", "not_ticked"].includes(rp.op)) rp.op = "is"; step.rule = ruleFrom(rp); touch(); }
  function setFill(to, from) { const f = { ...(step.fill ?? {}) }; if (from) f[to] = from; else delete f[to]; step.fill = f; touch(); }

  function payload() { return { id: id === "new" ? null : id, title: title.trim(), flow: $state.snapshot(flow) }; }
  async function save() {
    saving = true; problems = []; problem = null; note = null;
    try {
      const r = await api("/api/documents/automations/save", { method: "POST", body: payload() });
      if (!r.ok) { problems = r.json?.error?.detail?.problems ?? []; problem = problems.length ? problemText(problems[0]) : r.error; return; }
      dirty = false; note = t("Saved."); const saved = un(r).automation;
      if (id === "new") { await goto(`/automations/${saved.id}`, { replaceState: true }); }
      book = saved; await load();
    } finally { saving = false; }
  }
  async function setOn(on) {
    problem = null; problems = [];
    if (dirty) { await save(); if (problem) return; }
    const r = await api("/api/documents/automations/enable", { method: "POST", body: { id: book.id, on } });
    if (!r.ok) { problems = r.json?.error?.detail?.problems ?? []; problem = problems.length ? problemText(problems[0]) : r.error; return; }
    book = un(r).automation; note = on ? t("It is on. It runs when a document from “{name}” is signed.", { name: src?.name ?? "" }) : t("It is off.");
  }
  async function runTest() {
    testing = true; test = null; problems = []; problem = null;
    try {
      const r = await api("/api/documents/automations/test", { method: "POST", body: { id: id === "new" ? null : id, flow: $state.snapshot(flow) } });
      if (!r.ok) { problem = r.error; return; }
      const d = un(r); if (!d.ok) { problems = d.problems ?? []; problem = problems.length ? problemText(problems[0]) : t("The automation is not finished."); return; }
      test = d;
    } finally { testing = false; }
  }
  async function archive() {
    const r = await api("/api/documents/automations/archive", { method: "POST", body: { id: book.id } });
    if (!r.ok) { problem = r.error; return; } await goto("/automations");
  }
  const when = (iso) => (iso ? new Date(iso).toLocaleString(i18n.lang, { dateStyle: "medium", timeStyle: "short" }) : "");
  const statusText = $derived(book ? (book.enabled ? t("{n, plural, one {On · ran # time} other {On · ran # times}}", { n: book.runCount ?? 0 }) : t("Off")) : t("Not saved yet"));
  const aria = $derived({ "node.a11yDescription.default": t("Press Enter or Space to change this step."), "node.a11yDescription.keyboardDisabled": t("Press Enter or Space to change this step."), "controls.ariaLabel": t("Canvas controls"), "controls.zoomIn.ariaLabel": t("Zoom in"), "controls.zoomOut.ariaLabel": t("Zoom out"), "controls.fitView.ariaLabel": t("Fit to the screen"), "handle.ariaLabel": t("Wire") });
</script>
<svelte:head><title>{title || t("New automation")} · {t("Automations")} · Docustay</title></svelte:head>
<div class="flex flex-wrap items-center gap-3" data-testid="automation-head">
  <div class="min-w-0"><a class="text-[13px] text-mute no-underline hover:underline" href="/automations">{t("Automations")}</a>
    <input class="title-in" bind:value={title} oninput={touch} placeholder={t("Name this automation")} aria-label={t("Automation name")} maxlength="80" data-testid="automation-title" /></div>
  <span class="chip" class:on={book?.enabled} data-testid="automation-status">{statusText}</span>
  <span class="ml-auto flex flex-wrap items-center gap-2">
    {#if book}<ProLock item="playbooks" tip={t("An automation is part of Pro. You can still build one and test it.")}>{#snippet children(locked)}<button class="btn" disabled={locked} onclick={() => setOn(!book.enabled)} data-testid="automation-toggle">{book.enabled ? t("Turn off") : t("Turn on")}</button>{/snippet}</ProLock>{/if}
    <button class="btn" disabled={testing} onclick={runTest} data-testid="automation-test">{testing ? t("Testing…") : t("Test run")}</button>
    <ProLock item="playbooks" tip={t("An automation is part of Pro. You can still build one and test it.")}>{#snippet children(locked)}<button class="btn primary" disabled={locked || saving || !title.trim()} onclick={save} data-testid="automation-save">{saving ? t("Saving…") : t("Save")}</button>{/snippet}</ProLock>
  </span>
</div>
{#if problem}<p class="notice warn mt-3" role="alert" data-testid="automation-problem">{problem}</p>{/if}
{#if note}<p class="notice mt-3" role="status" data-testid="automation-note">{note}</p>{/if}

<div class="board mt-4">
  <div class="cv" data-testid="automation-canvas">
    {#if loaded}
      <SvelteFlow bind:nodes bind:edges {nodeTypes} {onnodeclick} fitView fitViewOptions={{ padding: 0.25, maxZoom: 1 }} minZoom={0.4} maxZoom={1.5} nodesDraggable={false} nodesConnectable={false} elementsSelectable={true} deleteKey={null} panOnScroll ariaLabelConfig={aria} colorMode="system">
        <Background variant={BackgroundVariant.Dots} gap={22} size={1} />
        <Controls showLock={false} position="bottom-left" />
        <FitOnChange count={`${flow.steps.length}:${adding}:${i18n.lang}`} />
      </SvelteFlow>
    {/if}
  </div>

  <aside class="insp" aria-label={t("Step settings")} data-testid="automation-inspector">
    {#if step}
      <div class="flex items-center gap-2"><b>{kindLabel(step.kind)}</b>
        {#if step.kind !== "when"}<span class="ml-auto flex gap-1"><button class="btn quiet !min-h-8 !px-2" disabled={stepIndex <= 0} onclick={() => move(-1)} aria-label={t("Move up")}>↑</button><button class="btn quiet !min-h-8 !px-2" disabled={stepIndex >= flow.steps.length - 1} onclick={() => move(1)} aria-label={t("Move down")}>↓</button><button class="btn quiet !min-h-8 !px-2 text-bad" onclick={remove} data-testid="automation-remove">{t("Remove")}</button></span>{/if}</div>
      {#if step.kind === "when"}
        <label class="fl">{t("When a document from this template or form is signed by everyone")}
          <select class="field" value={flow.when.templateId} onchange={(e) => chosen(e.currentTarget.value, (v) => (flow.when.templateId = v))} data-testid="automation-when-template">
            <option value="">{t("Choose…")}</option>{#each templates as x (x.id)}<option value={x.id}>{optLabel(x)}</option>{/each}</select></label>
        <p class="hint">{t("Every version of it counts: a document made after the template was edited starts it too.")}</p>
      {:else if step.kind === "only_if"}
        {#if !src}<p class="hint">{t("Choose what starts it first: the condition reads that document's answers.")}</p>
        {:else if step.rule && !ruleParts(step.rule)}<p class="hint">{t("This condition was made outside this screen. It is kept as it is; you can replace it below.")}</p>{/if}
        {#if src}
          <label class="fl">{t("The answer in")}<select class="field" value={rp.box} onchange={(e) => setRule({ box: e.currentTarget.value, value: "" })} data-testid="automation-rule-box"><option value="">{t("Choose a box…")}</option>{#each src.boxes as b (b.id)}<option value={b.id}>{b.label}</option>{/each}</select></label>
          {#if rbox}
            <label class="fl">{t("is")}<select class="field" value={rp.op} onchange={(e) => setRule({ op: e.currentTarget.value })} data-testid="automation-rule-op">
              {#if rbox.type === "checkbox"}<option value="ticked">{t("ticked")}</option><option value="not_ticked">{t("not ticked")}</option>{:else}<option value="is">{t("equal to")}</option><option value="is_not">{t("not equal to")}</option>{/if}</select></label>
            {#if rbox.type !== "checkbox"}
              {#if rbox.options?.length}<label class="fl">{t("Value")}<select class="field" value={rp.value} onchange={(e) => setRule({ value: e.currentTarget.value })} data-testid="automation-rule-value"><option value="">{t("Choose…")}</option>{#each rbox.options as o}<option value={o}>{o}</option>{/each}</select></label>
              {:else}<label class="fl">{t("Value")}<input class="field" value={rp.value} oninput={(e) => setRule({ value: e.currentTarget.value })} data-testid="automation-rule-value" /></label>{/if}
            {/if}
          {/if}
        {/if}
        <p class="hint">{t("If the answer does not match, the automation stops here and sends nothing.")}</p>
      {:else if step.kind === "send"}
        <label class="fl">{t("Template")}<select class="field" value={step.templateId} onchange={(e) => chosen(e.currentTarget.value, (v) => { step.templateId = v; step.fill = {}; })} data-testid="automation-send-template">
          <option value="">{t("Choose…")}</option>{#each sendable as x (x.id)}<option value={x.id}>{optLabel(x)}</option>{/each}</select></label>
        {#if templates.length > sendable.length}<p class="hint">{t("Only templates one person signs are listed: an automation sends to the person who signed.")}</p>{/if}
        <label class="fl">{t("To")}<select class="field" disabled><option>{src?.kind === "form" ? t("The person who filled the form") : t("The person who signed")}</option></select></label>
        {@const target = templates.find((x) => x.id === step.templateId)}
        {#if target}
          <div class="fl" data-testid="automation-fill">{t("Fill from their answers")}
            {#each target.boxes.filter((b) => b.fillable) as b (b.id)}
              <label class="fillrow"><span class="truncate">{b.label}</span>
                <select class="field !w-44" value={step.fill?.[b.id] ?? ""} onchange={(e) => setFill(b.id, e.currentTarget.value)} aria-label={t("Fill “{box}” from", { box: b.label })} data-testid="automation-fill-select" data-box={b.id}>
                  <option value="">{t("Leave empty")}</option>{#each src?.boxes ?? [] as s (s.id)}<option value={s.id}>{t("← {box}", { box: s.label })}</option>{/each}</select></label>
            {:else}<p class="hint">{t("This template has no box that can be filled from an answer.")}</p>{/each}
          </div>
        {/if}
      {:else if step.kind === "wait"}
        <label class="fl">{t("Days")}<input class="field !w-28" type="number" min="1" max="60" step="1" value={step.days} oninput={(e) => { step.days = Math.round(Number(e.currentTarget.value)); touch(); }} data-testid="automation-wait-days" /></label>
        <label class="flex items-center gap-2 text-sm"><input type="checkbox" checked={step.unlessSigned} onchange={(e) => { step.unlessSigned = e.currentTarget.checked; touch(); }} data-testid="automation-wait-unless" />{t("Stop here if what it sent is signed by then")}</label>
      {:else if step.kind === "remind"}<p class="hint">{t("Sends the usual reminder email to everyone still to sign what this automation sent.")}</p>
      {:else}<p class="hint">{t("You get a line in the bell and an email naming the document.")}</p>{/if}
    {/if}

    {#if test}
      <section class="mt-2" data-testid="automation-test-result"><b class="text-sm">{t("Test run")}</b>
        <p class="hint">{test.sample ? t("With the answers from “{title}”. Nothing was sent.", { title: test.sample.title }) : t("No signed document starts it yet, so it ran with no answers. Nothing was sent.")}</p>
        <ol class="log">{#each test.steps as l}<li data-code={l.code}>{logLine(l)}</li>{/each}</ol></section>
    {/if}
    {#if runs.length}
      <section class="mt-2" data-testid="automation-runs"><b class="text-sm">{t("Recent runs")}</b>
        <ul class="grid gap-2">{#each runs as r (r.id)}<li class="run" data-testid="automation-run" data-status={r.status}><div class="flex items-center gap-2 text-sm"><span class="chip" class:on={r.status === "done"}>{runStatus(r.status)}</span><span class="text-mute">{when(r.startedAt)}</span>{#if r.sentId}<a class="ml-auto" href={`/documents/${r.sentId}`}>{t("Open what it sent")}</a>{/if}</div>
          <ol class="log">{#each r.log.slice(1) as l}<li data-code={l.code}>{logLine(l)}</li>{/each}</ol></li>{/each}</ul></section>
    {/if}
    <div class="foot" data-testid="automation-footnote">{t("Each document an automation sends counts toward your monthly documents.")} {#if !pro}<ProLock item="playbooks" badgeOnly tip={t("An automation is part of Pro. You can still build one and test it.")} />{/if}</div>
    {#if book}<button class="btn quiet text-sm" onclick={archive} data-testid="automation-archive">{t("Archive this automation")}</button>{/if}
  </aside>
</div>
<style>
  .title-in { display: block; margin: 0; font-size: 24px; font-weight: 600; background: transparent; border: 0; padding: 0; color: var(--ink); min-width: 16rem; }
  .title-in:focus { outline: 2px solid var(--brand-soft); border-radius: 6px; }
  .chip { font-size: 12px; padding: 4px 10px; border-radius: 999px; background: var(--tint, var(--panel)); color: var(--mute); }
  .chip.on { background: var(--ok-bg); color: var(--ok); }
  .board { display: grid; grid-template-columns: minmax(0, 1fr) 360px; border: 1px solid var(--line); border-radius: 14px; overflow: hidden; min-height: 640px; height: calc(100vh - 210px); }
  .cv { position: relative; background: var(--paper, #f7f6fc); min-height: 420px; }
  .cv :global(.svelte-flow) { --xy-background-color: transparent; --xy-edge-stroke: #8585fd; --xy-edge-stroke-width: 2; --xy-background-pattern-dots-color: var(--line-strong, #dcd9ee); }
  .cv :global(.svelte-flow__node) { border: 0; padding: 0; background: transparent; box-shadow: none; width: auto; }
  .cv :global(.svelte-flow__edge-path) { stroke-dasharray: 6 6; }
  .insp { background: var(--card); border-left: 1px solid var(--line); padding: 24px; display: flex; flex-direction: column; gap: 16px; overflow-y: auto; }
  .fl { display: flex; flex-direction: column; gap: 6px; font-size: 13px; color: var(--mute); }
  .fillrow { display: flex; align-items: center; justify-content: space-between; gap: 8px; color: var(--ink); }
  .hint { font-size: 12.5px; color: var(--mute); margin: 0; }
  .log { margin: 6px 0 0; padding-left: 18px; font-size: 13px; display: grid; gap: 4px; list-style: decimal; }
  .run { border: 1px solid var(--line); border-radius: 10px; padding: 8px 10px; }
  .foot { margin-top: auto; padding: 14px; border-radius: 12px; background: var(--brand-soft); font-size: 13px; line-height: 1.5; display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
  @media (max-width: 960px) { .board.board { grid-template-columns: minmax(0, 1fr); grid-template-rows: auto auto; height: auto; min-height: 0; } .cv { height: 60vh; min-height: 320px; } .insp { border-left: 0; border-top: 1px solid var(--line); } }
</style>
