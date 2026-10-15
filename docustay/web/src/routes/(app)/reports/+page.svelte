<script>
  import { cardTable } from "$lib/ui/cardTable.js";
  import { live } from "$lib/live.js";
  import { onMount, untrack } from "svelte";
  import { api } from "$lib/api.js";
  import { t } from "$lib/i18n/index.svelte.js";
  import PageHeader from "$lib/ui/PageHeader.svelte"; import ApiCall from "$lib/ui/ApiCall.svelte"; import FilterSelect from "$lib/ui/FilterSelect.svelte"; import StatTile from "$lib/ui/StatTile.svelte"; import AreaChart from "$lib/ui/AreaChart.svelte"; import RateCard from "$lib/ui/RateCard.svelte"; import Icon from "$lib/ui/Icon.svelte"; import LegendRow from "$lib/ui/LegendRow.svelte"; import Spark from "$lib/ui/Spark.svelte";
  let preset = $state("30"), events = $state("all");
  const PRESETS = $derived([{ value: "7", label: t("Last 7 days") }, { value: "15", label: t("Last 15 days") }, { value: "30", label: t("Last 30 days") }, { value: "90", label: t("Last 90 days") }, { value: "custom", label: t("Custom range") }]);
  const EVENTS = $derived([{ value: "all", label: t("All events") }, { value: "sent", label: t("Sent") }, { value: "completed", label: t("Completed") }]);
  const iso = (d) => d.toISOString().slice(0, 10);
  function applyPreset(v) { preset = v; if (v === "custom") return; const end = new Date(); const start = new Date(Date.now() - Number(v) * 86400000); from = iso(start); to = iso(end); load(); }
  let r = $state(null), teams = $state([]), usage = $state(null), problem = $state(null), busy = $state(false);
  let from = $state(""), to = $state(""), team = $state("");
  const qs = () => { const p = new URLSearchParams(); if (from) p.set("from", from); if (to) p.set("to", to); if (team) p.set("team", team); return p.toString(); };
  // Run 8 (R8-13): ONE request per window. Opening the page used to send the same report request four times, then three more when the first answered (each effect read
  // from/to/team through load(), and the answer writing from/to set them off again). The effects now depend only on their own control; a repeat of the last window is skipped
  // unless a live update asks for fresh numbers.
  let lastKey = null;
  async function load(fresh = false) {
    const key = qs(); if (!fresh && key === lastKey) return; lastKey = key;
    busy = true; problem = null;
    const x = await api(`/api/documents/reports?${key}`); busy = false;
    if (!x.ok) { problem = x.error ?? t("The report could not be made."); lastKey = null; return; }
    r = x.json; if (from !== r.window.from) from = r.window.from; if (to !== r.window.to) to = r.window.to; lastKey = qs();
  }
  onMount(async () => {
    const [tm, s] = await Promise.all([api("/api/documents/teams"), api("/api/product/docustay/status")]);
    teams = tm.ok ? tm.json.teams ?? [] : []; usage = s.ok ? (s.json?.data ?? s.json)?.usage ?? null : null;
  });

  const hrs = (h) => (h == null ? "—" : h < 48 ? t("{n, plural, one {# hour} other {# hours}}", { n: h }) : t("{n, plural, one {# day} other {# days}}", { n: Math.round(h / 24) }));
  const csvHref = $derived(`/api/documents/reports.csv?${qs()}`);
  onMount(() => live(["documents"], () => load(true)));
  $effect(() => { const p = preset; if (p !== "custom" && p) { const end = new Date(); from = iso(new Date(Date.now() - Number(p) * 86400000)); to = iso(end); untrack(() => load()); } });
  $effect(() => { team; untrack(() => load()); });
