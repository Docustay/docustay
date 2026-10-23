<script>
  import Page from "$lib/ui/Page.svelte";
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
  import TemplateTile from "$lib/templates/TemplateTile.svelte";
  import Icon from "$lib/ui/Icon.svelte";
  import PageHeader from "$lib/ui/PageHeader.svelte";
  import { entitled, loadPlan } from "$lib/pro/plan.svelte.js";
  import PlanPrompt from "$lib/pro/PlanPrompt.svelte";
  import { TEMPLATE_CATEGORIES, FORM_TEMPLATE_CATEGORIES } from "$lib/flow/flowDefinition.js";

  let mode = $state(["template"].includes(page.url.searchParams.get("mode")) ? page.url.searchParams.get("mode") : "document");
  // Run 8 verify: in template or form mode, once this month's new templates are used (Free) the doors are shown inert under the plain message with Explore Pro — the server refuses at save anyway
  const capped = $derived(mode !== "document" && entitled("unlimited_templates") === false);
  onMount(() => { loadPlan(); });
  let cat = $state("all"), open = $state("describe"), starters = $state([]), startersProblem = $state(null), q = $state("");
  let phase = $state("idle"), prog = $state({ sent: 0, total: 0 }), problem = $state(null), over = $state(false), guided = $state(false);
  const mb = (n) => `${(n / 1048576).toFixed(1)} MB`;

  let capMb = $state(null);
  onMount(async () => { const r = await api("/api/documents/settings"); if (r.ok) capMb = r.json?.uploadMaxMb ?? null; });   // D-049: the real biggest upload, not a plan table
  // ★ Run 7: the TYPE is decided by the way in (Templates, New document, a play); nothing on this page switches it
  const CATS = [...TEMPLATE_CATEGORIES, ...FORM_TEMPLATE_CATEGORIES.filter((c) => !TEMPLATE_CATEGORIES.some((d) => d.id === c.id))];
  const catOf = (s) => TEMPLATE_CATEGORIES.find((c) => c.slugs.includes(s.slug))?.id ?? (FORM_TEMPLATE_CATEGORIES.some((c) => c.id === s.use) ? s.use : "business");
  const shown = $derived(starters.filter((s) => (cat === "all" || catOf(s) === cat) && (!q.trim() || `${s.title} ${s.summary}`.toLowerCase().includes(q.trim().toLowerCase()))));

  async function loadStarters() {
    if (starters.length || loadingStarters) return; loadingStarters = true;
    const r = await api(`/api/documents/library?kind=${"document"}`);
    const d = r.json?.data ?? r.json;
    if (r.ok) { starters = d?.templates ?? []; hidden = d?.shown === false; const want = page.url.searchParams.get("preview"); if (want && !starters.slice(0, 12).some((x) => x.slug === want)) open = "library"; }   // a shared Preview link for a template beyond the first twelve opens the whole list
    else startersProblem = r.error ?? t("The templates could not be loaded.");
    loadingStarters = false;
  }
  let loadingStarters = false;
  async function pick(door) {
    open = door === "describe" ? "describe" : open === door ? null : door;   // the Scribe box is always on the page: its door only brings it into view
    if (door === "library" && open) await loadStarters();
  }
  onMount(() => { loadStarters(); });
  // "Try:" examples fill the Scribe form (a kind of document and the first answer); the person still reads and presses the button
  let seed = $state(null);
  const EXAMPLES = $derived([
    { label: t("A mutual NDA with a new contractor"), type: "nda", answers: { purpose: t("A mutual NDA before we share project details with a new contractor.") } },
    { label: t("A services agreement for a client project"), type: "services", answers: { purpose: t("A services agreement for a fixed-scope client project.") } },
    { label: t("A photo release for an event"), type: "photo_release", answers: { purpose: t("A photo and media release for people attending our event.") } },
  ]);
  const featured = $derived(starters.slice(0, 12));
  // Run 9 Part 4R: "From a template" opens the built-in library for this type. A new document is SENT from one (no copy); a new template CUSTOMIZES one (the workspace's own copy,
  // a new template); a new form publishes the built-in form itself, or customizes it. Your own templates are on Templates.
  let hidden = $state(false), using = $state(null);
  async function useOne(s, how) {
    using = s.slug; problem = null;
    const r = await api(how === "customize" ? "/api/documents/library/customize" : "/api/documents/library/use", { method: "POST", body: { slug: s.slug } });
    using = null; const d = r.json?.data ?? r.json;
    if (!r.ok) { problem = r.error ?? t("That template could not be used."); return; }
    if (how === "customize") await goto(`/create/flow?mode=${"template"}&template=${encodeURIComponent(d.templateId)}`);
    else await goto(`/documents/${d.instanceId}/edit?from=template`);
  }
  async function start(file) {
    if (!file) return; problem = null; phase = "uploading"; prog = { sent: 0, total: file.size };
    try { const r = await uploadFile(file, { onProgress: (p) => { prog = p; if (p.phase === "processing") phase = "processing"; } }); await goto(`/documents/${r.instanceId}/edit${mode === "template" ? "?as=template" : ""}`); }
    catch (e) { if (!e.planShown) problem = e.message || t("That did not upload. Try again."); phase = "idle"; }   // a plan limit is said in the plan sheet, once
  }
  // a file dropped on the public home page before this account existed is picked up here, once
  onMount(async () => { if (page.url.searchParams.get("upload")) pick("upload"); else if (["library", "readymade"].includes(page.url.searchParams.get("start"))) { open = null; pick("library"); } const f = await take(); if (f) { await clear(); start(f); } });
  function onGuided(source, title, notes) {
    try { sessionStorage.setItem("ds-guided", JSON.stringify({ source, title, notes })); } catch {}
    goto(`/create/flow?mode=${mode}&guided=1`);
  }
