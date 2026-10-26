<script>
  // Documents (frame: portal board 1 and 2): page header, filter tabs, search and pills, a table of documents with who it is for, a status chip and a relative time; an empty list is one card with a floating paper.
  import ProLock from "$lib/pro/ProLock.svelte";
  import DocumentUsage from "$lib/pro/DocumentUsage.svelte";
  import PlanPrompt from "$lib/pro/PlanPrompt.svelte";
  import { live } from "$lib/live.js";
  import { onMount } from "svelte";
  import { api } from "$lib/api.js";
  import Icon from "$lib/ui/Icon.svelte";
  import PageHeader from "$lib/ui/PageHeader.svelte";
  import ApiCall from "$lib/ui/ApiCall.svelte";
  import Tabs from "$lib/ui/Tabs.svelte";
  import FilterSelect from "$lib/ui/FilterSelect.svelte";
      import RelativeTime from "$lib/ui/RelativeTime.svelte";
  import Segment from "$lib/ui/Segment.svelte";
  import Thumbnail from "$lib/ui/Thumbnail.svelte";
  import Ribbon from "$lib/ui/Ribbon.svelte";
  import { toast } from "$lib/ui/toast.js";
  import EmptyState from "$lib/ui/EmptyState.svelte";
  import Paper from "$lib/ui/Paper.svelte";
  import { t } from "$lib/i18n/index.svelte.js";
  import FirstRun from "$lib/entry/FirstRun.svelte";
  import { plan } from "$lib/pro/plan.svelte.js";
  const PER = 8;   // rows per page
  let mine = $state([]), mineAsked = false, rows = $state(null), problem = $state(null), tab = $state("all"), q = $state(""), range = $state("30"), team = $state(""), pageNo = $state(1), view = $state("list");
  const count = (f) => (rows ?? []).filter(f).length;
  const TABS = $derived([{ value: "you", label: t("Waiting on you"), count: mine.length }, { value: "all", label: t("All"), count: count(() => true) }, { value: "waiting", label: t("Waiting"), count: count((r) => ["sent", "partially_signed"].includes(r.state)) }, { value: "executed", label: t("Signed"), count: count((r) => r.state === "executed") }, { value: "declined", label: t("Declined"), count: count((r) => r.state === "declined") }, { value: "draft", label: t("Drafts"), count: count((r) => r.state === "draft") }]);
  const RANGES = $derived([{ value: "7", label: t("Last 7 days") }, { value: "30", label: t("Last 30 days") }, { value: "90", label: t("Last 90 days") }, { value: "0", label: t("All time") }]);
  const teams = $derived([...new Set((rows ?? []).map((r) => r.team).filter(Boolean))]);
  const TEAMS = $derived([{ value: "", label: t("All teams") }, ...teams.map((x) => ({ value: x, label: x }))]);
  onMount(() => { const sp = new URLSearchParams(location.search); try { view = localStorage.getItem("docustay-docs-view") === "thumbs" ? "thumbs" : "list"; } catch { /* storage may be blocked */ } /* an older "board" or "table" choice opens as the list */ loadRows(); return live(["documents"], loadRows); });
  const loadRows = async () => {
    const [r, w] = await Promise.all([api("/api/list/documents"), api("/api/documents/waiting-on-me")]);
    mine = w.ok ? ((w.json?.data ?? w.json)?.documents ?? []) : [];
    if (!mineAsked) { mineAsked = true; if (mine.length) tab = "you"; }   // something is waiting on this person: open there first
    if (r.ok) { rows = r.json.rows ?? []; problem = null; } else problem = r.error ?? t("The documents could not be loaded.");
  };
  const setView = (v) => { view = v; try { localStorage.setItem("docustay-docs-view", v); } catch { /* ignore */ } };
  const when = (r) => r.executed_at ?? r.sent_at ?? r.updated_at ?? r.created_at ?? null;
  const inRange = (r) => { const n = Number(range); if (!n) return true; const d = when(r); return !d || Date.now() - new Date(d).getTime() < n * 86400000; };
  // R13-D273: the search reads what the row shows — the title and the people it is for (a draft lists its people in party_names, not subject)
  const match = (r) => (!q.trim() || `${r.title} ${r.subject ?? ""} ${(r.party_names ?? []).join(" ")}`.toLowerCase().includes(q.trim().toLowerCase())) && inRange(r) && (!team || r.team === team);
  const byTab = (r) => tab === "all" || tab === "you" || (tab === "waiting" ? ["sent", "partially_signed"].includes(r.state) : r.state === tab);
  const shown = $derived((rows ?? []).filter((r) => byTab(r) && match(r)).sort((a, b) => String(when(b) ?? "").localeCompare(String(when(a) ?? ""))));
  const pages = $derived(Math.max(1, Math.ceil(shown.length / PER)));
  const slice = $derived(shown.slice((Math.min(pageNo, pages) - 1) * PER, Math.min(pageNo, pages) * PER));
  $effect(() => { tab; q; range; team; pageNo = 1; });
  const tone = (s) => ({ draft: "mute", sent: "info", partially_signed: "warn", executed: "ok", declined: "bad", expired: "warn", voided: "bad", void: "bad" })[s] ?? "mute";
  const label = (s) => ({ draft: t("Draft"), sent: t("Sent"), partially_signed: t("Partly signed"), executed: t("Signed"), declined: t("Declined"), expired: t("Expired"), voided: t("Cancelled"), void: t("Cancelled") })[s] ?? s;
  const people = (r) => String(r.subject ?? "").split(/,|&| and /).map((x) => x.trim()).filter(Boolean);
  // the ribbon is read from true facts the list returns (src/records/lists/documents.mjs): seats that must sign and have signed, people who opened it, who is next
  const facts = (r) => ({ state: r.state, sentAt: r.sent_at, openedCount: r.parties_opened, signedCount: r.parties_signed ?? r.signatures, totalCount: r.parties_total, executedAt: r.executed_at, nextName: r.next_party, openedBy: r.opened_by });
  const thumbSrc = (r) => (r.builder === "pdf" ? `/api/documents/pdf/${r.id}/thumb.png` : "");
  const forWhom = (r) => (Array.isArray(r.party_names) && r.party_names.length ? r.party_names.join(", ") : (r.subject ?? ""));
  const waiting = (r) => ["sent", "partially_signed"].includes(r.state);
  async function remind(r) {   // a reminder to everyone who can still sign (the same call the document page makes)
    const tk = await api(`/api/documents/pdf/${r.id}/track`); if (!tk.ok) { toast(tk.error ?? t("That did not work."), "bad"); return; }
    const who = (tk.json.parties ?? []).filter((p) => p.canRemind && !p.inPerson); let ok = 0, sent = 0;
    for (const p of who) { const x = await api("/api/documents/pdf/remind", { method: "POST", body: { instanceId: tk.json.leadId, partyId: p.id } }); if (x.ok) { ok += 1; sent += Number((x.json?.data ?? x.json)?.sent ?? 0); } }
    toast(!ok ? t("Nobody is waiting to be reminded.") : sent ? t("Reminder sent.") : t("No reminder was emailed. Each person on the document says why."), ok && sent ? "ok" : "warn");   // R13-D442: ok means the call worked, not that an email went out
  }
