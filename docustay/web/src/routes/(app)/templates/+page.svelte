<script>
  import Cube from "$lib/fx/Cube.svelte";
  import { loadPlan, plan } from "$lib/pro/plan.svelte.js";
  import Pick from "$lib/ui/Pick.svelte";
  import { ask, askText } from "$lib/ui/confirm.svelte.js";
  import { live } from "$lib/live.js";
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";
  import Papa from "papaparse";
  import { api } from "$lib/api.js";
  import { when } from "$lib/docs.js";
  import { t } from "$lib/i18n/index.svelte.js";
  import Rich from "$lib/i18n/Rich.svelte";
  import { rememberStarter, clearStarter } from "$lib/starter.js";
  import { toast } from "$lib/ui/toast.js";
  import ProLock from "$lib/pro/ProLock.svelte";
  import TemplateUsage from "$lib/pro/TemplateUsage.svelte";
  import NewTemplateLock from "$lib/pro/NewTemplateLock.svelte";
  import LibraryList from "$lib/templates/LibraryList.svelte";
  import PageHeader from "$lib/ui/PageHeader.svelte"; import Tabs from "$lib/ui/Tabs.svelte"; import Thumbnail from "$lib/ui/Thumbnail.svelte";
  // Docustay v1: one list of templates (the former form templates are ordinary templates). The workspace's own, then the built-in ones (LibraryList): send one as it is, or customize a copy.
  let data = $state(null), problem = $state(null), q = $state(""), retired = $state(false), note = $state(null), busy = $state(false);
  // bulk
  let bulkOpen = $state(false), tpls = $state([]), templateId = $state(""), rows = $state([]), fileName = $state(null), check = $state(null), done = $state(null), bulkProblem = $state(null);
  // R8-41: pressing Send a second time sent the whole list again (J2: 3 rows → 6 documents). Each checked list gets ONE key; every batch of the send carries it, so a second press, a
  //   double click or a retry after a lost answer is replayed by the server, never sent twice. A new Check (a new file or template) is a new list and may be sent.
  let sendKey = null;
  const BATCH = 25;
  async function load() { const r = await api(`/api/documents/pdf/templates?q=${encodeURIComponent(q)}&retired=${retired}`); if (r.ok) data = r.json; else problem = r.error ?? t("Templates could not be loaded."); }
  // A built-in picked on the website (or an old ready-made link) arrives here as ?starter=… : its row in the built-in list is shown and marked, to send or customize.
  let highlight = $state(null), tab = $state(""), libCount = $state(null);
  onMount(async () => {
    const pending = rememberStarter();
    if (pending) { clearStarter(); highlight = pending; }
    await load();
    tab = highlight || !data?.templates?.length ? "built-in" : "yours";
    if (new URLSearchParams(location.search).get("bulk") === "1") await openBulk();
  });
  let timer;
  const reload = () => { clearTimeout(timer); timer = setTimeout(load, 250); };
  async function use(tp) { if (tp.editable) { await goto(`/create/flow?mode=document&template=${encodeURIComponent(tp.id)}`); return; } busy = true; note = null; const r = await api("/api/documents/pdf/from-template", { method: "POST", body: { templateId: tp.id } }); busy = false; if (r.ok) await goto(`/documents/${r.json.instanceId}/edit?from=template`); else if (!(await handleRefusal(r, { action: "send_document" }))) note = r.error ?? t("That template could not be used."); }
  async function retire(tp) { if (!await ask(t("Retire “{name}”? It stops being offered; documents already sent are not affected.", { name: tp.name }))) return; const r = await api("/api/documents/pdf/templates/retire", { method: "POST", body: { templateId: tp.id } }); note = r.ok ? t("Retired.") : (r.error ?? t("That did not work.")); await load(); }
  async function approve(tp) { note = null; const r = await api("/api/documents/pdf/templates/approve", { method: "POST", body: { templateId: tp.id } }); note = r.ok ? t("Approved.") : (r.error ?? t("That did not work.")); await load(); }
  async function reject(tp) { const reason = await askText(t("Why is this template being rejected?"), { yes: t("Reject"), required: true }); if (reason === null) return; note = null; const r = await api("/api/documents/pdf/templates/reject", { method: "POST", body: { templateId: tp.id, reason } }); note = r.ok ? t("Rejected.") : (r.error ?? t("That did not work.")); await load(); }
  async function openBulk() { bulkOpen = true; const r = await api("/api/documents/pdf/kiosk-templates"); tpls = r.ok ? (r.json.templates ?? []) : [];
    // Only document templates (one signer) belong here: drop the form templates the kiosk list also carries.
    const dr = await api("/api/documents/pdf/templates?q=&retired=false"); const dj = dr.ok ? dr.json : null; const docIds = new Set((dj?.templates ?? dj?.items ?? dj?.data ?? []).map((x) => x.id)); if (dr.ok && docIds.size) tpls = tpls.filter((x) => docIds.has(x.id)); else if (dr.ok) tpls = []; templateId = tpls[0]?.id ?? ""; }
  function onFile(file) { if (!file) return; fileName = file.name; check = null; done = null; bulkProblem = null; Papa.parse(file, { header: true, skipEmptyLines: true, complete: (r) => { if (!r.data.length) bulkProblem = t("That file has no rows."); rows = r.data.slice(0, 1000); }, error: () => (bulkProblem = t("That file could not be read as a spreadsheet (CSV).")) }); }
  // v1 item 23: one confirmation with the total before a list goes out; Free sends to at most 15 at a time
  import { plan as planStore } from "$lib/pro/plan.svelte.js";
  import { usd } from "$lib/pro/money.js";
  import PlanPrompt from "$lib/pro/PlanPrompt.svelte";
  import { askPreflight, showPlanSheet, handleRefusal } from "$lib/pro/planPrompt.svelte.js";
  let est = $state(null), confirmBulk = $state(false);
  const bulkCap = $derived(planStore.data?.plans?.find((p) => p.key === planStore.data?.plan?.key)?.bulkCap ?? null);
  async function loadEstimate(n) { const r = await api("/api/product/docustay/estimate", { method: "POST", body: { documents: n } }); est = r.ok ? (r.json?.data ?? r.json) : null; confirmBulk = false; }
  function sendClick() { if (est?.needsConfirm && !confirmBulk) { confirmBulk = true; return; } run(false); }
  async function run(dryRun) {
    if (dryRun && bulkCap != null && rows.length > bulkCap) {   // the plan sheet says where you stand and what each option gives; the plain line is only the fallback
      const a = await askPreflight("bulk_send", { documents: rows.length }); if (a && a.allowed === false) { showPlanSheet(a); return; }
      bulkProblem = t("Your plan sends to at most {n} people from one list. Switch to Pay as you go or Pro to send to more.", { n: bulkCap }); return; }
    busy = true; bulkProblem = null;
    try { const results = []; let offset = 0;
      for (let i = 0; i < rows.length; i += BATCH) { const part = rows.slice(i, i + BATCH); const r = await api("/api/documents/pdf/bulk", { method: "POST", body: { templateId, rows: part, dryRun }, ...(dryRun ? {} : { key: `bulk-${sendKey}-${i}` }) }); if (!r.ok) { if (await handleRefusal(r, { action: "bulk_send", size: { documents: rows.length } })) return; throw new Error(r.error ?? t("Something went wrong.")); } results.push(...r.json.results.map((x) => ({ ...x, row: x.row + offset }))); offset += part.length; }
      const s = { sent: results.filter((x) => x.ok).length, failed: results.filter((x) => !x.ok).length, notEmailed: results.filter((x) => x.ok && x.notEmailed).length, results }; if (dryRun) { check = s; done = null; sendKey = crypto.randomUUID(); await loadEstimate(s.sent); } else done = s;
    } catch (e) { bulkProblem = e.message; } finally { busy = false; }
  }
  let onFree = $state(false);   // the Pro sentence is for Free workspaces only
  onMount(async () => { await loadPlan(); onFree = plan.data?.billing?.canUpgrade === true; });   // the one shared plan read, not a second request for the same answer
  onMount(() => live(["templates"], load));
