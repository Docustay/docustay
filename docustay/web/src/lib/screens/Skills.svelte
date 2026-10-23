<script>
  let { embedded = false } = $props();   // Launch step 7: shown inside another screen (Documents, Plays, Billing), which owns the page title
  // PLAYS — THE SKILLS LIBRARY (FINAL PUSH Stage 4; Run 9 Part 4R, the maintainer 12 Oct 2026). Skills guide how Scribe writes: add-ons (a clause such as a late fee), house styles (Plain English) and the
  // workspace's own skills (Pro). A skill never picks a template — templates live on Templates, each with its own guidance. Every skill can be read and switched on or off here.
  import ProLock from "$lib/pro/ProLock.svelte"; import Toggle from "$lib/ui/Toggle.svelte"; import Icon from "$lib/ui/Icon.svelte";
  import PageSkel from "$lib/ui/PageSkel.svelte";
  import { exploreProFrom } from "$lib/pro/proSheet.svelte.js";
  import { ask, askText } from "$lib/ui/confirm.svelte.js";
  import ListEditor from "$lib/ui/ListEditor.svelte";
  import { live } from "$lib/live.js";
  import { plan } from "$lib/pro/plan.svelte.js";
  import { onMount } from "svelte";
  import { api } from "$lib/api.js";
  import { t } from "$lib/i18n/index.svelte.js";
  const un = (r) => r.json?.data ?? r.json;
  const KIND_FILTERS = [["all", "All"], ["addon", "Add-ons"], ["house_style", "House styles"], ["skill", "Your skills"]];
  const filterLabel = (id) => ({ all: t("All"), addon: t("Add-ons"), house_style: t("House styles"), skill: t("Your skills") })[id] ?? id;
  const kindLabel = (k) => (k === "addon" ? t("Add-on") : k === "house_style" ? t("House style") : k === "skill" ? t("Skill") : k);
  let plays = $state([]), canManage = $state(true), custom = $state(false), kind = $state("all"), q = $state(""), problem = $state(null), note = $state(null), loaded = $state(false);
  let ed = $state(null), result = $state(null), busy = $state(false), reading = $state(null);
  const shown = $derived(plays.filter((p) => (kind === "all" || (kind === "skill" ? !p.builtin : p.kind === kind)) && (!q.trim() || `${p.title} ${p.description}`.toLowerCase().includes(q.trim().toLowerCase()))));
  async function load() {
    const r = await api("/api/documents/plays"); loaded = true;
    if (!r.ok) { problem = r.error ?? t("Skills could not be loaded."); return; }
    const d = un(r); plays = d.plays ?? []; custom = d.custom === true; canManage = d.canManage !== false;
  }
  onMount(load);
  async function read(p) { if (reading?.name === p.name) { reading = null; return; } const r = await api(`/api/documents/plays/${p.name}`); if (!r.ok) { problem = r.error; return; } reading = { name: p.name, play: un(r).play }; }
  async function setOn(p, on) { const r = await api("/api/documents/plays/on", { method: "POST", body: { name: p.name, on } }); if (!r.ok) problem = r.error; else { note = on ? t("“{name}” is on.", { name: p.title }) : t("“{name}” is off: Scribe will not use it here.", { name: p.title }); await load(); } }
  // ── builder: the form writes the skill file (JSON is valid YAML, so nothing else is needed to write it) ──
  const blank = () => ({ name: "", title: "", description: "", kind: "skill", category: "contracts", whenNot: "", checklist: [], flags: [], questions: [], body: "", editing: false });
  const j = JSON.stringify;
  function toSource(e) {
    const L = ["---", `name: ${e.name}`, `title: ${j(e.title)}`, `description: ${j(e.description)}`, `kind: ${e.kind}`, `category: ${e.category}`];
    if (e.whenNot.trim()) L.push(`when_not: ${j(e.whenNot)}`);
    const qs = e.questions.filter((x) => x.question.trim()).map((x, i) => ({ key: x.key || `q_${i + 1}`, question: x.question, must_ask: x.must, ...(x.multi ? { multiSelect: true } : {}), options: x.options.filter((o) => o.label.trim()).map((o) => ({ label: o.label, ...(o.description ? { description: o.description } : {}), ...(o.rec ? { recommended: true } : {}) })) }));
    if (qs.length) L.push(`questions: ${j(qs)}`);
    const cl = (e.checklist ?? []).map((x) => String(x).trim()).filter(Boolean); if (cl.length) L.push(`checklist: ${j(cl)}`);
    const fl = e.flags.filter((f) => f.topic.trim() && f.note.trim()); if (fl.length) L.push(`flags: ${j(fl)}`);
    L.push("---", "", e.body ?? ""); return L.join("\n");
  }
  function fromPlay(p, name) { return { name, title: p.title, description: p.description, kind: p.kind, category: p.category ?? "contracts", whenNot: p.whenNot ?? "", checklist: [...(p.checklist ?? [])], flags: (p.flags ?? []).map((f) => ({ ...f })), body: p.body ?? "", editing: true,
    questions: (p.questions ?? []).map((x) => ({ key: x.key, question: x.question, must: x.mustAsk, multi: x.multiSelect, options: x.options.map((o) => ({ label: o.label, description: o.description ?? "", rec: o.recommended === true })) })) }; }
  async function edit(p) { const r = await api(`/api/documents/plays/${p.name}`); if (!r.ok) { problem = r.error; return; } const d = un(r); ed = fromPlay(d.play, p.name); result = null; }
  const addQ = () => ed.questions.push({ key: "", question: "", must: true, multi: false, options: [{ label: "", description: "", rec: false }, { label: "", description: "", rec: false }] });
  const move = (arr, i, d) => { const k = i + d; if (k < 0 || k >= arr.length) return; [arr[i], arr[k]] = [arr[k], arr[i]]; };
  async function test() { busy = true; const r = await api("/api/documents/plays/test", { method: "POST", body: { source: toSource(ed) } }); busy = false; result = r.ok ? un(r) : { ok: false, errors: [r.error] }; }
  async function save(publish) {
    busy = true; problem = null; const r = await api("/api/documents/plays/save", { method: "POST", body: { source: toSource(ed) } });
    if (!r.ok) { busy = false; result = { ok: false, errors: [r.error] }; return; }
    if (publish) { const p = await api("/api/documents/plays/publish", { method: "POST", body: { name: ed.name, version: un(r).version } }); if (!p.ok) { busy = false; result = { ok: false, errors: [p.error] }; return; } }
    busy = false; note = publish ? t("Published.") : t("Saved as a draft."); ed = null; await load();
  }
  async function duplicate(p) { const as = await askText(t("Name for your copy (letters, numbers, dashes)"), { yes: t("Make a copy"), required: true, value: `${p.name}-copy` }); if (!as) return; const r = await api("/api/documents/plays/duplicate", { method: "POST", body: { name: p.name, as } }); if (!r.ok) { problem = r.error; return; } note = t("Copied. Open it from your skills to change it."); await load(); }
  async function archive(p) { if (!await ask(t("Archive “{name}”? It stops being offered.", { name: p.title }))) return; const r = await api("/api/documents/plays/archive", { method: "POST", body: { name: p.name } }); if (!r.ok) problem = r.error; else await load(); }
  async function importZip(file) { if (!file) return; const buf = new Uint8Array(await file.arrayBuffer()); let s = ""; for (const b of buf) s += String.fromCharCode(b); const r = await api("/api/documents/plays/import", { method: "POST", body: { data: btoa(s) } }); if (!r.ok) problem = r.error; else { note = t("Imported as a draft."); await load(); } }
  onMount(() => live(["plays"], load));
