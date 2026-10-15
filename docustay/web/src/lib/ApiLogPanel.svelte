<script>
  import { live } from "$lib/live.js";
  // Settings → Developers → API log: every authenticated call a key made, newest first (30 days). Filter by result, method, route or a request id (the id in an error body finds the call).
  import { onMount } from "svelte";
  import { api } from "$lib/api.js";
  import { t } from "$lib/i18n/index.svelte.js";
  import DataTable from "$lib/ui/DataTable.svelte";
  import FilterSelect from "$lib/ui/FilterSelect.svelte";
  import StatusChip from "$lib/ui/StatusChip.svelte";
  import RelativeTime from "$lib/ui/RelativeTime.svelte";
  import EmptyState from "$lib/ui/EmptyState.svelte";
  import StatTile from "$lib/ui/StatTile.svelte";
  import Bars from "$lib/ui/Bars.svelte";
  let calls = $state(null), next = $state(null), problem = $state(null), busy = $state(false), days = $state(30);
  let status = $state(""), method = $state(""), path = $state(""), requestId = $state("");
  const query = (cursor) => { const q = new URLSearchParams({ limit: "50" }); if (status) q.set("status", status); if (method) q.set("method", method); if (path.trim()) q.set("path", path.trim()); if (requestId.trim()) q.set("requestId", requestId.trim()); if (cursor) q.set("cursor", cursor); return q.toString(); };
  async function load(more = false) {
    busy = true; problem = null;
    const r = await api(`/api/product/docustay/api-calls?${query(more ? next : null)}`); busy = false;
    if (!r.ok) { problem = r.error ?? t("The API log could not be loaded."); if (!more) calls = []; return; }
    calls = more ? [...(calls ?? []), ...r.json.calls] : r.json.calls; next = r.json.nextCursor; days = r.json.retentionDays ?? 30;
  }
  let usage = $state(null), range = $state("7");
  async function loadUsage() { const r = await api(`/api/product/docustay/api-usage?days=${range}`); usage = r.ok ? r.json : null; }
  onMount(() => { load(); return live(["apilog"], () => load()); });
  $effect(() => { range; loadUsage(); });
  const tone = (s) => (s >= 500 ? "bad" : s >= 400 ? "warn" : "ok");
  const columns = [{ key: "at", label: t("When") }, { key: "key", label: t("Key") }, { key: "method", label: t("Method") }, { key: "path", label: t("Route") }, { key: "status", label: t("Result") }, { key: "ms", label: t("Time"), align: "right" }];
  const statuses = [{ value: "", label: t("All results") }, { value: "2xx", label: t("Succeeded (2xx)") }, { value: "4xx", label: t("Refused (4xx)") }, { value: "5xx", label: t("Failed (5xx)") }, { value: "errors", label: t("Any error") }];
  const methods = [{ value: "", label: t("All methods") }, ...["GET", "POST", "PUT", "PATCH", "DELETE"].map((m) => ({ value: m, label: m }))];
</script>
<div class="max-w-5xl space-y-4" data-testid="api-log">
  <div>
    <h2 class="text-lg font-semibold">{t("API log")}</h2>
    <p class="text-sm text-mute">{t("Every call your API keys made, newest first. Kept {days} days. It records the route and the result, never what was sent.", { days })}</p>
    <p class="text-xs text-mute">{t("Calls made with a wrong, revoked or expired key are not listed, because no workspace can be named for them.")}</p>
  </div>
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
  {#if problem}<p class="text-sm text-bad" role="alert">{problem}</p>{/if}
  {#if calls === null}<p class="text-sm text-mute">{t("Loading…")}</p>
  {:else}
    <DataTable {columns} rows={calls} testid="log-table" caption={t("API calls")}>
      {#snippet cell(r, c)}
        {#if c.key === "at"}<RelativeTime value={r.at} class="text-mute" />
        {:else if c.key === "key"}<span title={r.keyId ?? ""}>{r.keyName ?? (r.keyId ? `…${r.keyId.slice(-6)}` : "—")}</span>
        {:else if c.key === "method"}<span class="font-mono text-xs">{r.method}</span>
        {:else if c.key === "path"}<span class="font-mono text-xs" title={r.requestId ?? ""}>{r.path}</span>
        {:else if c.key === "status"}<StatusChip tone={tone(r.status)}>{r.status}</StatusChip>{#if r.reason === "address_not_allowed"} <span class="ml-2 text-xs text-mute" data-testid="log-reason">{t("Address not on the key's list")}</span>{/if}
        {:else}<span class="font-mono text-xs text-mute">{r.durationMs} ms</span>{/if}
      {/snippet}
      {#snippet empty()}<EmptyState title={t("No calls yet")} line={t("Calls made with an API key show up here as they happen.")} />{/snippet}
    </DataTable>
    {#if next}<button class="btn" onclick={() => load(true)} disabled={busy} data-testid="log-more">{t("Load more")}</button>{/if}
  {/if}
</div>
