<script>
  let { embedded = false } = $props();   // Launch step 7: shown inside another screen (Documents, Plays, Billing), which owns the page title
  // CONTRACTS (Run 9 board "Contracts"; rulings R9-h, R9-i): every signed document with the dates and amounts read from its OWN date and amount boxes, a strip of numbers,
  // six months of signings on the moving floor, search, and the right-hand sheet to correct any date (the correction is what is shown). Free; the reminders before a notice
  // date are Pro. Nothing is guessed: a document whose boxes name no date shows "None", and the person can add one.
  import { onMount } from "svelte";
  import { api } from "$lib/api.js";
  import { live } from "$lib/live.js";
  import { t, i18n } from "$lib/i18n/index.svelte.js";
  import StatTile from "$lib/ui/StatTile.svelte";
  import Sheet from "$lib/ui/Sheet.svelte";
  import PageSkel from "$lib/ui/PageSkel.svelte";
  import { Floor } from "$lib/fx3d/index.js";
  import ProLock from "$lib/pro/ProLock.svelte";
  import { entitled, loadPlan } from "$lib/pro/plan.svelte.js";
  const un = (r) => r.json?.data ?? r.json;
  let data = $state(null), q = $state(""), problem = $state(null), loaded = $state(false), timer;
  let edit = $state(null), form = $state({}), saving = $state(false), saveProblem = $state(null);
  async function load() { const r = await api(`/api/documents/contracts${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ""}`); loaded = true; if (r.ok) { data = un(r); problem = null; } else problem = r.error ?? t("The contracts could not be loaded."); }
  const reload = () => { clearTimeout(timer); timer = setTimeout(load, 250); };
  onMount(() => { load(); loadPlan?.(); return live(["documents"], load); });

  // a date-only value is a calendar day: read and shown in UTC so it never moves a day in the reader's own zone
  const longDay = (iso) => (iso ? new Date(`${iso}T12:00:00Z`).toLocaleDateString(i18n.lang, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "");
  const today = () => new Date().toISOString().slice(0, 10);
  const daysTo = (iso) => Math.round((Date.parse(`${iso}T00:00:00Z`) - Date.parse(`${today()}T00:00:00Z`)) / 864e5);
  const rtf = () => new Intl.RelativeTimeFormat(i18n.lang, { numeric: "auto" });
  const soon = (iso) => { const d = daysTo(iso); return d < 0 ? null : d < 14 ? rtf().format(d, "day") : rtf().format(Math.round(d / 7), "week"); };
  const money = (minor, currency) => { const v = minor / 100; try { return currency ? new Intl.NumberFormat(i18n.lang, { style: "currency", currency: currency.toUpperCase() }).format(v) : new Intl.NumberFormat(i18n.lang, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v); } catch { return v.toFixed(2); } };
  const people = (c) => c.people.map((p) => p.name || p.email).filter(Boolean).join(" · ") || "—";
  const totalValue = $derived((data?.summary?.valueUnderContract ?? []).map((v) => money(v.amountMinor, v.currency)).join(" · ") || "—");
  const bars = $derived((() => { const m = data?.summary?.months ?? []; const top = Math.max(1, ...m.map((x) => x.signed)); return m.map((x, i) => ({ h: x.signed / top, label: `${x.month}: ${x.signed}`, strong: i === m.length - 1 })); })());

  const KINDS = () => [["start", t("Starts")], ["end", t("Ends")], ["notice", t("Notice by")], ["renewal", t("Renews")]];
  function open(c) {
    edit = c; saveProblem = null;
    form = Object.fromEntries([...KINDS().map(([k]) => [k, c.dates[k]?.date ?? ""]), ["value", c.dates.value?.amountMinor != null ? (c.dates.value.amountMinor / 100).toFixed(2) : ""], ["currency", c.dates.value?.currency ?? ""]]);
  }
  async function save() {
    saving = true; saveProblem = null;
    try {
      for (const [k] of KINDS()) {
        const before = edit.dates[k]?.date ?? "", now = (form[k] ?? "").trim();
        if (before === now) continue;
        const r = await api("/api/documents/key-dates/correct", { method: "POST", body: { instanceId: edit.id, kind: k, date: now || null } });
        if (!r.ok) { saveProblem = r.error ?? t("That did not save."); return; }
      }
      const beforeV = edit.dates.value?.amountMinor ?? null, txt = String(form.value ?? "").replace(/[,\s]/g, "");
      const nowV = txt === "" ? null : Math.round(Number(txt) * 100);
      if (txt !== "" && !(Number.isFinite(nowV) && nowV >= 0)) { saveProblem = t("The value must be a number, zero or more."); return; }
      if (nowV !== beforeV || (form.currency || "") !== (edit.dates.value?.currency ?? "")) {
        const r = await api("/api/documents/key-dates/correct", { method: "POST", body: { instanceId: edit.id, kind: "value", amountMinor: nowV, currency: form.currency?.trim() ? form.currency.trim().toLowerCase() : null } });
        if (!r.ok) { saveProblem = r.error ?? t("That did not save."); return; }
      }
      edit = null; await load();
    } finally { saving = false; }
  }
  const source = (d) => (!d ? "" : d.source === "person" ? t("corrected") : d.source === "scribe" ? t("proposed by Scribe") : t("from the document"));
</script>
<div class="flex flex-wrap items-start gap-3">
  <div class="min-w-0">{#if !embedded}<h1 class="text-[length:var(--t-title)] font-medium leading-tight tracking-[-0.02em]">{t("Contracts")}</h1>{/if}
    <p class="mt-1 text-mute">{t("Every signed document, with the dates and amounts read from its own boxes.")}</p></div>
  <input class="field ml-auto !w-full sm:!w-80" placeholder={t("Search contracts, people, amounts…")} aria-label={t("Search contracts")} bind:value={q} oninput={reload} data-testid="contracts-search" />
</div>
{#if problem}<p class="notice warn mt-3" role="alert" data-testid="contracts-problem">{problem}</p>{/if}
<section class="strip mt-5" aria-label={t("Summary")} data-testid="contracts-strip">
  <StatTile label={t("Signed contracts")} value={data?.summary?.signed ?? 0} />
  <StatTile label={t("Renew or end in the next 30 days")} value={data?.summary?.renewingIn30Days ?? 0} />
  <StatTile label={t("Value under contract")} value={totalValue} />
  <div class="min-w-0"><div class="font-mono text-[.7rem] uppercase tracking-wider text-faint">{t("Signed, last six months")}</div><Floor {bars} testid="contracts-floor" /></div>
</section>
<div class="mt-4 overflow-x-auto rounded-xl border border-line bg-card">
  <table class="w-full min-w-[720px] text-left text-[14px]" data-testid="contracts-table">
    <thead class="font-mono text-[.7rem] uppercase tracking-wider text-faint"><tr><th class="h-9 px-4">{t("Contract")}</th><th class="px-4">{t("People")}</th><th class="px-4">{t("Value")}</th><th class="px-4">{t("Ends")}</th><th class="px-4">{t("Notice by")}</th><th class="px-4"></th></tr></thead>
    <tbody>
      {#if !loaded}<tr><td colspan="6" class="p-4"><PageSkel kind="list" testid="contracts-skel" /></td></tr>
      {:else}
        {#each data?.contracts ?? [] as c (c.id)}
          {@const notice = c.dates.notice?.date ?? c.dates.renewal?.date ?? null}
          <tr class="h-10 border-t border-line" data-testid="contract-row" data-id={c.id}>
            <td class="px-4 py-2"><a class="font-medium text-ink no-underline hover:underline" href={`/documents/${c.id}`}>{c.title}</a></td>
            <td class="px-4 py-2 text-mute">{people(c)}</td>
            <td class="px-4 py-2 tabular-nums" data-testid="contract-value">{c.dates.value?.amountMinor != null ? money(c.dates.value.amountMinor, c.dates.value.currency) : t("None")}</td>
            <td class="px-4 py-2" data-testid="contract-ends">{c.dates.end?.date ? longDay(c.dates.end.date) : t("No end date")}</td>
            <td class="px-4 py-2" data-testid="contract-notice">{#if notice}{@const s = soon(notice)}<span class={s && daysTo(notice) <= 30 ? "font-medium text-brand" : ""}>{longDay(notice)}{#if s && daysTo(notice) <= 30}{" · "}{s}{/if}</span>{:else}{t("None")}{/if}</td>
            <td class="px-4 py-2 text-right"><button class="btn quiet !min-h-8 !py-0.5 text-sm" onclick={() => open(c)} data-testid="contract-correct">{t("Correct dates")}</button></td>
          </tr>
        {:else}
          <tr><td colspan="6" class="px-4 py-8 text-center" data-testid={q.trim() ? "contracts-filtered-empty" : "contracts-empty"}>
            {#if q.trim()}{t("No signed contract matches “{q}”.", { q: q.trim() })} <button class="underline" onclick={() => { q = ""; load(); }}>{t("Clear the search")}</button>
            {:else}{t("When a document is signed by everyone, it shows here with its dates.")}{/if}</td></tr>
        {/each}
      {/if}
    </tbody>
  </table>
</div>
<p class="mt-3 flex flex-wrap items-center gap-2 text-sm text-mute" data-testid="contracts-note">{t("Dates and amounts are read from each signed document's own date and amount boxes. You can correct any of them.")}
  {#if entitled("renewal_reminders") === false}<ProLock item="renewal_reminders" badgeOnly tip={t("Reminders 30 and 7 days before a notice date are part of Pro. The dates show on every plan.")} />{:else if entitled("renewal_reminders")}<span>{t("You are reminded 30 and 7 days before each notice date.")}</span>{/if}</p>

<Sheet open={Boolean(edit)} title={edit ? t("Dates for “{title}”", { title: edit.title }) : ""} onclose={() => (edit = null)}>
  {#if edit}
    <div class="grid gap-3" data-testid="contract-sheet">
      {#each KINDS() as [k, label]}
        <label class="grid grid-cols-[9rem_minmax(0,1fr)] items-center gap-3"><span class="text-sm font-medium">{label}</span>
          <span class="grid gap-0.5"><input class="field" type="date" bind:value={form[k]} data-testid={`sheet-${k}`} /><span class="text-xs text-mute">{source(edit.dates[k])}</span></span></label>
      {/each}
      <label class="grid grid-cols-[9rem_minmax(0,1fr)] items-center gap-3"><span class="text-sm font-medium">{t("Value")}</span>
        <span class="grid gap-0.5"><span class="flex gap-2"><input class="field" inputmode="decimal" bind:value={form.value} placeholder="0.00" data-testid="sheet-value" /><input class="field !w-20 uppercase" maxlength="3" bind:value={form.currency} placeholder="USD" aria-label={t("Currency")} data-testid="sheet-currency" /></span><span class="text-xs text-mute">{source(edit.dates.value)}</span></span></label>
      {#if saveProblem}<p class="text-sm text-bad" role="alert" data-testid="sheet-problem">{saveProblem}</p>{/if}
    </div>
  {/if}
  {#snippet footer()}<div class="flex justify-end gap-2"><button class="btn quiet" onclick={() => (edit = null)}>{t("Cancel")}</button><button class="btn primary" disabled={saving} onclick={save} data-testid="sheet-save">{saving ? t("Saving…") : t("Save")}</button></div>{/snippet}
</Sheet>
<style>
  .strip { display: grid; gap: 18px 28px; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); padding: 14px 0; border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); align-items: end; }
  .strip > :global(*) { padding-left: 14px; border-left: 1px solid var(--line); } .strip > :global(*:first-child) { padding-left: 0; border-left: 0; }
</style>
