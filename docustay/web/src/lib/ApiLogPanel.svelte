<script>
  import { live } from "$lib/live.js";
  // Settings → Developers → API log: every authenticated call a key made, newest first (30 days). Filter by result, method, route or a request id (the id in an error body finds the call).
  import { onMount } from "svelte";
  import { api } from "$lib/api.js";
  import { t } from "$lib/i18n/index.svelte.js";
  import { toast } from "$lib/ui/toast.js";
  import DataTable from "$lib/ui/DataTable.svelte";
  import FilterSelect from "$lib/ui/FilterSelect.svelte";
  import StatusChip from "$lib/ui/StatusChip.svelte";
  import RelativeTime from "$lib/ui/RelativeTime.svelte";
  import EmptyState from "$lib/ui/EmptyState.svelte";
  import StatTile from "$lib/ui/StatTile.svelte";
  import CursorPager from "$lib/ui/CursorPager.svelte";
  import Bars from "$lib/ui/Bars.svelte";
  let calls = $state(null), next = $state(null), problem = $state(null), busy = $state(false), days = $state(30), page = $state(1), per = $state(50), cursors = [null];   // cursors[n - 1] opens page n
  let status = $state(""), method = $state(""), path = $state(""), requestId = $state("");
  const query = (cursor) => { const q = new URLSearchParams({ limit: String(per) }); if (status) q.set("status", status); if (method) q.set("method", method); if (path.trim()) q.set("path", path.trim()); if (requestId.trim()) q.set("requestId", requestId.trim()); if (cursor) q.set("cursor", cursor); return q; };
  /** Open page n (1 by default: a new search, a new page size or a live update starts again from the newest calls). */
  async function load(n = 1) {
    busy = true; problem = null;
    if (n === 1) cursors = [null];
    const r = await api(`/api/product/docustay/api-calls?${query(cursors[n - 1] ?? null)}`); busy = false;
    if (!r.ok) { problem = r.error ?? t("The API log could not be loaded."); if (n === 1) calls = []; return; }
    calls = r.json.calls; next = r.json.nextCursor; page = n; cursors[n] = r.json.nextCursor; days = r.json.retentionDays ?? 30;
  }
  let usage = $state(null), usageFailed = $state(null), range = $state("7");
  async function loadUsage() { const r = await api(`/api/product/docustay/api-usage?days=${range}`); usageFailed = r.ok ? null : (r.error ?? t("Usage could not be loaded.")); usage = r.ok ? r.json : null; }   // R13-D448: a failed read is not "no usage"
  onMount(() => { load(); return live(["apilog"], () => { if (page === 1) load(1); }); });   // a new call only moves the list while the newest page is on screen
  $effect(() => { range; loadUsage(); });
  // R13-D086: open one call for its detail, and take the page of calls away as a CSV file or as text to paste
  let sel = $state(null);
  const csvCell = (v) => { const x = String(v ?? ""); return /[",\n]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x; };
  const csvText = () => ["when,key,method,route,result,duration_ms,request_id", ...(calls ?? []).map((r) => [r.at, r.keyName ?? r.keyId ?? "", r.method, r.path, r.status, r.durationMs, r.requestId ?? ""].map(csvCell).join(","))].join("\n");
  function downloadCsv() { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csvText()], { type: "text/csv" })); a.download = "api-log.csv"; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); }
  async function copyCsv() { try { await navigator.clipboard.writeText(csvText()); toast(t("Copied."), "ok"); } catch { toast(t("It could not be copied here. Use Download CSV."), "bad"); } }
  const tone = (s) => (s >= 500 ? "bad" : s >= 400 ? "warn" : "ok");
  const columns = [{ key: "at", label: t("When") }, { key: "key", label: t("Key") }, { key: "method", label: t("Method") }, { key: "path", label: t("Route") }, { key: "status", label: t("Result") }, { key: "ms", label: t("Time"), align: "right" }];
  const statuses = [{ value: "", label: t("All results") }, { value: "2xx", label: t("Succeeded (2xx)") }, { value: "4xx", label: t("Refused (4xx)") }, { value: "5xx", label: t("Failed (5xx)") }, { value: "errors", label: t("Any error") }];
  const methods = [{ value: "", label: t("All methods") }, ...["GET", "POST", "PUT", "PATCH", "DELETE"].map((m) => ({ value: m, label: m }))];
