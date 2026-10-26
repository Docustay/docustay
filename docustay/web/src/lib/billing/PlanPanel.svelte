<script>
  // "Your plan" (Billing, Plan tab, left): the glowing 3D piece, the plan's name and one line about it, then the facts that belong to it (next payment, card on file, fees saved, people) and the
  // switch action. Everything it says comes from the status payload and the billing details; the numbers are formatted here, never typed.
  import PlanPiece from "./PlanPiece.svelte";
  import StatusChip from "$lib/ui/StatusChip.svelte";
  import { money } from "$lib/api.js";
  import { t, whenText } from "$lib/i18n/index.svelte.js";
  import { EXPLORE_PRO_URL } from "$lib/pro/plan.svelte.js";
  import { SHORT, cardText, brandName, cardExpired, chargeWords } from "./billingModel.js";
  let { st, details = null, busy = false, switchTo = null, canSwitch = false, onSwitch = () => {}, onPortal = () => {} } = $props();
  const key = $derived(st?.plan?.key ?? "docustay_free"), short = $derived(SHORT[key] ?? "free");
  const isLife = $derived(short === "lifetime"), isFree = $derived(short === "free");
  const day = (iso) => whenText(iso, { dateStyle: "medium", timeZone: "UTC" });
  const failed = $derived(st?.plan?.ended === "payment");   // a paid plan whose payment failed past the grace: the price of a plan the person is no longer on is not shown
  const line = $derived(
    failed ? t("Your last payment didn't go through, so sending is paused. Update your card and it carries on.")
    : isLife ? t("You're on Lifetime: Pro for as long as Docustay runs the hosted service. One payment, nothing to renew.")
    : isFree ? t("You're on Free. Resets on {date}.", { date: st?.usage?.resetsAt ? day(st.usage.resetsAt) : "—" })
    : t("You're on {plan}.", { plan: st?.plan?.name ?? "" }));
  const next = $derived(st?.plan?.cancelsAt ? { label: t("Plan ends"), value: day(st.plan.cancelsAt) }
    : isLife ? { label: t("Next payment"), value: t("Nothing to renew") }
    : details?.nextPayment ? { label: t("Next payment"), value: `${day(details.nextPayment.at)} · ${money(details.nextPayment.amountMinor, details.nextPayment.currency)}` }
    : st?.plan?.renewsAt ? { label: t("Next payment"), value: day(st.plan.renewsAt) } : { label: t("Next payment"), value: "—" });
  const card = $derived(details?.card ?? null), expired = $derived(cardExpired(card)), declined = $derived(Boolean(st?.paymentProblem) && !expired);
  const price = $derived(!failed && details?.nextPayment ? `${money(details.nextPayment.amountMinor, details.nextPayment.currency)} ${details.nextPayment.interval === "year" ? t("a year") : t("a month")}` : "");
  const people = $derived(st?.seats ? t("{count} of {included} included team members are in use.", { count: st.seats.used, included: st.seats.included }) : "");
  const seatPrice = $derived(st?.seats?.extraSeatPriceMinor != null ? t("Each extra team member is {price} a month.", { price: money(st.seats.extraSeatPriceMinor) }) : "");
  const u = $derived(st?.usage ?? {});
  const signersLine = $derived(u.signersLimit != null ? t("{used} of {limit} different signers sent to this month", { used: u.signersThisMonth ?? 0, limit: u.signersLimit }) : t("Unlimited, free"));
  const templatesLine = $derived(u.templatesLimit != null ? t("{used} of {limit} new templates this month", { used: u.templatesThisMonth ?? 0, limit: u.templatesLimit }) : t("Unlimited"));
  const peopleRule = $derived(isFree ? t("{n, plural, one {# team member} other {# team members}}", { n: (st?.plans ?? []).find((p) => p.key === key)?.people ?? 1 }) : t("Unlimited"));
