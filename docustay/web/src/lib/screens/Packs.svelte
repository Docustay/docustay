<script>
  let { embedded = false } = $props();   // Launch step 7: shown inside another screen (Documents, Plays, Billing), which owns the page title
  // PLAYBOOKS — PACKS (Run 9 Part 4R, the maintainer 12 Oct 2026). A pack bundles skills and templates for one job ("New tenant pack"). Switched on, its templates come first on Templates
  // and its skills and templates are what Scribe reaches for first. The built-in packs are every plan's to switch on; making your own is Pro (the shared Pro lock).
  // (What used to be "a playbook that runs" is on Automations.)
  import { onMount } from "svelte";
  import { api } from "$lib/api.js";
  import { live } from "$lib/live.js";
  import { t } from "$lib/i18n/index.svelte.js";
  import { ask } from "$lib/ui/confirm.svelte.js";
  import PageSkel from "$lib/ui/PageSkel.svelte";
  import ProLock from "$lib/pro/ProLock.svelte";
  const un = (r) => r.json?.data ?? r.json;
  let packs = $state([]), plays = $state([]), lib = $state([]), own = $state([]), custom = $state(false), loaded = $state(false), problem = $state(null), note = $state(null), bk = $state(null);
  async function load() {
    const [r, l, o] = await Promise.all([api("/api/documents/plays"), api("/api/documents/library"), api("/api/documents/pdf/templates?q=&retired=false&kind=document")]);
    loaded = true;
    if (!r.ok) { problem = r.error ?? t("The playbooks could not be loaded."); return; }
    const d = un(r); packs = d.playbooks ?? []; plays = (d.plays ?? []).filter((p) => p.builtin || p.published); custom = d.custom === true;
    lib = l.ok ? (un(l).templates ?? []) : []; own = o.ok ? (un(o).templates ?? []) : [];
  }
  onMount(() => { load(); return live(["plays", "templates"], load); });
  const titleOf = (ref) => { if (ref.startsWith("builtin:")) return lib.find((x) => x.slug === ref.slice(8))?.title ?? ref.slice(8); return own.find((x) => String(x.family_id ?? x.id) === ref)?.name ?? t("One of your templates"); };
  const playTitle = (n) => plays.find((p) => p.name === n)?.title ?? n;
  async function setOn(p, on) { note = null; const r = await api("/api/documents/playbooks/enable", { method: "POST", body: { name: p.name, on } }); if (!r.ok) { problem = r.error; return; } note = on ? t("“{name}” is on: its templates come first on Templates.", { name: p.title }) : t("“{name}” is off.", { name: p.title }); await load(); }
  async function save() { const r = await api("/api/documents/playbooks/save", { method: "POST", body: { name: bk.name, title: bk.title, description: bk.description, plays: bk.plays, templates: bk.templates } }); if (!r.ok) { problem = r.error; return; } bk = null; note = t("Playbook saved."); await load(); }
  async function drop(p) { if (!await ask(t("Archive the playbook “{name}”?", { name: p.title }))) return; const r = await api("/api/documents/playbooks/archive", { method: "POST", body: { name: p.name } }); if (!r.ok) problem = r.error; else await load(); }
  const toggle = (arr, v, on) => (on ? [...arr, v] : arr.filter((x) => x !== v));