</script>
<div class=" space-y-4" data-testid="api-log">
  <div>
    <h2 class="text-lg font-semibold">{t("API log")}</h2>
    <p class="text-sm text-mute">{t("Every call your API keys made, newest first. Kept {days} days. It records the route and the result, never what was sent.", { days })}</p>
    <p class="text-xs text-mute">{t("Calls made with a wrong, revoked or expired key are not listed, because no workspace can be named for them.")}</p>
  </div>
  {#if usageFailed}<p class="text-sm text-bad" role="alert" data-testid="api-usage-failed">{usageFailed} <button class="btn quiet" onclick={loadUsage}>{t("Try again")}</button></p>{/if}
  {#if usage}
    <section class="space-y-3" data-testid="api-usage" aria-label={t("Usage")}>
      <div class="flex items-center gap-2"><h3 class="text-sm font-semibold">{t("Usage")}</h3>
        <FilterSelect options={[{ value: "1", label: t("Last 24 hours") }, { value: "7", label: t("Last 7 days") }, { value: "30", label: t("Last 30 days") }]} bind:value={range} label={t("Period")} testid="usage-range" /></div>
      <div class="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatTile label={t("Calls")} value={usage.calls} />
        <StatTile label={t("Errors")} value={usage.errors} tone={usage.errors ? "bad" : ""} delta={usage.calls ? `${((usage.errors / usage.calls) * 100).toFixed(1)}%` : ""} />
        <StatTile label={t("Median")} value={usage.p50Ms} suffix=" ms" />
        <StatTile label={t("Slowest 5%")} value={usage.p95Ms} suffix=" ms" />
      </div>
      {#if usage.byDay.length}<Bars data={usage.byDay.map((d) => ({ label: d.day, value: d.calls }))} label={t("Calls per day")} />{/if}
      {#if usage.byKey.length}<ul class="text-sm" data-testid="usage-keys">{#each usage.byKey as k (k.keyId)}<li class="flex justify-between border-t border-line py-1"><span>{k.name ?? `…${String(k.keyId).slice(-6)}`}</span><span class="font-mono text-xs text-mute">{k.calls} · {k.errors} {t("errors")}</span></li>{/each}</ul>{/if}
    </section>
  {/if}
  <form class="flex flex-wrap items-end gap-2" onsubmit={(e) => { e.preventDefault(); load(); }}>
    <FilterSelect options={statuses} bind:value={status} label={t("Result")} testid="log-status" />
    <FilterSelect options={methods} bind:value={method} label={t("Method")} testid="log-method" />
    <input class="field w-56" placeholder={t("Route contains…")} bind:value={path} aria-label={t("Route contains")} data-testid="log-path" />
    <input class="field w-64 font-mono" placeholder={t("Request id")} bind:value={requestId} aria-label={t("Request id")} data-testid="log-request" />
    <button class="btn" type="submit" disabled={busy} data-testid="log-apply">{t("Search")}</button>
  </form>
  {#if problem}<p class="text-sm text-bad" role="alert" data-testid="api-log-failed">{problem} <button class="btn quiet" onclick={() => load(page)}>{t("Try again")}</button></p>{/if}   <!-- R13-D448: a failed read is not "No calls yet" -->
  {#if calls === null}<p class="text-sm text-mute">{t("Loading…")}</p>
  {:else}
    <DataTable {columns} rows={calls} testid="log-table" caption={t("API calls")}>
      {#snippet cell(r, c)}
        {#if c.key === "at"}<RelativeTime value={r.at} class="text-mute" />
        {:else if c.key === "key"}<span title={r.keyId ?? ""}>{r.keyName ?? (r.keyId ? `…${r.keyId.slice(-6)}` : "—")}</span>
        {:else if c.key === "method"}<span class="font-mono text-xs">{r.method}</span>
        {:else if c.key === "path"}<button class="inline-flex min-h-6 items-center font-mono text-xs underline decoration-dotted" onclick={() => (sel = sel?.requestId === r.requestId && sel?.at === r.at ? null : r)} title={r.requestId ?? ""} data-testid="log-detail-open" aria-expanded={sel === r}>{r.path}</button>
        {:else if c.key === "status"}<StatusChip tone={tone(r.status)}>{r.status}</StatusChip>{#if r.reason === "address_not_allowed"} <span class="ml-2 text-xs text-mute" data-testid="log-reason">{t("Address not on the key's list")}</span>{/if}
        {:else}<span class="font-mono text-xs text-mute">{r.durationMs} ms</span>{/if}
      {/snippet}
      {#snippet empty()}{#if problem}{:else}<EmptyState title={t("No calls yet")} line={t("Calls made with an API key show up here as they happen.")} />{/if}{/snippet}
    </DataTable>
    {#if sel}<div class="rounded-xl border border-line bg-card p-4 text-sm" data-testid="log-detail"><div class="flex items-center justify-between gap-3"><h3 class="font-mono text-[15px] font-medium">{sel.method} {sel.path}</h3><button class="btn quiet" onclick={() => (sel = null)}>{t("Close")}</button></div>
      <dl class="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4"><div><dt class="font-mono text-[.7rem] uppercase tracking-wider text-faint">{t("When")}</dt><dd class="mt-1 text-[13px]">{new Date(sel.at).toLocaleString()}</dd></div><div><dt class="font-mono text-[.7rem] uppercase tracking-wider text-faint">{t("Key")}</dt><dd class="mt-1 text-[13px]">{sel.keyName ?? sel.keyId ?? "—"}</dd></div><div><dt class="font-mono text-[.7rem] uppercase tracking-wider text-faint">{t("Result")}</dt><dd class="mt-1 text-[13px]">{sel.status}{#if sel.reason} · {sel.reason}{/if}</dd></div><div><dt class="font-mono text-[.7rem] uppercase tracking-wider text-faint">{t("Time")}</dt><dd class="mt-1 text-[13px]">{sel.durationMs} ms</dd></div></dl>
      <p class="mt-3 text-xs text-mute">{t("Request id")}: <span class="font-mono">{sel.requestId ?? "—"}</span></p></div>{/if}
    {#if calls?.length}<div class="flex gap-2"><button class="btn" onclick={downloadCsv} data-testid="log-download">{t("Download CSV")}</button><button class="btn" onclick={copyCsv} data-testid="log-copy">{t("Copy")}</button></div>{/if}
    <CursorPager {page} {per} hasNext={!!next} {busy} onprev={() => load(page - 1)} onnext={() => load(page + 1)} onsize={(n) => { per = n; load(1); }} testid="log-pager" />
  {/if}
</div>
