<script>
  // Documents (frame: portal board 1 and 2): page header, filter tabs, search and pills, a table of documents with who it is for, a status chip and a relative time; an empty list is one card with a floating paper.
  import ProLock from "$lib/pro/ProLock.svelte";
  import DocumentUsage from "$lib/pro/DocumentUsage.svelte";
  import { live } from "$lib/live.js";
  import { onMount } from "svelte";
  import { api } from "$lib/api.js";
  import Icon from "$lib/ui/Icon.svelte";
  import PageHeader from "$lib/ui/PageHeader.svelte";
  import ApiCall from "$lib/ui/ApiCall.svelte";
  import Tabs from "$lib/ui/Tabs.svelte";
  import FilterSelect from "$lib/ui/FilterSelect.svelte";
  import DataTable from "$lib/ui/DataTable.svelte";
  import StatusChip from "$lib/ui/StatusChip.svelte";
  import RelativeTime from "$lib/ui/RelativeTime.svelte";
  import Segment from "$lib/ui/Segment.svelte";
  import EmptyState from "$lib/ui/EmptyState.svelte";
  import Paper from "$lib/ui/Paper.svelte";
  import { t } from "$lib/i18n/index.svelte.js";
  import FirstRun from "$lib/entry/FirstRun.svelte";
  import { plan } from "$lib/pro/plan.svelte.js";
  const PER = 8;
  // Launch step 7: Contracts is a second view of this screen (every signed document with its dates and amounts), not a row of its own in the sidebar. ?view=contracts opens it.
  let area = $state(typeof location !== "undefined" && new URLSearchParams(location.search).get("view") === "contracts" ? "contracts" : "documents");
  const setArea = (a) => { area = a; history.replaceState(null, "", a === "contracts" ? "?view=contracts" : location.pathname); };
  let rows = $state(null), problem = $state(null), tab = $state("all"), q = $state(""), range = $state("30"), team = $state(""), source = $state(""), pageNo = $state(1), view = $state("table");
  const TABS = $derived([{ value: "all", label: t("All") }, { value: "waiting", label: t("Waiting") }, { value: "executed", label: t("Signed") }, { value: "declined", label: t("Declined") }, { value: "draft", label: t("Drafts") }]);
  const RANGES = $derived([{ value: "7", label: t("Last 7 days") }, { value: "30", label: t("Last 30 days") }, { value: "90", label: t("Last 90 days") }, { value: "0", label: t("All time") }]);
  const teams = $derived([...new Set((rows ?? []).map((r) => r.team).filter(Boolean))]);
  // Run 7: where a document came from — any form, or one form by name (?source=form or ?form=<name> opens it filtered, as the Forms page links)
  const formNames = $derived([...new Set((rows ?? []).filter((r) => r.from_form).map((r) => r.form_name).filter(Boolean))].sort());
  const SOURCES = $derived([{ value: "", label: t("All sources") }, { value: "form", label: t("From a form") }, { value: "sent", label: t("Sent by your team") }, ...formNames.map((n) => ({ value: `form:${n}`, label: n }))]);
  const bySource = (r) => !source || (source === "form" ? r.from_form : source === "sent" ? !r.from_form : r.from_form && `form:${r.form_name}` === source);
  const TEAMS = $derived([{ value: "", label: t("All teams") }, ...teams.map((x) => ({ value: x, label: x }))]);
  const LANES = $derived([{ key: "draft", title: t("Drafts"), hint: t("Not sent yet"), states: ["draft"], icon: "pen" }, { key: "out", title: t("Out for signature"), hint: t("Waiting on someone"), states: ["sent", "partially_signed"], icon: "send" }, { key: "done", title: t("Finished"), hint: t("Signed, or ended"), states: ["executed", "declined", "expired", "voided", "void"], icon: "check" }]);
  onMount(() => { const sp = new URLSearchParams(location.search); if (sp.get("form")) source = `form:${sp.get("form")}`; else if (sp.get("source") === "form") source = "form"; try { view = localStorage.getItem("docustay-docs-view") === "board" ? "board" : "table"; } catch { /* storage may be blocked */ } loadRows(); return live(["documents"], loadRows); });
  const loadRows = async () => { const r = await api("/api/list/documents"); if (r.ok) rows = r.json.rows ?? []; else problem = r.error ?? t("The documents could not be loaded."); };
  const setView = (v) => { view = v; try { localStorage.setItem("docustay-docs-view", v); } catch { /* ignore */ } };
  const when = (r) => r.executed_at ?? r.sent_at ?? r.created_at ?? null;
  const inRange = (r) => { const n = Number(range); if (!n) return true; const d = when(r); return !d || Date.now() - new Date(d).getTime() < n * 86400000; };
  const match = (r) => (!q.trim() || `${r.title} ${r.subject ?? ""}`.toLowerCase().includes(q.trim().toLowerCase())) && inRange(r) && (!team || r.team === team) && bySource(r);
  const byTab = (r) => tab === "all" || (tab === "waiting" ? ["sent", "partially_signed"].includes(r.state) : r.state === tab);
  const shown = $derived((rows ?? []).filter((r) => byTab(r) && match(r)).sort((a, b) => String(when(b) ?? "").localeCompare(String(when(a) ?? ""))));
  const pages = $derived(Math.max(1, Math.ceil(shown.length / PER)));
  const slice = $derived(shown.slice((Math.min(pageNo, pages) - 1) * PER, Math.min(pageNo, pages) * PER));
  $effect(() => { tab; q; range; team; source; pageNo = 1; });
  const tone = (s) => ({ draft: "mute", sent: "info", partially_signed: "warn", executed: "ok", declined: "bad", expired: "warn", voided: "bad", void: "bad" })[s] ?? "mute";
  const label = (s) => ({ draft: t("Draft"), sent: t("Sent"), partially_signed: t("Partly signed"), executed: t("Signed"), declined: t("Declined"), expired: t("Expired"), voided: t("Cancelled"), void: t("Cancelled") })[s] ?? s;
  const people = (r) => String(r.subject ?? "").split(/,|&| and /).map((x) => x.trim()).filter(Boolean);
  const initials = (n) => n.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  const hue = (n) => [...n].reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
  const lane = (l) => shown.filter((r) => l.states.includes(r.state));
  const columns = $derived([{ key: "title", label: t("Document") }, { key: "subject", label: t("For") }, { key: "state", label: t("Status") }, { key: "updated", label: t("Updated") }]);