</script>
<svelte:head><title>{t("Documents")} · Docustay</title></svelte:head>
<PageHeader title={t("Documents")}>
  {#snippet actions()}<ApiCall path="/api/v1/documents" /><ProLock item="bulk_send" tip={t("Send one template to a list of people from a spreadsheet, one document each.")}>{#snippet children(locked)}<a class="btn" href={locked ? undefined : "/templates?bulk=1"} aria-disabled={locked ? "true" : undefined} data-testid="dc-bulk">{t("Bulk send")}</a>{/snippet}</ProLock><a href="/create?mode=document" class="btn primary hidden sm:inline-flex" data-testid="dc-new"><Icon name="plus" size={14} />{t("New document")}</a>{/snippet}
</PageHeader>
<div class="mb-3 empty:hidden"><DocumentUsage /></div>
<PlanPrompt action="send_document" id="docs" kinds={["blocked", "soft"]} class="mb-3" />
{#if problem}<p class="notice bad" role="alert" data-testid="documents-failed">{problem} <button class="btn quiet" onclick={loadRows} data-testid="documents-retry">{t("Try again")}</button></p>   <!-- R13-D456 -->
{:else if rows === null}<div class="grid" aria-busy="true">{#each [0, 1, 2, 3, 4] as k}<div class="skel h-14"></div>{/each}</div>
{:else if rows.length === 0 && mine.length === 0}
  <EmptyState title={t("No documents yet")} line={t("Upload a PDF, place the fields, and send it for signature. Everything you send appears here.")}>
    {#snippet art()}<Thumbnail width={84} backplate />{/snippet}
    {#snippet action()}<div class="flex flex-wrap justify-center gap-2"><a href="/create?mode=document&upload=1" class="btn primary" data-testid="dc-upload"><Icon name="upload" size={14} />{t("Upload a file")}</a><a href="/create?mode=document&start=readymade" class="btn">{t("Use a template")}</a></div>{/snippet}
  </EmptyState>
{:else}
  <div class="page-sticky-sub pb-3">
    <Tabs items={TABS} bind:value={tab} label={t("Filter documents")} testid="doc-tabs" class="doc-tabs" />
    <div class="mt-3 flex flex-wrap items-center gap-2">
      <div class="relative"><span class="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-mute"><Icon name="search" size={14} /></span><input class="field !w-52 !pl-8" placeholder={t("Search")} aria-label={t("Search documents")} bind:value={q} data-testid="doc-search" /></div>
      <FilterSelect options={RANGES} bind:value={range} label={t("Date range")} testid="doc-range" />
      {#if teams.length}<FilterSelect options={TEAMS} bind:value={team} label={t("Team")} testid="doc-team" />{/if}
      <div class="ml-auto hidden sm:block"><Segment label={t("View")} value={view} onchange={setView} options={[{ value: "list", label: t("List") }, { value: "thumbs", label: t("Thumbnails") }]} testid="doc-view" /></div>
    </div>
  </div>
  {#if tab === "you"}
    {#if mine.length === 0}<p class="text-mute" data-testid="doc-waiting-you-empty">{t("Nothing is waiting on you.")}</p>
    {:else}<ul class="mt-4 divide-y divide-line rounded-xl border border-line" data-testid="doc-waiting-you">{#each mine as d (d.id)}
      <li class="flex flex-wrap items-center gap-3 px-4 py-3"><span class="min-w-0 flex-1"><a class="block min-h-[24px] truncate text-[13px] font-medium leading-[24px] text-ink no-underline hover:underline" href="/documents/{d.id}" data-testid="doc-waiting-row">{d.title}</a><span class="block text-[12px] text-mute">{d.from ? t("From {name}", { name: d.from }) : t("From your workspace")}{d.sentAt ? " · " : ""}{#if d.sentAt}<RelativeTime value={d.sentAt} />{/if}</span></span>
        <span class="chip warn" data-testid="doc-waiting-action">{d.action === "approve" ? t("Needs your approval") : t("Needs your signature")}</span><a class="btn" href="/documents/{d.id}">{t("Open")}</a></li>{/each}</ul>
      <p class="mt-3 text-[12px] text-mute">{t("To sign, use the link in the email we sent you. It is the same link everyone gets.")}</p>{/if}
  {:else if shown.length === 0}
    <p class="text-mute">{t("Nothing matches that.")} <button class="text-link underline" onclick={() => { tab = "all"; q = ""; range = "0"; team = ""; }}>{t("Clear filters")}</button></p>
  {:else if view === "thumbs"}
    <ul class="pg-gallery mb-8 mt-5" style="--tile: 168px; --tile-gap-y: 1.75rem" data-testid="doc-gallery">{#each slice as r (r.id)}
      <li><a class="group block min-w-0 no-underline" href="/documents/{r.id}" data-testid="doc-card"><Thumbnail width={112} backplate kind={r.state === "executed" ? "sealed" : r.state} src={thumbSrc(r)} alt="" class="w-full" /><span class="mt-2 block truncate text-[13px] font-medium text-ink group-hover:underline">{r.title}</span><span class="mt-1 block min-w-0"><Ribbon facts={facts(r)} class="max-w-full" /></span>{#if r.is_test}<span class="chip warn mt-1" data-testid="test-chip">{t("Test")}</span>{/if}</a></li>{/each}</ul>
  {:else}
    <div class="rows" data-testid="doc-table" role="table" aria-label={t("Documents")}>
      <div class="rows-head doc-cols hidden sm:grid" role="row"><span role="columnheader">{t("Document")}</span><span role="columnheader">{t("Where it is")}</span><span role="columnheader" class="text-right">{t("Updated")}</span></div>
      {#each slice as r (r.id)}
        <div class="rows-row tall doc-cols group relative" role="row">
          <a href="/documents/{r.id}" class="flex min-w-0 items-center gap-3 no-underline" data-testid="doc-row" role="cell"><span class="hidden sm:block"><Thumbnail width={28} kind={r.state === "executed" ? "sealed" : r.state} src={thumbSrc(r)} /></span><span class="sm:hidden"><Thumbnail width={30} kind={r.state === "executed" ? "sealed" : r.state} src={thumbSrc(r)} /></span>
            <span class="min-w-0 flex-1"><span class="block truncate text-[13px] font-medium text-ink">{r.title}{#if r.is_test} <span class="chip warn ml-1" data-testid="test-chip">{t("Test")}</span>{/if}{#if r.from_form} <span class="chip ml-1" data-testid="form-chip">{t("Form")}</span>{/if}</span><span class="block truncate text-[12px] text-mute">{forWhom(r) || "—"}{#if r.form_name} · {r.form_name}{/if}</span><span class="mt-0.5 block sm:hidden"><Ribbon facts={facts(r)} /></span></span></a>
          <span class="hidden min-w-0 sm:block" role="cell"><Ribbon facts={facts(r)} /></span>
          <span class="relative hidden text-right text-[12px] text-mute sm:block" role="cell"><span class="group-hover:invisible group-focus-within:invisible"><RelativeTime value={when(r)} /></span>
            <span class="absolute inset-y-0 right-0 hidden items-center gap-1 group-hover:flex group-focus-within:flex">{#if waiting(r)}<button class="btn" onclick={() => remind(r)} data-testid="doc-remind">{t("Remind")}</button>{/if}<a class="btn" href="/documents/{r.id}">{t("Open")}</a></span></span>
        </div>
      {/each}
    </div>
    <div class="mt-3 flex items-center justify-between text-[12px] text-mute"><span>{t("{a} to {b} of {c}", { a: (Math.min(pageNo, pages) - 1) * PER + 1, b: Math.min(shown.length, Math.min(pageNo, pages) * PER), c: shown.length })}</span><span class="flex gap-2"><button class="btn" disabled={pageNo <= 1} onclick={() => (pageNo -= 1)}>{t("Previous")}</button><button class="btn" disabled={pageNo >= pages} onclick={() => (pageNo += 1)}>{t("Next")}</button></span></div>
  {/if}
{/if}
<!-- phone: the one way to start is at the bottom, 46px -->
<div class="sticky bottom-0 -mx-4 mt-6 border-t border-line bg-paper p-3 sm:hidden"><a href="/create?mode=document" class="btn primary final w-full" data-testid="dc-new-phone"><Icon name="plus" size={14} />{t("New document")}</a></div>
<!-- the checklist sits BELOW the list (and the empty state), so it never pushes the page down once it appears -->
{#if !plan.data?.demo}<FirstRun documents={rows} />{/if}
<style>
  .skel { border-radius: 4px; border-bottom: 1px solid var(--line); background: linear-gradient(90deg, var(--tint) 25%, var(--card) 50%, var(--tint) 75%); background-size: 200% 100%; animation: skel 1.4s ease-in-out infinite; } @keyframes skel { to { background-position: -200% 0; } } @media (prefers-reduced-motion: reduce) { .skel { animation: none; } }
  .doc-cols { grid-template-columns: minmax(0, 1fr); }
  @media (min-width: 640px) { .doc-cols { grid-template-columns: minmax(0, 1fr) 230px 120px; column-gap: 1rem; } }
</style>
