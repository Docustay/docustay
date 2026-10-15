<script>
  import PageSkel from "$lib/ui/PageSkel.svelte";
  import { onMount } from "svelte";
  import { take, clear } from "$lib/site/handoff.js";
  import { page } from "$app/state";
  import { goto } from "$app/navigation";
  import { api } from "$lib/api.js";
  import { uploadFile } from "$lib/docs.js";
  import { t } from "$lib/i18n/index.svelte.js";
  import { tl } from "$lib/flow/flowLabels.js";
  import FlowSteps from "$lib/flow/FlowSteps.svelte";
  import FlowIcon from "$lib/flow/FlowIcon.svelte";
  import { entitled, loadPlan } from "$lib/pro/plan.svelte.js";
  import { TEMPLATE_CATEGORIES, FORM_TEMPLATE_CATEGORIES } from "$lib/flow/flowDefinition.js";

  let mode = $state(["template", "form"].includes(page.url.searchParams.get("mode")) ? page.url.searchParams.get("mode") : "document");
  // Run 8 verify: in template or form mode, once this month's new templates are used (Free) the doors are shown inert under the plain message with Explore Pro — the server refuses at save anyway
  const capped = $derived(mode !== "document" && entitled("unlimited_templates") === false);
  onMount(() => { loadPlan(); });
  let cat = $state("all"), open = $state(null), starters = $state([]), startersProblem = $state(null), q = $state("");
  let phase = $state("idle"), prog = $state({ sent: 0, total: 0 }), problem = $state(null), over = $state(false), guided = $state(false);
  const mb = (n) => `${(n / 1048576).toFixed(1)} MB`;

  let capMb = $state(null);
  onMount(async () => { const r = await api("/api/documents/settings"); if (r.ok) capMb = r.json?.uploadMaxMb ?? null; });   // D-049: the real biggest upload, not a plan table
  // ★ Run 7: the TYPE is decided by the way in (Templates → Document templates / Form templates, New document, a play); nothing on this page switches it
  const CATS = $derived(mode === "form" ? FORM_TEMPLATE_CATEGORIES : TEMPLATE_CATEGORIES);
  const catOf = (s) => mode === "form" ? s.use : (TEMPLATE_CATEGORIES.find((c) => c.slugs.includes(s.slug))?.id ?? "business");
  const shown = $derived(starters.filter((s) => (cat === "all" || catOf(s) === cat) && (!q.trim() || `${s.title} ${s.summary}`.toLowerCase().includes(q.trim().toLowerCase()))));

  async function pick(door) {
    open = open === door ? null : door;
    if (door === "library" && open && !starters.length) {
      const r = await api(`/api/documents/library?kind=${mode === "form" ? "form" : "document"}`);
      const d = r.json?.data ?? r.json;
      if (r.ok) { starters = d?.templates ?? []; hidden = d?.shown === false; }
      else startersProblem = r.error ?? t("The templates could not be loaded.");
    }
  }
  // Run 9 Part 4R: "From a template" opens the built-in library for this type. A new document is SENT from one (no copy); a new template CUSTOMIZES one (the workspace's own copy,
  // a new template); a new form publishes the built-in form itself, or customizes it. Your own templates are on Templates.
  let hidden = $state(false), using = $state(null);
  async function useOne(s, how) {
    using = s.slug; problem = null;
    const r = await api(how === "customize" ? "/api/documents/library/customize" : "/api/documents/library/use", { method: "POST", body: { slug: s.slug } });
    using = null; const d = r.json?.data ?? r.json;
    if (!r.ok) { problem = r.error ?? t("That template could not be used."); return; }
    if (how === "customize") await goto(`/create/flow?mode=${mode === "form" ? "form" : "template"}&template=${encodeURIComponent(d.templateId)}`);
    else if (d.kind === "form") await goto(`/forms?new=${encodeURIComponent(d.templateId)}`);
    else await goto(`/documents/${d.instanceId}/edit?from=template`);
  }
  async function start(file) {
    if (!file) return; problem = null; phase = "uploading"; prog = { sent: 0, total: file.size };
    try { const r = await uploadFile(file, { onProgress: (p) => { prog = p; if (p.phase === "processing") phase = "processing"; } }); await goto(`/documents/${r.instanceId}/edit${mode === "form" ? "?as=form" : mode === "template" ? "?as=template" : ""}`); }
    catch (e) { problem = e.message || t("That did not upload. Try again."); phase = "idle"; }
  }
  // a file dropped on the public home page before this account existed is picked up here, once
  onMount(async () => { if (page.url.searchParams.get("upload")) pick("upload"); else if (["library", "readymade"].includes(page.url.searchParams.get("start"))) pick("library"); const f = await take(); if (f) { await clear(); start(f); } });
  function onGuided(source, title, notes) {
    try { sessionStorage.setItem("ds-guided", JSON.stringify({ source, title, notes })); } catch {}
    goto(`/create/flow?mode=${mode}&guided=1`);
  }
