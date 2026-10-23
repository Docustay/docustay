<script>
  // "This billing month" (Billing, Plan tab, right): the period track and its reset date, the usage meters (spent against the monthly budget with notches at the alert percents, AI drafts, documents,
  // new templates), what has been billed so far, the monthly budget field and the alert sentence. Free has no per-unit price, so it shows no spend or budget (the server sends `budget: null`).
  import PeriodTrack from "./PeriodTrack.svelte";
  import AiUsageBar from "$lib/ai/AiUsageBar.svelte";
  import Meter from "$lib/ui/Meter.svelte";
  import { api, money } from "$lib/api.js";
  import { t, whenText } from "$lib/i18n/index.svelte.js";
  import { notchesOf } from "./billingModel.js";
  let { st, onChanged = async () => {} } = $props();
  const un = (r) => r.json?.data ?? r.json;
  const usage = $derived(st?.usage ?? null), budget = $derived(st?.budget ?? null);
  const perBilling = $derived(usage?.periodKind === "billing");
  const resetsLabel = $derived(perBilling && usage?.periodEnd ? t("Resets {date}", { date: whenText(usage.periodEnd, { month: "short", day: "numeric", timeZone: "UTC" }) }) : t("Resets on the 1st"));
  let input = $state(""), busy = $state(false), msg = $state(null);
  $effect(() => { if (budget && input === "") input = String(budget.budgetMinor / 100); });
  async function save() {
    // R13-D215: a strict amount ("50", "$1,250.50"); a minus sign or letters are refused, never stripped into another number
    const m = /^\s*\$?\s*(\d{1,3}(?:,\d{3})*|\d+)(?:\.(\d{1,2}))?\s*$/.exec(String(input));
    if (!m) { msg = { bad: true, text: t("Type an amount in dollars, like 50 or 250.00.") }; return; }
    const minor = Number(m[1].replace(/,/g, "")) * 100 + Number((m[2] ?? "").padEnd(2, "0") || 0);
    busy = true; msg = null; const r = await api("/api/product/docustay/budget", { method: "POST", body: { budgetMinor: minor } }); busy = false;
    if (!r.ok) { msg = { bad: true, text: r.error ?? t("That did not work. Try again.") }; return; }
    msg = { bad: false, text: t("Budget saved.") }; await onChanged();
  }
  // the nudge: when Pay as you go has cost more than about 70% of Pro's flat price this month, say what Pro would be
  const proPrice = $derived(st?.upgrade?.plan?.priceMinor ?? null);
  const paygCost = $derived(budget ? budget.usedMinor + ((st?.seats?.used ?? 1) * ((st?.plans ?? []).find((p) => p.key === "docustay_payg")?.priceMinor ?? 0)) : 0);
  const nudgePro = $derived(st?.plan?.key === "docustay_payg" && proPrice != null && paygCost >= proPrice * 0.7);
  const tone = $derived(!budget ? "" : budget.percent >= 100 ? "bad" : budget.percent >= 80 ? "warn" : "ok");
  const notches = $derived(notchesOf(budget));