</script>
{#snippet saved()}
        <div class="fact"><dt>{t("Saved in fees this month")}</dt><dd data-testid="billing-saved">{details ? money(details.savedThisMonth.minor, details.savedThisMonth.currency) : "—"}
          <span class="sub">{t("The {fee}% Docustay fee you'd have paid on Free. Stripe's own fees still apply.", { fee: ((st?.plans ?? []).find((p) => p.key === "docustay_free")?.feeBps ?? 0) / 100 })}</span></dd></div>
{/snippet}
<section class="plan-panel" aria-label={t("Your plan")} data-testid="billing-strip">
  <div class="top">
    <PlanPiece plan={short} size={150} glow testid="plan-piece-current" />
    <div class="min-w-0">
      <span class="tag" data-testid="billing-your-plan-tag">{t("Your plan")}</span>
      <h2 class="name" data-testid="billing-plan-name">{st?.plan?.name}{#if price}<span class="price">{price}</span>{/if}</h2>
      <p class="mt-1 text-[15px] text-mute" data-testid={isFree ? "billing-on-free" : "billing-on-pro"}>{line}</p>
    </div>
  </div>
  <dl class="facts">
    {#if !isFree}
      <div class="fact"><dt>{next.label}</dt><dd data-testid="billing-next">{next.value}</dd></div>
      {#if details?.accountCreditMinor > 0}<div class="fact"><dt>{t("Account credit")}</dt><dd data-testid="billing-credit">{money(details.accountCreditMinor, details.nextPayment?.currency ?? "usd")}
          <span class="sub">{t("Used first on your next invoices, so they may come to less than the amount above.")}</span></dd></div>{/if}
      {#if isLife}{@render saved()}{/if}
      {#if !isLife}
        <div class="fact"><dt>{t("Card on file")}</dt>
          <dd><span class="tabular-nums" data-testid="billing-card">{card ? `${brandName(card.brand)} ${cardText(card)}`.trim() : "—"}</span>
            {#if card && expired}<StatusChip tone="bad" class="ml-2">{t("Card expired")}</StatusChip>{:else if card && declined}<StatusChip tone="bad" class="ml-2">{t("Declined")}</StatusChip>{/if}
            {#if st?.billing?.canManage}<button class="link" disabled={busy} onclick={onPortal} data-testid="billing-portal">{t("Update your card in the billing portal")} →</button>{/if}</dd></div>
        {#if short === "pro"}{@render saved()}{/if}
      {/if}
    {:else}
      <div class="fact"><dt>{t("Fee on payments")}</dt><dd>{t("{n}%", { n: ((st?.plans ?? []).find((p) => p.key === key)?.feeBps ?? 0) / 100 })}</dd></div>
    {/if}
    <div class="fact"><dt>{t("Signers")}</dt><dd data-testid="billing-signers-line">{signersLine}{#if u.signersLimit != null}<span class="sub">{t("Sending again to someone you already sent to this month is free and always allowed.")}</span>{/if}</dd></div>
    <div class="fact"><dt>{t("New templates")}</dt><dd data-testid="billing-templates-line">{templatesLine}</dd></div>
    <div class="fact"><dt>{t("Team members")}</dt><dd data-testid="billing-people">{peopleRule}{#if people}<span class="sub">{people} {seatPrice}</span>{/if}</dd></div>
  </dl>
  {#if st?.words && !st.words.newLimitsStarted && (short === "free" || short === "payg")}<p class="text-sm text-mute mt-3" data-testid="billing-new-limits">{st.words.grandfather}</p>{/if}
  <ul class="charge-words" data-testid="billing-charge-words">{#each chargeWords(short, (st?.plans ?? []).find((p) => p.key === "docustay_payg")?.priceMinor) as w}<li>{w}</li>{/each}</ul>
  <div class="actions">
    {#if canSwitch && switchTo}<button class="btn" disabled={busy} onclick={() => onSwitch(switchTo)} data-testid="billing-switch-open">{switchTo === "pro" ? t("Switch to Pro") : t("Switch to Pay as you go")}</button>{/if}
    {#if !isLife}<a class="btn quiet" href={EXPLORE_PRO_URL} target="_blank" rel="noopener">{t("See everything Pro adds")}</a>{/if}
  </div>
</section>
<style>
  .charge-words { list-style: none; margin: 1rem 0 0; padding: 0; display: grid; gap: .3rem; font-size: 12.5px; line-height: 1.45; color: var(--mute, #667085); }
  .plan-panel { background: color-mix(in srgb, var(--brand) 6%, var(--card)); border: 1px solid var(--line); border-radius: 14px; padding: 26px 30px; min-width: 0; }
  .top { display: flex; gap: 26px; align-items: center; }
  .top :global(.pp) { margin: 8px 6px 8px 0; }
  .tag { display: inline-block; font-size: 11px; letter-spacing: .06em; text-transform: uppercase; font-weight: 600; color: var(--brand); background: var(--brand-soft); border: 1px solid var(--accent-line, var(--line)); border-radius: 999px; padding: 2px 9px; }
  .name { margin-top: 8px; font-size: 28px; line-height: 1.15; font-weight: 600; letter-spacing: -.02em; }
  .price { margin-left: 10px; font-size: 16px; font-weight: 500; color: var(--mute); letter-spacing: 0; }
  .facts { margin-top: 20px; border-top: 1px solid var(--line); }
  .fact { display: grid; grid-template-columns: minmax(8.5rem, 11rem) minmax(0, 1fr); gap: 4px 16px; padding: 11px 0; border-bottom: 1px solid var(--line); font-size: 14.5px; }
  .fact dt { color: var(--mute); } .fact dd { min-width: 0; font-weight: 500; }
  .sub { display: block; font-weight: 400; font-size: 12.5px; color: var(--mute); margin-top: 2px; }
  .link { display: block; margin-top: 3px; font-size: 12.5px; font-weight: 400; color: var(--brand); text-decoration: underline; text-align: left; min-height: 0; padding: 2px 0; }
  .actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 18px; }
  @media (max-width: 640px) { .plan-panel { padding: 20px 18px; } .top { flex-direction: column; align-items: flex-start; gap: 6px; } .fact { grid-template-columns: 1fr; } .name { font-size: 24px; } }
</style>
