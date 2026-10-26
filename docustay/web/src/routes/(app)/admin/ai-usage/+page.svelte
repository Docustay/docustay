<script>
  import PageSkel from "$lib/ui/PageSkel.svelte";
  // PLATFORM > AI USAGE (AI-COST-AND-USAGE-SPEC §4–§5): what the hosted service has spent on the platform's own AI key against the monthly ceiling, by plan, by kind of work and by model, the busiest workspaces, errors, a CSV.
  // Only the people the platform names (the Docustay viewers) can open it; anyone else gets the server's refusal in plain words. The ceiling and the pause are changed here.
  import { onMount } from "svelte";
  import { t } from "$lib/i18n/index.svelte.js";
  import { api } from "$lib/api.js";
  import { toast } from "$lib/ui/toast.js";
  import { ask } from "$lib/ui/confirm.svelte.js";
  import Meter from "$lib/ui/Meter.svelte";
  import Bars from "$lib/ui/Bars.svelte";
  import { cardTable } from "$lib/ui/cardTable.js";
  const BASE = "/api/product/docustay/ai-usage";
  let s = $state(null), problem = $state(null), ceilingText = $state(""), busy = $state(false);
  const usd = (n) => new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n ?? 0);
  async function load() { const r = await api(BASE); if (r.ok) { s = r.json?.data ?? r.json; ceilingText = s.ceilingFromSetting ? String(s.ceilingUsd) : ""; problem = null; } else problem = r.error || t("The AI usage could not be loaded."); }
  onMount(load);
  async function saveCeiling() { busy = true; const r = await api(`${BASE}/ceiling`, { method: "POST", body: { usd: ceilingText.trim() === "" ? null : Number(ceilingText) } }); busy = false; if (!r.ok) { toast(r.error || t("That was not accepted."), "bad"); return; } toast(t("Saved"), "ok"); await load(); }
  async function togglePause() {
    if (!s.paused && !(await ask(t("Pause AI for everyone? Hosted workspaces that use the platform's key stop getting AI until you resume it. Workspaces with their own key and self-hosts are not affected."), { yes: t("Pause AI") }))) return;
    busy = true; const r = await api(`${BASE}/pause`, { method: "POST", body: { paused: !s.paused } }); busy = false; if (!r.ok) { toast(r.error || t("That was not accepted."), "bad"); return; } await load();
  }
  const pct = $derived(s?.percentOfCeiling ?? 0);
</script>
<svelte:head><title>{t("AI usage")} · Docustay</title></svelte:head>
<div class="flex flex-wrap items-center gap-3"><h1 class="text-[length:var(--t-title)] font-medium leading-tight tracking-[-0.02em]">{t("AI usage")}</h1>
  {#if s}<a class="btn quiet ml-auto" href={`${BASE}.csv?month=${s.month}`} data-testid="aiu-csv">{t("Download CSV")}</a>{/if}</div>
{#if problem}<div class="notice bad mt-4 flex flex-wrap items-center gap-3" role="alert" data-testid="aiu-problem"><span>{String(problem).replace(/^refused:\s*/i, "")}</span><button class="btn" onclick={() => { problem = null; load(); }} data-testid="aiu-retry">{t("Try again")}</button></div>
{:else if !s}<div class="mt-6"><PageSkel kind="panel" testid="ai-usage-loading" /></div>
{:else}
  <section class="card mt-5 grid gap-3 p-4" data-testid="aiu-ceiling">
    <Meter value={s.spentMonthUsd} max={s.ceilingUsd || 1} label={t("Spent this month")} detail={`${usd(s.spentMonthUsd)} / ${usd(s.ceilingUsd)} · ${pct}%`} auto testid="aiu-meter" />
    <p class="text-sm text-mute" data-testid="aiu-today">{t("Today {spent}, daily ceiling {ceiling}", { spent: usd(s.spentTodayUsd), ceiling: usd(s.dailyCeilingUsd) })}</p>
    {#if s.paused || s.ceilingReached}<p class="notice warn text-sm" role="status" data-testid="aiu-paused">{s.paused ? t("AI is paused by hand for all hosted workspaces.") : t("The ceiling is reached, so AI is paused for all hosted workspaces.")}</p>{/if}
    <div class="flex flex-wrap items-end gap-3">
      <label class="grid gap-1 text-sm"><span class="font-medium">{t("Monthly ceiling (US dollars)")}</span><input class="field !w-40" inputmode="decimal" bind:value={ceilingText} placeholder="150" data-testid="aiu-ceiling-input" /></label>
      <button class="btn primary" disabled={busy} onclick={saveCeiling} data-testid="aiu-ceiling-save">{t("Save")}</button>
      <button class="btn" disabled={busy} onclick={togglePause} data-testid="aiu-pause">{s.paused ? t("Resume AI") : t("Pause AI")}</button>
    </div>
  </section>
  <section class="mt-6 grid gap-6 lg:grid-cols-2">
    {#each [[t("By plan"), s.byPlan, "aiu-plan"], [t("By kind of work"), s.byFeature, "aiu-feature"], [t("By model"), s.byModel, "aiu-model"]] as [title, rows, id]}
      <div data-testid={id}><h2 class="mb-2 text-lg font-semibold">{title}</h2>
        <table class="w-full text-sm" use:cardTable><thead><tr class="text-left text-mute"><th class="py-1">{t("Name")}</th><th>{t("Calls")}</th><th>{t("Credits")}</th><th>{t("Spend")}</th><th>{t("Errors")}</th></tr></thead>
          <tbody>{#each rows as r (r.key)}<tr class="border-t border-line"><td class="py-1">{r.key}</td><td class="tabular-nums">{r.calls}</td><td class="tabular-nums">{r.credits}</td><td class="tabular-nums">{usd(r.usd)}</td><td class="tabular-nums">{r.errors}</td></tr>{:else}<tr><td colspan="5" class="py-2 text-mute">{t("Nothing yet this month.")}</td></tr>{/each}</tbody></table></div>
    {/each}
    <div data-testid="aiu-top"><h2 class="mb-2 text-lg font-semibold">{t("Busiest workspaces")}</h2>
      <table class="w-full text-sm" use:cardTable><thead><tr class="text-left text-mute"><th class="py-1">{t("Workspace")}</th><th>{t("Plan")}</th><th>{t("Calls")}</th><th>{t("Credits")}</th><th>{t("Spend")}</th></tr></thead>
        <tbody>{#each s.top as r (r.tenantId)}<tr class="border-t border-line"><td class="py-1">{r.workspace}{#if r.ownKey} <span class="chip mute">{t("own key")}</span>{/if}</td><td>{r.plan ?? ""}</td><td class="tabular-nums">{r.calls}</td><td class="tabular-nums">{r.credits}</td><td class="tabular-nums">{usd(r.usd)}</td></tr>{:else}<tr><td colspan="5" class="py-2 text-mute">{t("Nothing yet this month.")}</td></tr>{/each}</tbody></table></div>
  </section>
  <section class="mt-6" data-testid="aiu-daily"><h2 class="mb-2 text-lg font-semibold">{t("Spend by day")}</h2>
    {#if s.daily.length}<Bars data={s.daily.map((d) => ({ label: d.day, value: d.usd }))} label={t("Spend by day")} />{:else}<p class="text-mute">{t("Nothing yet this month.")}</p>{/if}
    <p class="mt-2 text-sm text-mute" data-testid="aiu-errors">{t("{n, plural, one {# call failed} other {# calls failed}} and {m, plural, one {# was refused} other {# were refused}} this month.", { n: s.errors, m: s.refused })}</p></section>
{/if}