</script>
<div class="flex flex-wrap items-start gap-3">
  <div class="min-w-0">{#if !embedded}<h1 class="text-[length:var(--t-title)] font-medium leading-tight tracking-[-0.02em]">{t("Playbooks")}</h1>{/if}
    <p class="mt-1 text-mute">{t("A playbook is a pack of templates and skills for one job. Switch one on and its templates come first on Templates and for Scribe.")}</p></div>
  <span class="ml-auto"><ProLock item="custom_plays" locked={loaded && !custom} tip={t("Your own skills and playbooks are part of Pro. The built-in playbooks are free to use.")}>{#snippet children(locked)}<button class="btn primary" disabled={locked} onclick={() => (bk = { name: "", title: "", description: "", plays: [], templates: [] })} data-testid="book-new">{t("New playbook")}</button>{/snippet}</ProLock></span>
</div>
<p class="mt-2 text-sm text-mute">{t("Sending the next document on its own when one is signed is an automation.")} <a href="/automations" data-testid="books-to-automations">{t("Automations")}</a></p>
{#if problem}<p class="notice warn mt-3" role="alert">{problem}</p>{/if}{#if note}<p class="notice ok mt-3" role="status">{note}</p>{/if}
{#if bk}
  <section class="card mt-4 grid gap-3 p-4" data-testid="book-form">
    <div class="grid gap-3 sm:grid-cols-2"><label class="grid gap-1"><span class="text-sm font-medium">{t("Title")}</span><input class="field" bind:value={bk.title} data-testid="book-title" /></label><label class="grid gap-1"><span class="text-sm font-medium">{t("Name (letters, numbers, dashes)")}</span><input class="field" bind:value={bk.name} data-testid="book-name" /></label></div>
    <label class="grid gap-1"><span class="text-sm font-medium">{t("What it is for")}</span><input class="field" bind:value={bk.description} /></label>
    <fieldset class="grid gap-1"><legend class="text-sm font-medium">{t("Templates in it")}</legend><div class="grid max-h-64 gap-1 overflow-auto sm:grid-cols-2">
      {#each own as x (x.id)}<label class="flex items-center gap-2 text-sm"><input type="checkbox" checked={bk.templates.includes(String(x.family_id ?? x.id))} onchange={(e) => (bk.templates = toggle(bk.templates, String(x.family_id ?? x.id), e.currentTarget.checked))} />{x.name}</label>{/each}
      {#each lib as x (x.slug)}<label class="flex items-center gap-2 text-sm"><input type="checkbox" checked={bk.templates.includes(`builtin:${x.slug}`)} onchange={(e) => (bk.templates = toggle(bk.templates, `builtin:${x.slug}`, e.currentTarget.checked))} data-testid={`book-pick-t-${x.slug}`} />{x.title} <span class="text-xs text-mute">({x.kind === "form" ? t("Form") : t("Built-in")})</span></label>{/each}
    </div></fieldset>
    <fieldset class="grid gap-1"><legend class="text-sm font-medium">{t("Skills in it")}</legend><div class="grid gap-1 sm:grid-cols-2">{#each plays as p (p.name)}<label class="flex items-center gap-2 text-sm"><input type="checkbox" checked={bk.plays.includes(p.name)} onchange={(e) => (bk.plays = toggle(bk.plays, p.name, e.currentTarget.checked))} data-testid={`book-pick-${p.name}`} />{p.title}</label>{/each}</div></fieldset>
    <div class="flex gap-2"><button class="btn primary" disabled={!bk.plays.length && !bk.templates.length} onclick={save} data-testid="book-save">{t("Save playbook")}</button><button class="btn quiet" onclick={() => (bk = null)}>{t("Cancel")}</button></div>
  </section>
{/if}
{#if !loaded}<div class="mt-4"><PageSkel kind="cards" rows={4} testid="books-skel" /></div>
{:else}
  <ul class="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3" data-testid="book-list">{#each packs as p (p.name)}
    <li class="card flex flex-col gap-2 p-4" data-testid={`book-${p.name}`}>
      <div class="flex items-center gap-2"><b class="grow">{p.title}</b>{#if !p.builtin}<span class="chip !min-h-0">{t("Yours")}</span>{/if}<label class="flex items-center gap-1.5 text-sm" data-testid="book-on"><input type="checkbox" checked={p.enabled} onchange={(e) => setOn(p, e.currentTarget.checked)} />{p.enabled ? t("On") : t("Off")}</label></div>
      <p class="text-sm text-mute">{p.description}</p>
      {#if p.templates.length}<p class="text-sm"><b>{t("Templates")}:</b> {p.templates.map(titleOf).join(", ")}</p>{/if}
      {#if p.plays.length}<p class="text-sm"><b>{t("Skills")}:</b> {p.plays.map(playTitle).join(", ")}</p>{/if}
      {#if !p.builtin}<div><button class="btn quiet !min-h-10" onclick={() => drop(p)}>{t("Archive")}</button></div>{/if}
    </li>
  {:else}<li class="rounded-lg border border-dashed border-line p-6 text-center text-mute sm:col-span-2 xl:col-span-3">{t("No playbooks yet.")}</li>{/each}</ul>
{/if}
