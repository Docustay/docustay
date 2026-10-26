<script>
  // D-023: Developers → Usage report on the hosted service: what your keys did over the last days (calls, errors, how fast, per day, per key, busiest routes). Same numbers as the API log, summed.
  import { onMount } from "svelte";
  import { api } from "$lib/api.js";
  import { t } from "$lib/i18n/index.svelte.js";
  import StatTile from "$lib/ui/StatTile.svelte";
  import DataTable from "$lib/ui/DataTable.svelte";
  import { toast } from "$lib/ui/toast.js";
  let days = $state(7), u = $state(null), problem = $state(null), sel = $state(null);   // R13-D086: sel = the key or route opened for detail
  async function load() { problem = null; const r = await api(`/api/product/docustay/api-usage?days=${days}`); if (r.ok) u = r.json?.data ?? r.json; else problem = r.error ?? t("Usage could not be loaded."); }
  onMount(load);
  // R13-D086: the report as a CSV file or as text to paste
  const cell = (v) => { const x = String(v ?? ""); return /[",\n]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x; };
  const csv = () => ["kind,name,calls,errors", ...(u?.byKey ?? []).map((k) => ["key", k.name ?? k.keyId, k.calls, k.errors].map(cell).join(",")), ...(u?.byRoute ?? []).map((r) => ["route", `${r.method} ${r.path}`, r.calls, r.errors].map(cell).join(","))].join("\n");
  function download() { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv()], { type: "text/csv" })); a.download = `api-usage-${days}d.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); }
  async function copy() { try { await navigator.clipboard.writeText(csv()); toast(t("Copied."), "ok"); } catch { toast(t("It could not be copied here. Use Download CSV."), "bad"); } }
  const KEYCOLS = [{ key: "name", label: t("Key") }, { key: "calls", label: t("Calls"), align: "right" }, { key: "errors", label: t("Errors"), align: "right" }];
  const ROUTECOLS = [{ key: "route", label: t("Route") }, { key: "calls", label: t("Calls"), align: "right" }, { key: "errors", label: t("Errors"), align: "right" }];
</script>
<div class=" space-y-5">
  <div class="flex flex-wrap items-center justify-between gap-3"><h2 class="text-lg font-semibold">{t("Usage report")}</h2>
    <select class="field !w-auto !py-1" bind:value={days} onchange={load} aria-label={t("Usage report")} data-testid="usage-days">{#each [7, 14, 30] as n}<option value={n}>{t("{n, plural, one {# day} other {# days}}", { n })}</option>{/each}</select></div>
  {#if problem}<p class="text-sm text-bad" role="alert" data-testid="usage-failed">{problem} <button class="btn quiet" onclick={load}>{t("Try again")}</button></p>
  {:else if !u}<p class="text-sm text-mute">{t("Loading…")}</p>
  {:else}
    <div class="grid gap-6 sm:grid-cols-4" data-testid="api-usage-totals"><StatTile label={t("Calls")} value={u.calls} /><StatTile label={t("Errors")} value={u.errors} tone={u.errors ? "bad" : ""} /><StatTile label={t("Typical speed")} value={`${u.p50Ms} ms`} /><StatTile label={t("Slowest 5%")} value={`${u.p95Ms} ms`} /></div>
    {#if u.calls > 0}<div class="flex gap-2"><button class="btn" onclick={download} data-testid="usage-download">{t("Download CSV")}</button><button class="btn" onclick={copy} data-testid="usage-copy">{t("Copy")}</button></div>{/if}
    {#if u.calls === 0}<p class="text-sm text-mute">{t("Your keys have not made a call in this time.")}</p>
    {:else}
      <DataTable columns={KEYCOLS} rows={(u.byKey ?? []).map((k, i) => ({ id: k.keyId ?? `k${i}`, kind: t("Key"), name: k.name ?? "—", calls: k.calls, errors: k.errors }))} caption={t("By key")} testid="api-usage-keys">{#snippet cell(r, c)}{#if c.key === "name"}<button class="inline-flex min-h-6 items-center underline decoration-dotted" onclick={() => (sel = sel?.id === r.id ? null : r)} data-testid="usage-open">{r.name}</button>{:else}{r[c.key]}{/if}{/snippet}</DataTable>
      <DataTable columns={ROUTECOLS} rows={(u.byRoute ?? []).map((r, i) => ({ id: `r${i}`, kind: t("Route"), route: `${r.method} ${r.path}`, calls: r.calls, errors: r.errors }))} caption={t("Busiest routes")} testid="api-usage-routes">{#snippet cell(r, c)}{#if c.key === "route"}<button class="inline-flex min-h-6 items-center font-mono text-[12.5px] underline decoration-dotted" onclick={() => (sel = sel?.id === r.id ? null : r)} data-testid="usage-open">{r.route}</button>{:else}{r[c.key]}{/if}{/snippet}</DataTable>
      {#if sel}<div class="rounded-xl border border-line bg-card p-4 text-sm" data-testid="usage-detail"><div class="flex items-center justify-between gap-3"><h3 class="font-medium">{sel.kind}: <span class="font-mono">{sel.name ?? sel.route}</span></h3><button class="btn quiet" onclick={() => (sel = null)}>{t("Close")}</button></div>
        <dl class="mt-3 grid grid-cols-3 gap-3"><div><dt class="font-mono text-[.7rem] uppercase tracking-wider text-faint">{t("Calls")}</dt><dd class="mt-1">{sel.calls}</dd></div><div><dt class="font-mono text-[.7rem] uppercase tracking-wider text-faint">{t("Errors")}</dt><dd class="mt-1">{sel.errors}</dd></div><div><dt class="font-mono text-[.7rem] uppercase tracking-wider text-faint">{t("Error share")}</dt><dd class="mt-1">{sel.calls ? ((sel.errors / sel.calls) * 100).toFixed(1) : "0.0"}%</dd></div></dl>
        <p class="mt-3 text-xs text-mute">{t("Over the last {n, plural, one {# day} other {# days}}. Open the API log to see each call.", { n: days })}</p></div>{/if}
    {/if}
  {/if}
</div>