</script>
<section class="month" aria-label={perBilling ? t("This billing month") : t("This month")} data-testid="billing-usage">
  <h2 class="head">{perBilling ? t("This billing month") : t("This month")}</h2>
  {#if usage}<div class="mt-3"><PeriodTrack start={usage.periodStart} end={usage.periodEnd} sentence={budget && usage.periodEnd ? t("Your free allowance and your budget reset on {date}.", { date: whenText(usage.periodEnd, { month: "short", day: "numeric", timeZone: "UTC" }) }) : ""} /><p class="mt-1.5 text-[12.5px] text-mute" data-testid="billing-resets">{resetsLabel}</p></div>{/if}

  <div class="meters">
    {#if budget}
      <div data-testid="billing-spend">
        <div class="flex items-baseline justify-between text-sm"><span class="font-medium">{t("Spent so far")}</span><span class="tabular-nums text-mute">{money(budget.usedMinor)} / {money(budget.budgetMinor)}</span></div>
        <div class="bar" role="progressbar" aria-label={t("Spent so far")} aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.min(100, budget.percent)} aria-valuetext={t("{pct}% of your {budget} budget", { pct: budget.percent, budget: money(budget.budgetMinor) })}>
          <i class="fill {tone}" style="width:{Math.min(100, budget.percent)}%"></i>
          {#each notches as n (n)}<b class="notch" style="left:{n}%" title="{n}%"></b>{/each}
        </div>
        <div class="scale" aria-hidden="true">{#each notches as n (n)}<span style="left:{n}%">{n}%</span>{/each}</div>
      </div>
    {/if}
    <div data-testid="billing-ai"><AiUsageBar compact /></div>
    {#if usage}
      {#if usage.documentsLimit == null}
        <div class="flex items-baseline justify-between text-sm" data-testid="billing-docs"><span class="font-medium">{perBilling ? t("Documents this billing month") : t("Documents this month")}</span><span class="tabular-nums text-mute">{usage.documentsThisMonth} · {t("Unlimited")}</span></div>
      {:else}
        <Meter testid="billing-docs" value={usage.documentsThisMonth} max={usage.documentsLimit} auto={!budget} label={perBilling ? t("Documents this billing month") : t("Documents this month")}
          detail={budget ? t("{used} of {limit}, then {price} each", { used: usage.documentsThisMonth, limit: usage.documentsLimit, price: money((st?.plans ?? []).find((p) => p.key === st?.plan?.key)?.docOverMinor ?? 0) }) : t("{used} of {limit}", { used: usage.documentsThisMonth, limit: usage.documentsLimit })} />
      {/if}
      {#if usage.templatesLimit == null}
        <div class="flex items-baseline justify-between text-sm" data-testid="billing-templates"><span class="font-medium">{perBilling ? t("New templates this billing month") : t("New templates this month")}</span><span class="tabular-nums text-mute">{usage.templatesThisMonth} · {t("Unlimited")}</span></div>
      {:else}
        <Meter testid="billing-templates" value={usage.templatesThisMonth} max={usage.templatesLimit} auto label={perBilling ? t("New templates this billing month") : t("New templates this month")} detail={t("{used} of {limit}", { used: usage.templatesThisMonth, limit: usage.templatesLimit })} />
      {/if}
    {/if}
  </div>

  {#if budget}
    <div class="budget" data-testid="billing-budget">
      <p class="text-[15px]" data-testid="billing-bill-so-far">{t("So far: {amount}", { amount: money(budget.usedMinor) })} <span class="text-mute">· {t("{n} documents past the included amount", { n: budget.usage.documents.units })} · {t("{n} AI drafts past the included amount", { n: budget.usage.drafts.units })}</span></p>
      <form class="mt-3 flex flex-wrap items-center gap-2" onsubmit={(e) => { e.preventDefault(); save(); }}>
        <label for="budget-input" class="text-sm text-mute">{t("Monthly budget")} $</label>
        <input id="budget-input" class="field w-28" inputmode="decimal" bind:value={input} oninput={() => (msg = null)} aria-invalid={msg?.bad ? "true" : undefined} aria-describedby="budget-msg" data-testid="billing-budget-input" />
        <button class="btn {budget.paused ? 'primary' : ''}" type="submit" disabled={busy} data-testid="billing-budget-save">{budget.paused ? t("Raise the budget") : t("Save")}</button>
      </form>
      {#if msg}<p id="budget-msg" class="mt-2 text-sm {msg.bad ? 'text-bad' : 'text-mute'}" role="status">{msg.text}</p>{/if}
      <p class="mt-2 text-sm text-mute">{t("You get an email at {a}%, {b}% and {c}% of your budget. At {c}% sending pauses. We invoice monthly, and early if about {early} builds up.", { a: budget.alertPercents?.[0], b: budget.alertPercents?.[1], c: budget.alertPercents?.[2], early: money(budget.earlyInvoiceMinor ?? 0) })}</p>
      {#if nudgePro}<p class="mt-3 text-sm" data-testid="billing-pro-nudge">{t("Pro would be {price} a month for this workspace, with unlimited documents.", { price: money(proPrice) })}</p>{/if}
    </div>
  {/if}
</section>
<style>
  .month { border: 1px solid var(--line); border-radius: 14px; padding: 26px 30px; background: var(--card); min-width: 0; }
  .head { font-size: 17px; font-weight: 600; letter-spacing: -.01em; }
  .meters { display: grid; gap: 18px; margin-top: 22px; }
  .bar { position: relative; height: 8px; margin-top: 7px; border-radius: 999px; background: var(--stage-off, var(--tint)); overflow: visible; }
  .fill { position: absolute; inset: 0 auto 0 0; border-radius: 999px; background: var(--ok-dot); min-width: 2px; }
  .fill.warn { background: var(--warn-dot); } .fill.bad { background: var(--bad); }
  .notch { position: absolute; top: -3px; bottom: -3px; width: 2px; margin-left: -1px; background: var(--line-strong); border-radius: 1px; }
  .scale { position: relative; height: 14px; margin-top: 4px; font-size: 11px; color: var(--faint); }
  .scale span { position: absolute; transform: translateX(-50%); }
  .budget { margin-top: 22px; padding-top: 18px; border-top: 1px solid var(--line); }
  @media (max-width: 640px) { .month { padding: 20px 18px; } }
</style>