</script>
<svelte:head><title>{t("Reports")} · Docustay</title></svelte:head>
<PageHeader title={t("Reports")}>
  {#snippet actions()}<ApiCall path="/api/v1/reports" />
    {#if teams.length}<FilterSelect options={[{ value: "", label: t("All teams") }, ...teams.map((x) => ({ value: x.id, label: x.name }))]} bind:value={team} label={t("Team")} testid="report-team" />{/if}
    <FilterSelect options={PRESETS} bind:value={preset} label={t("Date range")} testid="report-range" />
    <a class="btn" href={csvHref} data-testid="report-csv"><Icon name="download" size={15} />{t("Download CSV")}</a>{/snippet}
</PageHeader>
{#if preset === "custom"}<form class="mb-4 flex flex-wrap items-end gap-2" onsubmit={(e) => { e.preventDefault(); load(); }}>
  <label class="text-xs text-mute">{t("From")}<input class="field !py-1.5" type="date" bind:value={from} data-testid="report-from" /></label>
  <label class="text-xs text-mute">{t("To")}<input class="field !py-1.5" type="date" bind:value={to} data-testid="report-to" /></label><button class="btn" disabled={busy}>{t("Update")}</button></form>{/if}
{#if problem}<p class="mt-4 text-bad" role="alert">{problem}</p>{:else if !r}<div class="skel h-72"></div>{:else}
  {#if usage}<p class="mb-3 text-[13px] text-mute" data-testid="usage-line">{usage.documentsLimit == null ? t("Plan usage this month: {sent} documents sent (no limit). Test documents are never counted.", { sent: usage.documentsThisMonth }) : t("Plan usage this month: {sent} of {limit} documents sent. Test documents are never counted.", { sent: usage.documentsThisMonth, limit: usage.documentsLimit })}</p>{/if}
  <section class="rounded-2xl border border-line bg-card p-6 shadow-[var(--shadow)]" data-testid="report-totals">
    <div class="flex flex-wrap items-start justify-between gap-4"><div class="grid flex-1 gap-6 sm:grid-cols-3"><StatTile label={t("Documents sent")} value={r.totals.sent} /><StatTile label={t("Completion rate")} value={r.totals.completionRate == null ? "—" : `${r.totals.completionRate}%`} /><StatTile label={t("Typical time to finish")} value={hrs(r.totals.medianHoursToComplete)} /></div><FilterSelect options={EVENTS} bind:value={events} label={t("Events")} testid="report-events" /></div>
    <div class="mt-6" data-testid="report-chart"><AreaChart data={r.byDay.map((d) => ({ date: d.date, sent: events === "completed" ? 0 : d.sent, completed: events === "sent" ? 0 : d.completed }))} series={[...(events === "completed" ? [] : [{ key: "sent", label: t("Sent"), color: "var(--accent)" }]), ...(events === "sent" ? [] : [{ key: "completed", label: t("Completed"), color: "var(--ok)" }])]} height={256} label={t("Documents sent and completed each day")} /></div>
    <div class="mt-3 flex flex-wrap items-center gap-6"><LegendRow rows={[{ name: t("Sent"), color: "var(--accent)", value: r.totals.sent }, { name: t("Completed"), color: "var(--ok)", value: r.totals.completed }]} /><span class="ml-auto flex items-center gap-2 text-[12px] text-mute">{t("Sent each day")}<Spark values={r.byDay.map((d) => d.sent)} tone="var(--accent)" label={t("Sent each day")} /></span></div>
    <p class="mt-1 text-[12px] text-faint">{t("{from} to {to}", { from: r.window.from, to: r.window.to })} ({r.timezone})</p>
    {#if r.byTemplate.length}<ul class="mt-4 grid gap-2 text-[14px]" aria-label={t("By template")}>{#each r.byTemplate as x}<li class="flex flex-wrap items-center gap-x-6 gap-y-1 border-t border-line pt-2"><span class="min-w-0 flex-1">{x.name} <span class="text-mute">({x.sent})</span></span><span class="flex items-center gap-2 text-mute"><i class="h-2 w-2 rounded-full" style="background:var(--accent)"></i>{t("Sent")} {x.sent}</span><span class="flex items-center gap-2 text-mute"><i class="h-2 w-2 rounded-full" style="background:var(--ok)"></i>{t("Done")} {x.completed}{x.sent ? ` · ${Math.round((x.completed / x.sent) * 100)}%` : ""}</span></li>{/each}</ul>{/if}
  </section>
  <div class="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
    <RateCard label={t("Declined")} rate={r.totals.sent ? Math.round((r.totals.declined / r.totals.sent) * 100) : 0} count={r.totals.declined} tone="bad" />
    <RateCard label={t("Expired")} rate={r.totals.sent ? Math.round((r.totals.expired / r.totals.sent) * 100) : 0} count={r.totals.expired} tone="warn" />
    <RateCard label={t("Voided")} rate={r.totals.sent ? Math.round((r.totals.voided / r.totals.sent) * 100) : 0} count={r.totals.voided} tone="warn" />
    <RateCard label={t("Waiting right now")} rate={r.totals.sent ? Math.round((r.totals.waitingNow / r.totals.sent) * 100) : 0} count={r.totals.waitingNow} tone="ok" />
  </div>
  <section class="mt-8" data-testid="report-forms"><div class="flex flex-wrap items-baseline gap-3"><h2 class="text-[15px] font-medium">{t("Form responses")}</h2>{#if r.forms?.responses}<span class="text-sm text-mute">{t("{n} started, {done} completed ({rate}%)", { n: r.forms.responses, done: r.forms.completed, rate: r.forms.completionRate })}</span>{/if}<a class="ml-auto inline-flex min-h-6 items-center text-sm text-brand underline" href="/forms">{t("Open Forms")}</a></div>
    <table use:cardTable class="card-table mt-2 w-full text-left text-sm"><thead class="font-mono text-[.7rem] uppercase tracking-wider text-faint"><tr><th class="py-1">{t("Form")}</th><th class="py-1 text-right">{t("Responses")}</th><th class="py-1 text-right">{t("Completed")}</th><th class="py-1 text-right">{t("Completion rate")}</th></tr></thead>
      <tbody>{#each r.forms?.byForm ?? [] as x}<tr class="border-t border-line"><td class="py-1.5"><a class="underline" href={`/documents?form=${encodeURIComponent(x.name)}`}>{x.name}</a></td><td class="py-1.5 text-right">{x.responses}</td><td class="py-1.5 text-right">{x.completed}</td><td class="py-1.5 text-right">{x.completionRate == null ? "—" : `${x.completionRate}%`}</td></tr>{:else}<tr><td colspan="4" class="py-3 text-mute">{t("No form responses in this period.")} <a class="text-brand underline" href="/forms">{t("Publish a form")}</a></td></tr>{/each}</tbody></table></section>
  <div class="mt-8 grid gap-6 lg:grid-cols-2">
    {#each [[t("By team"), r.byTeam], [t("By sender"), r.bySender]] as [title, rows]}
      <section><h2 class="text-[15px] font-medium">{title}</h2>
        <table use:cardTable class="card-table mt-2 w-full text-left text-sm"><thead class="font-mono text-[.7rem] uppercase tracking-wider text-faint"><tr><th class="py-1">{t("Name")}</th><th class="py-1 text-right">{t("Sent")}</th><th class="py-1 text-right">{t("Done")}</th></tr></thead>
          <tbody>{#each rows as x}<tr class="border-t border-line"><td class="py-1.5">{x.name}</td><td class="py-1.5 text-right">{x.sent}</td><td class="py-1.5 text-right">{x.completed}</td></tr>{:else}<tr><td colspan="3" class="py-3 text-mute">{t("Nothing sent in this period.")}</td></tr>{/each}</tbody></table></section>{/each}
  </div>
{/if}
<style>
  .skel { border-radius: 16px; background: linear-gradient(90deg, var(--tint) 25%, var(--card) 50%, var(--tint) 75%); background-size: 200% 100%; animation: skel 1.4s ease-in-out infinite; } @keyframes skel { to { background-position: -200% 0; } }
</style>