</script>
<svelte:head><title>{mode === "template" ? t("New document template") : t("New document")} · Docustay</title></svelte:head>
<PageHeader title={mode === "template" ? t("New document template") : t("New document")} back={{ href: "/documents", label: t("All documents") }}><!-- the steps are a quiet breadcrumb, not a stepper -->{#snippet filters()}<FlowSteps current="start" {mode} />{/snippet}</PageHeader>
<div class="pt-4">
<h1 class="paper-serif text-[34px] font-medium leading-tight tracking-[-0.015em] sm:text-[38px]" data-testid="cr-title">{mode === "template" ? t("What should this template do?") : t("What do you need signed?")}</h1>
{#if mode !== "document"}<p class="mt-2"><span class="chip" data-testid="cr-kind">{t("Document template: sent to the people you name")}</span></p>{/if}
<p class="mt-2 text-[14px] text-mute">{t("Say what it is for and who signs. Scribe drafts it for you to read and change before anything is sent.")}</p>
{#if problem}<p class="notice warn mt-4" role="alert">{problem}</p>{/if}

{#if capped}<div class="mt-5 space-y-3" data-testid="cr-template-cap">{#await import("$lib/pro/TemplateUsage.svelte") then { default: TemplateUsage }}<TemplateUsage  />{/await}<PlanPrompt action="create_template" id="create-cap" /></div>{/if}
<div inert={capped} class={capped ? "opacity-50" : ""} data-testid="cr-doors">
  <Page type="split" asideWidth="26rem" class="mt-6" asideLabel={t("Other ways to start")} sticky={false}>
    <div class="min-w-0">
  <div data-testid="cr-door-describe-box">
    <button type="button" class="sr-only" aria-expanded={open === "describe"} onclick={() => pick("describe")} data-testid="cr-door-describe">{t("Describe")}</button>
    {#await import("$lib/ai/DescribePanel.svelte") then { default: DescribePanel }}<DescribePanel {mode} bind:seed questions={guided} onguided={onGuided} onattach={() => pick("upload")} ontemplate={() => { pick("library"); document.getElementById("cr-tpl-h")?.scrollIntoView({ behavior: "smooth", block: "start" }); }} onopen={(jobId) => goto(`/create/flow?mode=${mode}&job=${encodeURIComponent(jobId)}`)} />{/await}
    <p class="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-mute"><span>{t("Try:")}</span>{#each EXAMPLES as ex}<button class="text-link underline" onclick={() => (seed = { type: ex.type, answers: ex.answers })}>{ex.label}</button>{/each}</p>
    <p class="mt-3 text-[13px]"><button class="text-link underline" onclick={() => (guided = !guided)} aria-expanded={guided} data-testid="cr-guided-link">{guided ? t("Describe it in your own words instead") : t("Build it with questions instead")}</button></p>
    {#if guided}<div class="mt-3">{#await import("$lib/ai/GuidedForm.svelte") then { default: GuidedForm }}<GuidedForm onopen={onGuided} />{/await}</div>{/if}
  </div>

    </div>
    {#snippet aside()}<h2 class="mb-2 text-[13px] font-semibold">{t("Or start another way")}</h2>
    <section aria-label={t("Upload")}>
    <button type="button" class="flex w-full items-center gap-3 rounded-[10px] border border-dashed border-line-strong px-4 py-3 text-left text-[13px] hover:bg-tint {over ? 'bg-tint' : ''}" aria-expanded={open === "upload"} onclick={() => pick("upload")} data-testid="cr-door-upload"><Icon name="upload" size={16} /><span class="font-medium">{t("Upload a PDF")}</span><span class="text-mute">{t("Already have the file? Drop it here and place the fields.")}</span></button>
    {#if open === "upload"}
      <div class="mt-3">{#if phase === "idle"}
        <div class="flex flex-col items-center gap-2 rounded-[10px] border border-dashed p-8 text-center {over ? 'border-brand bg-tint' : 'border-line-strong'}" data-testid="cr-drop"
          ondragover={(e) => { e.preventDefault(); over = true; }} ondragleave={() => (over = false)} ondrop={(e) => { e.preventDefault(); over = false; start(e.dataTransfer.files?.[0]); }} role="group" aria-label={t("Drop a file here")}>
          <p class="text-[15px] font-medium">{t("Drop a file here, or choose one")}</p>
          <p class="text-[13px] text-mute">{capMb ? t("PDF files only · up to {mb} MB", { mb: capMb }) : t("PDF files only")}</p>
          <label for="cr-file" class="btn primary cursor-pointer" data-testid="cr-choose">{t("Choose a file")}</label>
        </div>
        <input id="cr-file" type="file" class="sr-only" accept=".pdf,application/pdf" onchange={(e) => start(e.currentTarget.files?.[0])} data-testid="cr-upload-input" />
      {:else}
        <div class="rounded-[10px] border border-line p-5" role="status"><div class="flex items-center gap-3">{#if phase === "processing"}{#await import("$lib/fx/Scan.svelte") then { default: Scan }}<Scan testid="cr-scan" />{/await}{:else}{#await import("$lib/fx/Cube.svelte") then { default: Cube }}<Cube after={2000} testid="cr-cube" />{/await}{/if}<p class="font-medium">{phase === "processing" ? t("Reading the pages…") : t("Uploading…")}</p></div>
          <div class="mt-3 h-[3px] overflow-hidden bg-line"><div class="h-full bg-brand transition-all" style="width:{prog.total ? Math.round((prog.sent / prog.total) * 100) : 0}%"></div></div>
          <p class="mt-2 text-[13px] text-mute">{t("{sent} of {total}", { sent: mb(prog.sent), total: mb(prog.total) })}</p></div>
      {/if}</div>
    {/if}
    <p class="mt-3 text-[13px] text-mute">{t("Or")} <button class="text-link underline" onclick={() => pick("write")} aria-expanded={open === "write"} data-testid="cr-door-write">{t("write it yourself in the editor")}</button>{#if open === "write"} <button class="btn primary ml-2" onclick={() => goto(`/create/flow?mode=${mode}`)} data-testid="cr-blank">{t("Start with a blank page")}</button>{/if}</p>
  </section>{/snippet}
  </Page>
  <section class="mt-12" aria-labelledby="cr-tpl-h">
    <div class="flex items-baseline justify-between gap-3"><h2 id="cr-tpl-h" class="text-[13px] font-semibold">{t("Or start from a template")}</h2>
      <button class="text-[13px] text-link underline" aria-expanded={open === "library"} onclick={() => pick("library")} data-testid="cr-door-library">{open === "library" ? t("Show fewer") : starters.length ? t("See all {n}", { n: starters.length }) : t("See all")}</button></div>
    {#if startersProblem}<p class="notice warn mt-3" role="alert">{startersProblem}</p>
    {:else if hidden}<div class="mt-3 border-t border-line pt-4 text-[13px] text-mute" data-testid="cr-library-hidden">{t("This workspace has hidden the built-in templates. An owner or admin can show them again in Settings → Templates.")}</div>
    {:else if !starters.length}<div class="mt-3"><PageSkel kind="cards" rows={6} testid="create-loading" /></div>
    {:else if open !== "library"}<ul class="pg-gallery mt-4" style="--tile: 168px; --tile-gap-y: 1.5rem" data-testid="cr-featured">{#each featured as s (s.slug)}<TemplateTile {s} {mode} {using} width={112} hasPicture={TEMPLATE_CATEGORIES.some((c) => c.slugs.includes(s.slug))} note={s.inPack ? t("In a pack") : ""} onuse={(x) => useOne(x, "use")} oncustomize={(x) => useOne(x, "customize")} ids={{ picture: "cr-picture", preview: "cr-preview", use: "cr-use", customize: "cr-customize", facts: "cr-form-facts" }} />{/each}</ul>
    {:else}
      <div class="mt-3 flex flex-wrap items-center gap-3"><input class="field !w-full sm:!w-72" placeholder={t("Search document templates")} aria-label={t("Search document templates")} bind:value={q} data-testid="cr-search" /><a class="text-[13px] text-link underline" href={`/templates?kind=${"document"}`} data-testid="cr-own-templates">{t("Your own templates are on Templates")}</a></div>
      <div class="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[13px]" role="group" aria-label={t("Categories")}>
        <button class="{cat === 'all' ? 'font-semibold text-ink' : 'text-mute'}" aria-pressed={cat === "all"} onclick={() => (cat = "all")} data-testid="cr-cat-all">{t("All")}</button>
        {#each CATS as c (c.id)}<button class="{cat === c.id ? 'font-semibold text-ink' : 'text-mute'}" aria-pressed={cat === c.id} onclick={() => (cat = c.id)} data-testid={`cr-cat-${c.id}`}>{tl(c.label)}</button>{/each}
      </div>
      {#if !shown.length}<div class="mt-4 text-[13px] text-mute">{t("Nothing matches that search.")}</div>
      {:else}<ul class="pg-gallery mt-4" style="--tile: 168px; --tile-gap-y: 1.5rem">{#each shown as s (s.slug)}<TemplateTile {s} {mode} {using} width={112} hasPicture={TEMPLATE_CATEGORIES.some((c) => c.slugs.includes(s.slug))} note={s.inPack ? t("In a pack") : ""} onuse={(x) => useOne(x, "use")} oncustomize={(x) => useOne(x, "customize")} ids={{ picture: "cr-picture", preview: "cr-preview", use: "cr-use", customize: "cr-customize", facts: "cr-form-facts" }} />{/each}</ul>{/if}
    {/if}
  </section>

</div>
</div>