</script>
<svelte:head><title>{t("Templates")} · Docustay</title></svelte:head>
<PageHeader title={t("Templates")}>
  {#snippet filters()}<input class="field !w-44 sm:!w-60" placeholder={t("Search templates")} bind:value={q} oninput={reload} aria-label={t("Search templates")} />{/snippet}
  {#snippet actions()}<ProLock item="bulk_send" tip={t("Send one template to a list of people from a spreadsheet, one document each.")}>{#snippet children(locked)}<button class="btn" disabled={locked} onclick={openBulk} data-testid="tp-bulk">{t("Send to a list")}</button>{/snippet}</ProLock><NewTemplateLock>{#snippet children(locked)}<a href="/create?mode=template" class="btn primary" aria-disabled={locked ? "true" : undefined} data-testid="tp-new">{t("New template")}</a>{/snippet}</NewTemplateLock>{/snippet}
</PageHeader>
<p class="max-w-2xl text-[13px] text-mute" data-testid="tp-lead">{t("A document template is a document you set up once — its pages, where people sign, who signs — and send to the people you name as often as you like.")}</p>
<div class="mt-1 text-[12.5px] text-mute empty:hidden"><TemplateUsage /></div>
<PlanPrompt action="create_template" id="tpl" kinds={["blocked", "soft"]} class="mt-3" />
{#if problem}<p class="mt-4 text-bad" role="alert">{problem}</p>{:else if !data}<div class="mt-5 grid gap-2" aria-busy="true" role="status" data-testid="tp-loading">{#each [0, 1, 2] as i (i)}<div class="skel h-10 rounded"></div>{/each}<span class="sr-only">{t("Loading…")}</span></div>
{:else}
  <Tabs class="mt-4" label={t("Templates")} testid="tp-tabs" bind:value={tab} items={[{ value: "built-in", label: t("Built-in"), count: libCount }, { value: "yours", label: t("Yours"), count: data.templates.length }]}>
    {#snippet panel(v)}
      {#if v === "built-in"}<div class="pt-4"><LibraryList {q} {highlight} onloaded={(n) => (libCount = n)} /></div>
      {:else if data.templates.length === 0}<div class="pt-8 text-center" data-testid="tp-empty-document"><p class="text-[15px] font-medium">{t("No document templates yet")}</p><p class="mx-auto mt-1 max-w-md text-[13px] text-mute">{t("Customize a built-in template below, upload a file, write it or describe it.")}</p><span class="mt-4 inline-flex"><NewTemplateLock testid="prolock-new-template-empty">{#snippet children(locked)}<a href="/create?mode=template" class="btn primary" aria-disabled={locked ? "true" : undefined} data-testid="tp-empty-new">{t("New document template")}</a>{/snippet}</NewTemplateLock></span></div>
      {:else}
        <label class="mt-1 flex w-fit items-center gap-1.5 text-[13px] text-mute"><input type="checkbox" bind:checked={retired} onchange={reload} /> {t("Include retired")}</label>
        <div class="rows mt-1" role="table" aria-label={t("Your templates")} data-testid="tp-table">
          <div class="rows-head tp-cols hidden sm:grid" role="row"><span role="columnheader">{t("Template")}</span><span role="columnheader">{t("Version")}</span><span role="columnheader">{t("Updated")}</span><span role="columnheader" class="sr-only">{t("Actions")}</span></div>
          {#each data.templates as tp (tp.id)}
            <div class="rows-row tall tp-cols" role="row" data-testid="tpl-row">
              <span class="flex min-w-0 items-center gap-3" role="cell"><Thumbnail width={28} kind="draft" /><span class="min-w-0 truncate text-[13px] font-medium">{tp.name}{#if !tp.active}<span class="ml-2 text-[12px] font-normal text-mute">({t("retired")})</span>{/if}</span></span>
              <span class="hidden text-[13px] text-mute sm:block" role="cell">v{tp.version ?? 1}</span>
              <span class="hidden whitespace-nowrap text-[13px] text-mute sm:block" role="cell">{when(tp.updated_at ?? tp.created_at)}</span>
              <span class="flex flex-wrap items-center justify-end gap-2" role="cell">{#if tp.approval_status === "pending"}<span class="chip" data-testid="tpl-pending">{t("Waiting for approval")}</span>{#if data.can?.approve !== false}<button class="btn primary" onclick={() => approve(tp)} data-testid="tpl-approve">{t("Approve")}</button><button class="btn" onclick={() => reject(tp)} data-testid="tpl-reject">{t("Reject")}</button>{/if}{:else if tp.approval_status === "rejected"}<span class="chip warn" data-testid="tpl-rejected">{t("Rejected")}</span>{#if tp.approval_note}<span class="text-[12px] text-mute" data-testid="tpl-reject-reason">{t("Reason: {why}", { why: tp.approval_note })}</span>{/if}{#if data.can?.retire !== false}<button class="btn" onclick={() => retire(tp)}>{t("Retire")}</button>{/if}{:else if tp.active}<button class="btn" disabled={busy} onclick={() => use(tp)} data-testid="tpl-use">{t("Use")}</button>{#if tp.editable && data.can?.retire !== false}<a class="btn" href={`/create/flow?mode=template&template=${tp.id}`} data-testid="tpl-edit">{t("Edit")}</a>{/if}{#if data.can?.retire !== false}<button class="btn" onclick={() => retire(tp)}>{t("Retire")}</button>{/if}{/if}</span>
            </div>
          {/each}
        </div>
      {/if}
    {/snippet}
  </Tabs>
{/if}
{#if note}<p class="mt-3 text-[13px]" role="status">{note}</p>{/if}
{#if bulkOpen}
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label={t("Send to a list")}><div class="max-h-[90vh] w-full max-w-2xl overflow-auto rounded-2xl bg-card p-6">
    <div class="flex items-center"><h2 class="text-xl font-semibold">{t("Send to a list")}</h2><button class="btn ml-auto !py-1" onclick={() => (bulkOpen = false)}>{t("Close")}</button></div>
    <p class="mt-1 text-sm text-mute"><Rich text={t("Pick a template with one signer, add a spreadsheet (CSV) with <code>name</code> and <code>email</code> columns, check the list, send. Each row becomes its own document. A box you fill in as the sender takes the column named after it, such as <code>event_name</code> for “Event name”.")} parts={{ code: { code: true } }} /></p>
    {#if tpls.length === 0}<p class="mt-4 text-sm">{t("You need a saved template with exactly one signer first.")}</p>{:else}
      <div class="mt-4 space-y-3"><Pick options={tpls.map((tp) => ({ value: tp.id, label: tp.name }))} value={templateId} onchange={(v) => { templateId = v; check = null; done = null; sendKey = null; }} label={t("Template")} testid="bulk-template" />
        <label class="btn w-fit cursor-pointer" data-testid="bulk-file"><input class="sr-only" type="file" accept=".csv,text/csv" onchange={(e) => onFile(e.currentTarget.files?.[0])} aria-label={t("CSV file")} />{fileName ? t("Choose another file") : t("Choose a CSV file")}</label>{#if fileName}<p class="text-sm text-mute">{fileName} — {t("{n, plural, one {# row} other {# rows}}", { n: rows.length })}</p>{/if}
        {#if rows.length}<PlanPrompt action="bulk_send" size={{ documents: rows.length }} watch={rows.length} id="bulk" />{/if}
        <div class="flex gap-2"><button class="btn" disabled={busy || !rows.length} onclick={() => run(true)}>{t("Check the list")}</button><button class="btn primary" disabled={busy || !check || check.sent === 0 || Boolean(done)} onclick={sendClick} data-testid="bulk-send">{done ? t("Sent") : confirmBulk ? (est?.amountMinor > 0 ? t("Confirm: send to {n}, {price}", { n: check.sent, price: usd(est.amountMinor) }) : t("Confirm: send to {n}", { n: check.sent })) : est?.amountMinor > 0 ? t("Send to {n}, {price}", { n: check ? check.sent : rows.length, price: usd(est.amountMinor) }) : t("Send to {n}", { n: check ? check.sent : rows.length })}</button></div>
        {#if check && est && !done}<p class="text-sm text-mute" data-testid="bulk-total">{est.billableUnits > 0 ? t("{n} of these are past your included documents at {each} each: {total} in all.", { n: est.billableUnits, each: usd(est.perDocumentMinor), total: usd(est.amountMinor) }) : t("All of these fit your included documents this month: no charge.")} {t("A document counts when it is sent.")}{#if !est.withinBudget} <strong class="text-bad">{t("This would pass your monthly budget. Raise it in Billing first.")}</strong>{/if}</p>{/if}
        {#if check}<p class="text-sm" role="status">{check.failed ? t("{n, plural, one {# row needs fixing:} other {# rows need fixing:}}", { n: check.failed }) : t("All {n} rows look right.", { n: check.sent })}</p>{#if check.failed}<ul class="text-sm text-bad">{#each check.results.filter((x) => !x.ok) as x}<li>{t("Row {n}: {reason}", { n: x.row + 1, reason: x.error ?? x.reason ?? t("not accepted") })}</li>{/each}</ul>{/if}{/if}
        {#if busy}<Cube after={2000} label={t("Working through the list…")} testid="bulk-cube" />{/if}
        {#if done}<p class="text-sm" role="status">{done.failed ? t("Sent {sent}, {failed} failed.", { sent: done.sent, failed: done.failed }) : t("Sent {sent}.", { sent: done.sent })}</p>{#if done.failed}<ul class="text-sm text-bad" data-testid="bulk-failed">{#each done.results.filter((x) => !x.ok) as x}<li>{t("Row {n}: {reason}", { n: x.row + 1, reason: x.error ?? x.reason ?? t("not accepted") })}</li>{/each}</ul>{/if}{#if done.notEmailed}<p class="notice warn mt-2 text-sm" role="status" data-testid="bulk-not-emailed">{t("{n, plural, one {# person was not emailed: today's email limit was reached. Send them a reminder after midnight UTC.} other {# people were not emailed: today's email limit was reached. Send them a reminder after midnight UTC.}}", { n: done.notEmailed })}</p>{/if}{/if}
        {#if bulkProblem}<p class="text-sm text-bad" role="alert">{bulkProblem}</p>{/if}</div>{/if}
  </div></div>
{/if}
<style>
  .tp-cols { grid-template-columns: minmax(0, 1fr); row-gap: .4rem; }
  @media (min-width: 640px) { .tp-cols { grid-template-columns: minmax(0, 1fr) 56px 150px 220px; column-gap: 1rem; } }
</style>