</script>
<svelte:head><title>{mode === "template" ? t("New document template") : mode === "form" ? t("New form template") : t("New document")} · Docustay</title></svelte:head>
<FlowSteps current="start" {mode} />
<div class="flex flex-wrap items-center gap-3">
  <h1 class="text-[length:var(--t-title)] font-medium leading-tight tracking-[-0.02em]" data-testid="cr-title">{mode === "template" ? t("New document template") : mode === "form" ? t("New form template") : t("New document")}</h1>
  {#if mode !== "document"}<span class="chip" data-testid="cr-kind">{mode === "form" ? t("Form: one link many people fill in") : t("Document template: sent to the people you name")}</span>{/if}
</div>
<p class="mt-1 text-mute">{t("Pick how you want to start.")}</p>
{#if problem}<p class="notice warn mt-4" role="alert">{problem}</p>{/if}

{#if capped}<div class="mt-5" data-testid="cr-template-cap">{#await import("$lib/pro/TemplateUsage.svelte") then { default: TemplateUsage }}<TemplateUsage  />{/await}</div>{/if}
<div inert={capped} class={capped ? "opacity-50" : ""} data-testid="cr-doors">
<ul class="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
  <li><button class="card w-full min-h-28 p-4 text-left {open === 'library' ? 'border-brand' : ''}" aria-expanded={open === "library"} onclick={() => pick("library")} data-testid="cr-door-library"><b class="block">{t("From a template")}</b><span class="mt-1 block text-sm text-mute">{mode === "form" ? t("Pick one of the built-in form templates. Publish it as it is, or customize your own copy.") : mode === "template" ? t("Pick one of the built-in document templates and customize your own copy.") : t("Pick one of the built-in document templates and send it.")}</span></button></li>
  <li><button class="card w-full min-h-28 p-4 text-left {open === 'upload' ? 'border-brand' : ''}" aria-expanded={open === "upload"} onclick={() => pick("upload")} data-testid="cr-door-upload"><b class="block">{t("Upload")}</b><span class="mt-1 block text-sm text-mute">{mode === "form" ? t("A PDF form you already use. Place the boxes people fill in.") : t("A PDF file.")}</span></button></li>
  <li><button class="card w-full min-h-28 p-4 text-left {open === 'write' ? 'border-brand' : ''}" aria-expanded={open === "write"} onclick={() => pick("write")} data-testid="cr-door-write"><b class="block">{t("Write")}</b><span class="mt-1 block text-sm text-mute">{mode === "form" ? t("Write the form in the editor and place its boxes as you go.") : t("Write it in the editor and place the fields as you go.")}</span></button></li>
  <li><button class="card w-full min-h-28 p-4 text-left {open === 'describe' ? 'border-brand' : ''}" aria-expanded={open === "describe"} onclick={() => pick("describe")} data-testid="cr-door-describe"><b class="block">{t("Describe")}</b><span class="mt-1 block text-sm text-mute">{mode === "form" ? t("Say what you want to ask and get a form draft to read and change.") : t("Say what you need and get a draft to read and change.")}</span></button></li>
</ul>

<div class="mt-5">
{#if open === "library"}
  <div class="flex flex-wrap items-center gap-3"><input class="field !w-full sm:!w-72" placeholder={mode === "form" ? t("Search form templates") : t("Search document templates")} aria-label={mode === "form" ? t("Search form templates") : t("Search document templates")} bind:value={q} data-testid="cr-search" /><a class="text-sm text-brand underline" href={`/templates?kind=${mode === "form" ? "form" : "document"}`} data-testid="cr-own-templates">{t("Your own templates are on Templates")}</a></div>
  <div class="mt-3 flex flex-wrap gap-1.5" role="group" aria-label={t("Categories")}>
    <button class="chip !min-h-10 {cat === 'all' ? '!bg-tint font-semibold' : ''}" aria-pressed={cat === "all"} onclick={() => (cat = "all")} data-testid="cr-cat-all">{t("All")}</button>
    {#each CATS as c (c.id)}<button class="chip !min-h-10 {cat === c.id ? '!bg-tint font-semibold' : ''}" aria-pressed={cat === c.id} onclick={() => (cat = c.id)} data-testid={`cr-cat-${c.id}`}>{tl(c.label)}</button>{/each}
  </div>
  {#if startersProblem}<p class="notice warn mt-3" role="alert">{startersProblem}</p>
  {:else if hidden}<div class="mt-3 rounded-lg border border-dashed border-line p-6 text-center text-mute" data-testid="cr-library-hidden">{t("This workspace has hidden the built-in templates. An owner or admin can show them again in Settings → Templates.")}</div>
  {:else if !starters.length}<div class="mt-3"><PageSkel kind="cards" rows={6} testid="create-loading" /></div>
  {:else if !shown.length}<div class="mt-3 rounded-lg border border-dashed border-line p-6 text-center text-mute">{t("Nothing matches that search.")}</div>
  {:else}<ul class="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{#each shown as s (s.slug)}<li class="card flex flex-col p-4">{#if mode !== "form"}<!-- R8-38: the picture opens the same preview as the Preview button (people click the picture); one Tab stop per card stays the button --><a href={`/starters/${s.slug}/p1-lg.webp`} target="_blank" rel="noopener" tabindex="-1" aria-hidden="true" class="mb-3 block" data-testid="cr-picture"><img src={`/starters/${s.slug}/p1-sm.webp`} alt="" loading="lazy" class="h-40 w-full rounded-md border border-line object-cover object-top" /></a>{/if}<p class="font-semibold">{s.title}</p><p class="mt-1 flex-1 text-sm text-mute">{s.summary}</p>{#if mode === "form"}<p class="mt-2 text-xs text-mute" data-testid="cr-form-facts">{t("{n} fields", { n: s.fieldCount })}{s.counterSign ? ` · ${s.counterFields ? t("plus {n} for the team member", { n: s.counterFields }) : t("a team member counter-signs")}` : ""}</p>{/if}<div class="mt-3 flex gap-2">{#if mode === "form"}<a class="btn !min-h-10" href={`/form-templates/${s.slug}`} target="_blank" rel="noopener" data-testid="cr-preview" data-slug={s.slug}><FlowIcon name="eye" size={16} /> {t("Preview")}</a>{:else}<a class="btn !min-h-10" href={`/starters/${s.slug}/p1-lg.webp`} target="_blank" rel="noopener" data-testid="cr-preview" data-slug={s.slug}><FlowIcon name="eye" size={16} /> {t("Preview")}</a>{/if}{#if mode !== "template"}<button class="btn primary !min-h-10" disabled={using !== null} onclick={() => useOne(s, "use")} data-testid="cr-use" data-slug={s.slug}>{mode === "form" ? t("Publish") : t("Send")}</button>{/if}{#if mode !== "document"}<button class="btn {mode === 'template' ? 'primary' : ''} !min-h-10" disabled={using !== null} onclick={() => useOne(s, "customize")} data-testid="cr-customize" data-slug={s.slug}>{t("Customize")}</button>{/if}</div></li>{/each}</ul>{/if}
{:else if open === "upload"}
  {#if phase === "idle"}
    <div class="flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed p-8 text-center sm:p-12 {over ? 'border-brand bg-tint' : 'border-line'}" data-testid="cr-drop"
      ondragover={(e) => { e.preventDefault(); over = true; }} ondragleave={() => (over = false)} ondrop={(e) => { e.preventDefault(); over = false; start(e.dataTransfer.files?.[0]); }}>
      <p class="text-lg font-semibold">{t("Drop a file here, or choose one")}</p>
      <p class="text-sm text-mute">{capMb ? t("PDF files only · up to {mb} MB", { mb: capMb }) : t("PDF files only")}</p>
      <label for="cr-file" class="btn primary cursor-pointer" data-testid="cr-choose">{t("Choose a file")}</label>
    </div>
    <input id="cr-file" type="file" class="sr-only" accept=".pdf,application/pdf" onchange={(e) => start(e.currentTarget.files?.[0])} data-testid="cr-upload-input" />
  {:else}
    <div class="rounded-2xl border border-line p-6" role="status"><div class="flex items-center gap-3">{#if phase === "processing"}{#await import("$lib/fx/Scan.svelte") then { default: Scan }}<Scan testid="cr-scan" />{/await}{:else}{#await import("$lib/fx/Cube.svelte") then { default: Cube }}<Cube after={2000} testid="cr-cube" />{/await}{/if}<p class="font-medium">{phase === "processing" ? t("Reading the pages…") : t("Uploading…")}</p></div>
      <div class="mt-3 h-2 overflow-hidden rounded-full bg-tint"><div class="h-full bg-brand transition-all" style="width:{prog.total ? Math.round((prog.sent / prog.total) * 100) : 0}%"></div></div>
      <p class="mt-2 text-sm text-mute">{t("{sent} of {total}", { sent: mb(prog.sent), total: mb(prog.total) })}</p></div>
  {/if}
{:else if open === "write"}
  <button class="btn primary" onclick={() => goto(`/create/flow?mode=${mode}`)} data-testid="cr-blank">{t("Start with a blank page")}</button>
{:else if open === "describe"}
  <div class="max-w-3xl">
    {#await import("$lib/ai/DescribePanel.svelte") then { default: DescribePanel }}<DescribePanel {mode} onopen={(jobId) => goto(`/create/flow?mode=${mode}&job=${encodeURIComponent(jobId)}`)} />{/await}
    <p class="mt-4"><button class="text-brand underline" onclick={() => (guided = !guided)} aria-expanded={guided} data-testid="cr-guided-link">{t("Build it with questions instead")}</button></p>
    {#if guided}<div class="mt-3">{#await import("$lib/ai/GuidedForm.svelte") then { default: GuidedForm }}<GuidedForm onopen={onGuided} />{/await}</div>{/if}
  </div>
{/if}
</div>
</div>