</script>
<div class="flex flex-wrap items-center gap-3">{#if !embedded}<h1 class="text-[length:var(--t-title)] font-medium leading-tight tracking-[-0.02em]">{t("Plays")}</h1>{/if}
  {#if !embedded}<a class="btn ml-auto" href="/plays?tab=packs" data-testid="plays-to-packs">{t("Playbooks")}</a>{/if}</div>
<p class="mt-1 text-mute">{t("Skills guide how Scribe writes: add-ons add a clause such as a late fee, house styles set the tone, and your own skills carry your rules. Templates are on Templates; a skill never picks one.")}</p>
{#if loaded && !canManage}<p class="notice mt-3" data-testid="plays-members-note">{t("Only Admins and Owners can create, change or switch on plays. The ones that are switched on are used when you draft.")}</p>{/if}
{#if problem}<p class="notice warn mt-4" role="alert" data-testid="plays-problem">{problem}</p>{/if}{#if note}<p class="notice ok mt-4" role="status">{note}</p>{/if}
{#if !loaded && plan.data?.plan?.key !== "docustay_pro"}<div class="mt-4 min-h-[9.7rem] sm:min-h-[4.9rem]" aria-hidden="true"></div>{/if}   <!-- R10-60: the Pro card arrives with the list; its place is held while the list loads, so the cards below do not jump (CLS) -->
{#if loaded && !custom}
  <p class="mt-3 text-[13px] text-mute" data-testid="plays-pro-card">{t("Your own skills and playbooks are part of Pro and Lifetime")}. {t("The built-in skills below are free to use.")} <button type="button" class="text-link underline" data-testid="plays-pro-link" onclick={(e) => exploreProFrom("custom_plays", e.currentTarget)}>{t("Explore Pro")}</button></p>
{/if}
{#if ed}
    <section class="mt-4 grid gap-3 border-y border-line py-4" data-testid="plays-builder">
      <h2 class="text-lg font-semibold">{ed.editing ? t("Change this skill") : t("New skill")}</h2>
      <div class="grid gap-3 sm:grid-cols-2">
        <label class="grid gap-1"><span class="text-sm font-medium">{t("Title")}</span><input class="field" bind:value={ed.title} data-testid="pb-title" /></label>
        <label class="grid gap-1"><span class="text-sm font-medium">{t("Name (letters, numbers, dashes)")}</span><input class="field" bind:value={ed.name} disabled={ed.editing} data-testid="pb-name" /></label>
        <label class="grid gap-1 sm:col-span-2"><span class="text-sm font-medium">{t("When to use it (one line)")}</span><input class="field" bind:value={ed.description} data-testid="pb-description" /></label>
        <label class="grid gap-1"><span class="text-sm font-medium">{t("Kind")}</span><select class="field" bind:value={ed.kind}>{#each ["skill", "addon", "house_style"] as v}<option value={v}>{kindLabel(v)}</option>{/each}</select></label>
      </div>
      <div class="grid gap-2"><div class="flex items-center gap-2"><h3 class="font-semibold">{t("Questions")}</h3><button class="btn ml-auto" onclick={addQ} data-testid="pb-add-q">{t("Add a question")}</button></div>
        {#each ed.questions as x, i (i)}
          <div class="rounded-lg border border-line p-3" data-testid="pb-q">
            <div class="flex gap-2"><input class="field grow" placeholder={t("The question")} bind:value={x.question} /><button class="btn quiet" onclick={() => move(ed.questions, i, -1)} aria-label={t("Move up")}>↑</button><button class="btn quiet" onclick={() => move(ed.questions, i, 1)} aria-label={t("Move down")}>↓</button><button class="btn quiet" onclick={() => ed.questions.splice(i, 1)} aria-label={t("Remove")}>✕</button></div>
            <div class="mt-2 grid gap-1.5">{#each x.options as o, k (k)}<div class="flex gap-2"><input class="field w-40" placeholder={t("Option")} bind:value={o.label} /><input class="field grow" placeholder={t("What it means")} bind:value={o.description} /><label class="flex items-center gap-1 text-xs"><input type="checkbox" bind:checked={o.rec} />{t("Recommended")}</label></div>{/each}
              {#if x.options.length < 4}<button class="btn quiet w-fit" onclick={() => x.options.push({ label: "", description: "", rec: false })}>{t("Add an option")}</button>{/if}</div>
            <div class="mt-2 flex gap-4 text-sm"><label class="flex items-center gap-1"><input type="checkbox" bind:checked={x.must} />{t("Must ask")}</label><label class="flex items-center gap-1"><input type="checkbox" bind:checked={x.multi} />{t("Pick any")}</label></div>
          </div>
        {/each}</div>
      <ListEditor label={t("The finished document must")} bind:value={ed.checklist} placeholder={t("For example: name every signer")} addLabel={t("Add a check")} testid="play-checklist" />
      <div class="grid gap-2"><div class="flex items-center gap-2"><h3 class="font-semibold">{t("Notes to show the sender (up to 3 appear)")}</h3><button class="btn ml-auto" onclick={() => ed.flags.length < 4 && ed.flags.push({ topic: "", note: "" })}>{t("Add a note")}</button></div>
        {#each ed.flags as f, i (i)}<div class="flex gap-2"><input class="field w-48" placeholder={t("Clause")} bind:value={f.topic} /><input class="field grow" placeholder={t("What to check")} bind:value={f.note} /><button class="btn quiet" onclick={() => ed.flags.splice(i, 1)} aria-label={t("Remove")}>✕</button></div>{/each}</div>
      <label class="grid gap-1"><span class="text-sm font-medium">{t("Guidance and vetted text")}</span><textarea class="field" rows="5" bind:value={ed.body}></textarea></label>
      {#if result}<div class="notice {result.ok ? 'ok' : 'warn'}" role="status" data-testid="pb-result">{#if result.ok}{t("Looks good: {q} questions ({m} must-ask).", { q: result.questions, m: result.mustAsk })}{:else}<ul>{#each result.errors as e}<li>{e}</li>{/each}</ul>{/if}</div>{/if}
      <div class="flex flex-wrap gap-2"><button class="btn" disabled={busy} onclick={test} data-testid="pb-test">{t("Check it")}</button><button class="btn" disabled={busy} onclick={() => save(false)} data-testid="pb-save">{t("Save draft")}</button><button class="btn primary" disabled={busy} onclick={() => save(true)} data-testid="pb-publish">{t("Publish")}</button><button class="btn quiet" onclick={() => (ed = null)}>{t("Cancel")}</button></div>
    </section>
  {:else}
    <div class="mt-4 flex flex-wrap items-center gap-2">
      <input class="field !w-full sm:!w-64" placeholder={t("Search skills")} aria-label={t("Search skills")} bind:value={q} data-testid="plays-search" />
      <div class="ml-auto flex flex-wrap gap-2" hidden={!canManage}>{#if custom}<label class="btn cursor-pointer">{t("Import a skill (zip)")}<input type="file" accept=".zip,application/zip" class="sr-only" onchange={(e) => importZip(e.currentTarget.files?.[0])} /></label>{/if}<ProLock item="custom_plays" quiet locked={loaded && !custom} tip={t("Your own skills and playbooks are part of Pro and Lifetime. The built-in skills are free to use.")}>{#snippet children(locked)}<button class="btn primary" disabled={locked} onclick={() => { ed = blank(); result = null; }} data-testid="plays-new">{t("Add your own skill")}</button>{/snippet}</ProLock></div>
    </div>
    <div class="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[13px]" role="group" aria-label={t("Categories")}>{#each KIND_FILTERS as [id]}<button class="min-h-7 text-mute hover:text-ink aria-pressed:font-semibold aria-pressed:text-ink" aria-pressed={kind === id} onclick={() => (kind = id)} data-testid={`plays-kind-${id}`}>{filterLabel(id)}</button>{/each}</div>
    <ul class="mt-3" data-testid="plays-list">
      {#each shown as p (p.name)}
        <li class="border-b border-line py-3" data-testid={`play-${p.name}`}>
          <div class="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1 sm:grid-cols-[auto_minmax(0,1fr)_110px_auto_auto]">
            <span class="mt-0.5 text-accent-ink" aria-hidden="true"><Icon name="sparkles" size={16} /></span>
            <div class="min-w-0"><p class="text-[13px] font-medium">{p.title}{#if !p.builtin}<span class="ml-2 text-[12px] font-normal text-mute">{p.published ? t("Yours") : t("Draft")}</span>{/if}</p><p class="text-[12.5px] text-mute">{p.description}</p></div>
            <span class="hidden pt-0.5 text-[12px] text-mute sm:block">{kindLabel(p.kind)}</span>
            <span class="pt-0.5">{#if p.builtin || p.published}{#if canManage}<Toggle checked={p.on !== false} ariaLabel={`${p.title}: ${p.on !== false ? t("On") : t("Off")}`} onchange={(v) => setOn(p, v)} testid="play-on" />{:else}<span class="text-[12px] text-mute" data-testid="play-state">{p.on !== false ? t("On") : t("Off")}</span>{/if}{/if}</span>
            <span class="col-span-3 col-start-2 flex flex-wrap items-center gap-2 sm:col-span-1 sm:col-start-auto">
              <button class="btn" onclick={() => read(p)} aria-expanded={reading?.name === p.name} data-testid="play-read">{reading?.name === p.name ? t("Close") : t("Read")}</button>
              {#if p.builtin}{#if canManage}<ProLock item="custom_plays" quiet locked={loaded && !custom} tip={t("Your own skills and playbooks are part of Pro and Lifetime. The built-in skills are free to use.")}>{#snippet children(locked)}<button class="btn" disabled={locked} onclick={() => duplicate(p)} data-testid="play-duplicate">{t("Make a copy")}</button>{/snippet}</ProLock>{/if}
              {:else}{#if canManage}<button class="btn" onclick={() => edit(p)} data-testid="play-edit">{t("Change")}</button>{/if}<a data-sveltekit-reload class="btn" href={`/api/documents/plays/${p.name}/export.zip`}>{t("Export")}</a>{#if canManage}<button class="btn quiet" onclick={() => archive(p)}>{t("Archive")}</button>{/if}{/if}
            </span>
          </div>
          {#if reading?.name === p.name}<div class="ml-7 mt-2 border-l-2 border-line pl-3 text-[13px]" data-testid="play-reading">{#if reading.play.whenNot}<p><b>{t("When not to use it")}:</b> {reading.play.whenNot}</p>{/if}{#if reading.play.questions?.length}<p class="mt-1"><b>{t("Questions")}:</b></p><ul class="ml-4 list-disc">{#each reading.play.questions as x (x.key)}<li>{x.question}</li>{/each}</ul>{/if}{#if reading.play.checklist?.length}<p class="mt-1"><b>{t("The finished document must")}:</b></p><ul class="ml-4 list-disc">{#each reading.play.checklist as c, i (i)}<li>{c}</li>{/each}</ul>{/if}{#if reading.play.body}<p class="mt-1 whitespace-pre-line">{reading.play.body}</p>{/if}</div>{/if}
        </li>
      {:else}{#if loaded}<li class="py-6 text-center text-[13px] text-mute" data-testid="plays-empty">{q.trim() ? t("Nothing matches that search.") : kind === "skill" ? t("You have no skills of your own yet.") : t("Nothing here yet.")}</li>{:else}<li data-testid="list-loading"><PageSkel kind="list" rows={6} testid="plays-skel" /></li>{/if}{/each}
    </ul>
  {/if}