</script>
<svelte:head><title>{t("Documents")} · Docustay</title></svelte:head>
<PageHeader title={t("Documents")}>
  {#snippet actions()}<ApiCall path="/api/v1/documents" /><ProLock item="bulk_send" tip={t("Send one template to a list of people from a spreadsheet, one document each.")}>{#snippet children(locked)}<a class="btn" href={locked ? undefined : "/templates?bulk=1"} aria-disabled={locked ? "true" : undefined} data-testid="dc-bulk">{t("Bulk send")}</a>{/snippet}</ProLock><a href="/create?mode=document" class="btn primary" data-testid="dc-new"><Icon name="plus" size={15} />{t("New document")}</a>{/snippet}
</PageHeader>
<nav class="-mt-2 mb-4 flex gap-1 border-b border-line pb-2" role="tablist" aria-label={t("Documents views")} data-testid="documents-areas">{#each [["documents", t("Documents")], ["contracts", t("Contracts")]] as [k, l]}<button role="tab" aria-selected={area === k} class="vtab {area === k ? 'on' : ''}" onclick={() => setArea(k)} data-testid="documents-view-{k}">{l}</button>{/each}</nav>
{#if area === "contracts"}{#await import("$lib/screens/Contracts.svelte") then { default: Contracts }}<Contracts embedded />{/await}{:else}
<div class="mb-4 empty:hidden"><DocumentUsage /></div>
{#if problem}<p class="notice bad" role="alert">{problem}</p>
{:else if rows === null}<div class="grid gap-2" aria-busy="true">{#each [0, 1, 2, 3, 4] as k}<div class="skel h-12"></div>{/each}</div>
{:else if rows.length === 0}
  <EmptyState title={t("No documents yet")} line={t("Upload a PDF, place the fields, and send it for signature. Everything you send appears here.")}>
    {#snippet art()}<Paper width={84} skeleton class="!rounded-[14px]" />{/snippet}
    {#snippet action()}<div class="flex flex-wrap justify-center gap-2"><a href="/create?mode=document&upload=1" class="btn primary" data-testid="dc-upload"><Icon name="upload" size={15} />{t("Upload a file")}</a><a href="/create?mode=document&start=readymade" class="btn">{t("Use a template")}</a></div>{/snippet}
  </EmptyState>
{:else}
  <div class="mb-4 flex flex-wrap items-center gap-3">
    <Tabs items={TABS} bind:value={tab} label={t("Filter documents")} testid="doc-tabs" />
    <div class="ml-auto flex flex-wrap items-center gap-2">
      <div class="relative"><span class="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-mute"><Icon name="search" size={15} /></span><input class="field !min-h-9 !w-52 !pl-8" placeholder={t("Search")} aria-label={t("Search documents")} bind:value={q} data-testid="doc-search" /></div>
      <FilterSelect options={RANGES} bind:value={range} label={t("Date range")} testid="doc-range" />
      {#if formNames.length || source}<FilterSelect options={SOURCES} bind:value={source} label={t("Where it came from")} testid="doc-source" />{/if}
      {#if teams.length}<FilterSelect options={TEAMS} bind:value={team} label={t("Team")} testid="doc-team" />{/if}
      <Segment label={t("View")} value={view} onchange={setView} options={[{ value: "table", label: t("Table") }, { value: "board", label: t("Board") }]} testid="doc-view" />
    </div>
  </div>
  {#if shown.length === 0}
    <p class="text-mute">{t("Nothing matches that.")} <button class="text-brand underline" onclick={() => { tab = "all"; q = ""; range = "0"; team = ""; source = ""; }}>{t("Clear filters")}</button></p>
  {:else if view === "board"}
    <div class="grid gap-4 lg:grid-cols-3" data-testid="board">{#each LANES as l (l.key)}{@const items = lane(l)}
      <section class="rounded-2xl border border-line bg-card p-3" aria-labelledby="lane-{l.key}" data-testid="lane-{l.key}"><header class="mb-3 flex items-center gap-2 px-1"><Icon name={l.icon} size={15} class="text-mute" /><h2 id="lane-{l.key}" class="text-[14px] font-medium">{l.title}</h2><span class="chip mute ml-auto" data-testid="lane-count">{items.length}</span></header>
        {#if !items.length}<p class="px-1 py-6 text-center text-sm text-mute">{l.hint}</p>{/if}
        <ul class="grid gap-2">{#each items as r (r.id)}<li><a class="block rounded-xl bg-paper p-3 no-underline hover:bg-tint" href="/documents/{r.id}" data-testid="doc-card"><span class="block text-[14.5px] font-medium">{r.title}</span><span class="mt-0.5 block truncate text-[12.5px] text-mute">{r.subject ?? "—"}</span><span class="mt-2 flex items-center gap-2"><StatusChip tone={tone(r.state)}>{label(r.state)}</StatusChip>{#if r.is_test}<span class="chip warn" data-testid="test-chip">{t("Test")}</span>{/if}<span class="ml-auto text-[12px] text-mute"><RelativeTime value={when(r)} /></span></span></a></li>{/each}</ul></section>{/each}</div>
  {:else}
    <DataTable {columns} rows={slice} testid="doc-table">
      {#snippet cell(r, c)}
        {#if c.key === "title"}<a href="/documents/{r.id}" class="flex min-w-0 items-center gap-3 no-underline" data-testid="doc-row"><span class="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-[9px] bg-tint text-brand"><Icon name="file-text" size={16} /></span><span class="min-w-0 flex-1"><span class="block truncate text-[14px] font-medium">{r.title}{#if r.is_test} <span class="chip warn ml-1" data-testid="test-chip">{t("Test")}</span>{/if}{#if r.from_form} <span class="chip ml-1" data-testid="form-chip">{t("Form")}</span>{/if}</span><span class="block truncate text-[12.5px] text-mute">{r.subject ?? "—"}{#if r.form_name} · {r.form_name}{/if}</span></span></a>
        {:else if c.key === "subject"}<span class="flex -space-x-2">{#each people(r).slice(0, 4) as n}<span class="grid h-[26px] w-[26px] place-items-center rounded-full border-2 border-[var(--card)] text-[10px] font-semibold text-white" style="background: hsl({hue(n)} 50% 28%)" title={n}>{initials(n)}</span>{:else}<span class="text-mute">—</span>{/each}</span>
        {:else if c.key === "state"}<StatusChip tone={tone(r.state)}>{label(r.state)}</StatusChip>
        {:else}<span class="text-mute"><RelativeTime value={when(r)} /></span>{/if}
      {/snippet}
    </DataTable>
    <div class="mt-3 flex items-center justify-between text-[13px] text-mute"><span>{t("Page {n} · {a} to {b} of {c}", { n: Math.min(pageNo, pages), a: (Math.min(pageNo, pages) - 1) * PER + 1, b: Math.min(shown.length, Math.min(pageNo, pages) * PER), c: shown.length })}</span><span class="flex gap-2"><button class="btn !min-h-8 !px-3" disabled={pageNo <= 1} onclick={() => (pageNo -= 1)}>{t("Previous")}</button><button class="btn !min-h-8 !px-3" disabled={pageNo >= pages} onclick={() => (pageNo += 1)}>{t("Next")}</button></span></div>
  {/if}
{/if}
<!-- the checklist sits BELOW the list (and the empty state), so it never pushes the page down once it appears -->
{#if !plan.data?.demo}<FirstRun documents={rows} />{/if}
{/if}
<style>
  .vtab { padding: 7px 12px; border-radius: 9px; font-size: 13.5px; color: var(--mute); } .vtab:hover { color: var(--ink); background: var(--tint); } .vtab.on { background: var(--tint); color: var(--ink); font-weight: 500; }
  .skel { border-radius: 12px; background: linear-gradient(90deg, var(--tint) 25%, var(--card) 50%, var(--tint) 75%); background-size: 200% 100%; animation: skel 1.4s ease-in-out infinite; } @keyframes skel { to { background-position: -200% 0; } } @media (prefers-reduced-motion: reduce) { .skel { animation: none; } }
</style>
