<script>
  // D-023: Developers → Usage report on the hosted service: what your keys did over the last days (calls, errors, how fast, per day, per key, busiest routes). Same numbers as the API log, summed.
  import { onMount } from "svelte";
  import { api } from "$lib/api.js";
  import { t } from "$lib/i18n/index.svelte.js";
  import StatTile from "$lib/ui/StatTile.svelte";
  import DataTable from "$lib/ui/DataTable.svelte";
  let days = $state(7), u = $state(null), problem = $state(null);
  async function load() { problem = null; const r = await api(`/api/product/docustay/api-usage?days=${days}`); if (r.ok) u = r.json?.data ?? r.json; else problem = r.error ?? t("Usage could not be loaded."); }
  onMount(load);
  const KEYCOLS = [{ key: "name", label: t("Key") }, { key: "calls", label: t("Calls"), align: "right" }, { key: "errors", label: t("Errors"), align: "right" }];
  const ROUTECOLS = [{ key: "route", label: t("Route") }, { key: "calls", label: t("Calls"), align: "right" }, { key: "errors", label: t("Errors"), align: "right" }];
</script>
<div class="max-w-3xl space-y-5">
  <div class="flex flex-wrap items-center justify-between gap-3"><h2 class="text-lg font-semibold">{t("Usage report")}</h2>
    <select class="field !w-auto !py-1" bind:value={days} onchange={load} aria-label={t("Usage report")} data-testid="usage-days">{#each [7, 14, 30] as n}<option value={n}>{t("{n, plural, one {# day} other {# days}}", { n })}</option>{/each}</select></div>
  {#if problem}<p class="text-sm text-bad" role="alert">{problem}</p>
  {:else if !u}<p class="text-sm text-mute">{t("Loading…")}</p>
  {:else}
    <div class="grid gap-6 sm:grid-cols-4" data-testid="api-usage-totals"><StatTile label={t("Calls")} value={u.calls} /><StatTile label={t("Errors")} value={u.errors} tone={u.errors ? "bad" : ""} /><StatTile label={t("Typical speed")} value={`${u.p50Ms} ms`} /><StatTile label={t("Slowest 5%")} value={`${u.p95Ms} ms`} /></div>
    {#if u.calls === 0}<p class="text-sm text-mute">{t("Your keys have not made a call in this time.")}</p>
    {:else}
      <DataTable columns={KEYCOLS} rows={(u.byKey ?? []).map((k, i) => ({ id: k.keyId ?? `k${i}`, name: k.name ?? "—", calls: k.calls, errors: k.errors }))} caption={t("By key")} testid="api-usage-keys" />
      <DataTable columns={ROUTECOLS} rows={(u.byRoute ?? []).map((r, i) => ({ id: `r${i}`, route: `${r.method} ${r.path}`, calls: r.calls, errors: r.errors }))} caption={t("Busiest routes")} testid="api-usage-routes" />
    {/if}
  {/if}
</div>
