<script>
  // "YOUR STRIPE ACCOUNT" (Billing > Payments, top; STRIPE-PAYMENTS-SPEC.md 21 Oct 2026). Everything here is what Stripe says or what Docustay holds; nothing sensitive is ever shown (a bank is its name and last 4).
  // States: not connected (the hero and the wizard), Ready, Needs attention, Verifying, Restricted, Paused by you, Disconnected. A Member sees only who to ask. The Payments list below this is the existing screen.
  import { onMount } from "svelte";
  import { api, money } from "$lib/api.js";
  import { live } from "$lib/live.js";
  import { t, i18n } from "$lib/i18n/index.svelte.js";
  import { edition } from "$lib/edition.svelte.js";
  import { ask } from "$lib/ui/confirm.svelte.js";
  import { inDemo } from "$lib/pro/plan.svelte.js";
  import StatusChip from "$lib/ui/StatusChip.svelte";
  import CopyButton from "$lib/ui/CopyButton.svelte";
  import { PayCard3D } from "$lib/fx3d/index.js";
  import StripeBadge from "./StripeBadge.svelte";
  let a = $state(null), pay = $state(null), managers = $state([]), problem = $state(null), note = $state(null), busy = $state(false), loaded = $state(false);
  const flag = typeof location !== "undefined" ? new URLSearchParams(location.search).get("payments") : null;
  const FLAGS = $derived({ live: t("Stripe is connected and can take payments."), connected: t("Stripe is connected and can take payments."), needs_info: t("Stripe needs more information before payments can start. Continue on Stripe to finish."), pending: t("Stripe is still checking your details."), restricted: t("Stripe needs more information before payments can start. Continue on Stripe to finish."), declined: t("Nothing was connected. You can start again any time."), error: t("Stripe could not be reached. Try again in a moment.") });
  const isMember = $derived(edition.rank === "member");
  const TONE = { ready: "ok", needs_attention: "warn", verifying: "mute", restricted: "bad", paused: "warn", disconnected: "mute", not_connected: "mute" };
  const STATUS = $derived({ ready: t("Ready"), needs_attention: t("Needs attention"), verifying: t("Verifying"), restricted: t("Restricted"), paused: t("Paused by you"), disconnected: t("Disconnected"), not_connected: t("Not connected") });
  const day = (iso) => (iso ? new Date(iso).toLocaleDateString(i18n.lang, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "—");
  const cash = (minor, cur) => (minor == null ? "—" : money(minor, cur ?? a?.money?.currency ?? "usd"));
  async function load(fresh = false) {
    if (await inDemo()) { a = { status: "not_connected", demo: true }; loaded = true; return; }   // the demo has no Stripe
    if (isMember) { const r = await api("/api/product/docustay/payments/managers"); if (r.ok) managers = (r.json?.data ?? r.json)?.managers ?? []; loaded = true; return; }
    const [r, p] = await Promise.all([api(`/api/product/docustay/payments/account${fresh ? "?fresh=1" : ""}`), api("/api/product/docustay/payments")]);
    loaded = true; if (p.ok) pay = p.json?.data ?? p.json;
    if (r.ok) { a = r.json?.data ?? r.json; problem = null; } else problem = r.error ?? t("Your Stripe account could not be loaded.");
  }
  onMount(() => { load(); if (flag && FLAGS[flag]) note = FLAGS[flag]; if (flag) history.replaceState(null, "", "?tab=payments"); return live(["billing", "settings"], () => load()); });
  const go = (url) => { location.href = url; };
  async function post(path, body = {}) { busy = true; note = null; const r = await api(path, { method: "POST", body }); busy = false; return r; }
  async function updateDetails() { const r = await post("/api/product/docustay/payments/update-link"); if (r.ok && (r.json?.data ?? r.json)?.url) go((r.json?.data ?? r.json).url); else note = r.error ?? t("Stripe could not be reached. Try again."); }
  async function continueOnStripe() { if (a?.connectState === "live") return updateDetails(); const r = await post("/api/product/docustay/payments/connect", { method: "hosted" }); const u = r.json?.data ?? r.json; if (r.ok && u?.url) go(u.url); else note = r.error ?? t("Stripe could not be reached. Try again."); }
  async function checkAgain() { const r = await post("/api/product/docustay/payments/refresh"); if (r.ok) { await load(true); note = null; } else note = r.error ?? t("Stripe could not be reached. Try again."); }
  async function connectExisting() { const r = await post("/api/product/docustay/payments/connect", { method: "oauth" }); const u = r.json?.data ?? r.json; if (r.ok && u?.url) go(u.url); else note = r.error ?? t("Stripe could not be reached. Try again."); }
  async function takePayments(on) {
    if (!on && !(await ask(t("Pause payments? Payment boxes will say payments are paused, and people can still sign. Nothing is refunded. You can turn payments back on here at any time."), { yes: t("Pause payments") }))) return;
    const r = await post("/api/product/docustay/payments/settings", { paused: !on }); if (r.ok) { await load(true); note = on ? t("Payments are on again.") : t("Payments are paused."); } else note = r.error ?? t("That did not save.");
  }
  async function receipt(on) { const r = await post("/api/product/docustay/payments/settings", { sendOwnReceipt: on }); if (r.ok) await load(true); else note = r.error ?? t("That did not save."); }
  async function disconnect() {
    if (!(await ask(t("Docustay will no longer have access to a Stripe account. Documents with a payment box cannot be paid until you connect again. Your Stripe account itself is untouched. It is still yours."), { danger: true, yes: t("Disconnect Stripe") }))) return;
    const r = await post("/api/product/docustay/payments/disconnect"); if (r.ok) { await load(true); note = t("Disconnected. Your Stripe account itself is untouched. It is still yours."); } else note = r.error ?? t("That did not save.");
  }
  const connected = $derived(Boolean(a?.account) && !["not_connected", "disconnected"].includes(a?.status ?? ""));
  const fresh = $derived(a && !connected);
</script>
<section class="sa" aria-label={t("Your Stripe account")} data-testid="stripe-account" data-status={a?.status ?? "loading"}>
  {#if !loaded}<p class="text-mute" data-testid="stripe-loading">{t("Loading…")}</p>
  {:else if isMember}
    <div class="panel" data-testid="stripe-member">
      <h2 class="h">{t("Billing and payments are managed by Admins and Owners")}</h2>
      <p class="mt-2 text-[15px] text-mute">{t("Ask one of them to set up payments, change them or add a payment box to a document.")}</p>
      <ul class="mt-3 grid gap-1.5" data-testid="stripe-managers">{#each managers as m (m.name + m.role)}<li class="flex items-center gap-2 text-[14px]"><span class="font-medium">{m.name}</span><span class="chip">{m.role === "owner" ? t("Owner") : t("Admin")}</span></li>{/each}</ul>
    </div>
  {:else if problem}<p class="text-bad" role="alert" data-testid="stripe-problem">{problem}</p>
  {:else if a?.demo}<div class="panel"><h2 class="h">{t("Get paid with Stripe")}</h2><p class="mt-2 text-mute">{t("The demo has no Stripe account. In a real workspace you connect Stripe here and signers pay as they sign.")}</p></div>
  {:else if a}
    {#if a.mode === "test"}<p class="test" data-testid="payments-test-mode">{t("This server is in Stripe's test mode: no real card is charged and nothing here moves real money. Stripe's test cards work, for example 4242 4242 4242 4242.")}</p>{/if}
    {#if note}<p class="note" role="status" data-testid="payments-note">{note}</p>{/if}
    {#if fresh}
      <div class="hero" data-testid="stripe-hero">
        <div class="min-w-0">
          <h2 class="h" data-testid="stripe-title">{a.status === "disconnected" ? t("Stripe is disconnected") : t("Get paid with Stripe")}</h2>
          <p class="mt-2 max-w-[52ch] text-[15px]">{a.status === "disconnected" ? t("Docustay no longer has access to a Stripe account. Your history stays visible below. Documents with a payment box cannot be paid until you connect again.") : t("Add a payment box to a document and the signer pays as the last step of signing. The money goes straight to a Stripe account in your name. Docustay never holds it.")}</p>
          <p class="mt-2 text-[13px] text-mute" data-testid="payments-fee">{t("Docustay takes {fee}% on payments on your plan. Stripe's own fees apply.", { fee: a.fee.percent })}</p>
          <div class="mt-4 flex flex-wrap items-center gap-3">
            <a class="btn primary" href="/billing/payments/setup" data-testid="stripe-setup" aria-disabled={pay && !pay.connectReady ? "true" : undefined}>{a.status === "disconnected" ? t("Reconnect Stripe") : t("Set up payments")}</a>{#if pay?.oauthAvailable && a.status !== "disconnected"}<span class="chip ok" data-testid="payments-recommended">{t("Recommended")}</span>{/if}
            {#if pay?.oauthAvailable}<button class="btn" disabled={busy || !pay?.connectReady} onclick={connectExisting} data-testid="payments-connect-existing">{t("I already have a Stripe account. Connect it instead.")}</button>{/if}
          </div>
          {#if pay && !pay.connectReady}<p class="mt-2 text-sm text-mute" data-testid="payments-not-ready">{t("Connecting is not switched on for this server yet. Ask the person who runs it.")}</p>{/if}
          <p class="mt-3"><StripeBadge /></p>
        </div>
        <div class="card3d" aria-hidden="true"><PayCard3D note={t("Paid as they sign")} amount="" /></div>
      </div>
    {:else}
      {#if a.attention}
        <div class="banner {a.status === 'restricted' ? 'bad' : 'warn'}" role="alert" data-testid="stripe-banner">
          <div class="min-w-0">
            <p class="font-semibold">{a.status === "restricted" ? t("Stripe has restricted your account") : t("Stripe needs a little more from you")}</p>
            {#if a.attention.why}<p class="mt-0.5 text-[14px]">{a.attention.why}</p>{/if}
            {#if a.attention.items.length}<ul class="mt-1 list-disc pl-5 text-[14px]" data-testid="stripe-needs">{#each a.attention.items as it (it)}<li>{it}</li>{/each}</ul>{/if}
            {#if a.attention.deadline}<p class="mt-1 text-[13px]" data-testid="stripe-deadline">{t("Deadline: {date}", { date: day(a.attention.deadline) })}{#if a.attention.daysLeft != null && a.attention.daysLeft >= 0} · {t("{n, plural, one {# day left} other {# days left}}", { n: a.attention.daysLeft })}{/if}</p>{/if}
            {#if a.attention.payoutsPause}<p class="text-[13px]">{a.attention.payoutsPause}</p>{/if}
          </div>
          <button class="btn primary" disabled={busy} onclick={continueOnStripe} data-testid="stripe-continue">{t("Continue on Stripe")}</button>
        </div>
      {:else if a.status === "verifying"}
        <div class="banner" role="status" data-testid="stripe-verifying"><div><p class="font-semibold">{t("Stripe is verifying you")}</p><p class="text-[14px]">{t("This usually takes a few minutes, and sometimes up to a day. You do not need to wait here. We will email you the moment it is done.")}</p></div><button class="btn" disabled={busy} onclick={checkAgain} data-testid="payments-refresh">{t("Check again")}</button></div>
      {/if}
      {#if a.status === "paused"}<div class="banner warn" data-testid="stripe-paused"><p>{t("Payments are paused. Payment boxes say so, and people can still sign. Nothing was refunded.")}</p><button class="btn" disabled={busy} onclick={() => takePayments(true)}>{t("Turn payments on")}</button></div>{/if}
      <header class="head">
        <div class="flex min-w-0 flex-wrap items-center gap-3"><h2 class="h" data-testid="stripe-title">{t("Your Stripe account")}</h2><StatusChip tone={TONE[a.status]} live={a.status === "verifying"}><span data-testid="stripe-status">{STATUS[a.status]}</span></StatusChip></div>
        <div class="flex flex-wrap gap-2"><a class="btn" href={a.dashboardUrl} target="_blank" rel="noopener" data-testid="stripe-open">{t("Open your Stripe account")} ↗</a><button class="btn" disabled={busy} onclick={updateDetails} data-testid="stripe-update">{t("Update details at Stripe")}</button></div>
      </header>
      <div class="grid2">
        <div class="panel tint" data-testid="stripe-panel">
          <div class="chips"><span class="mini" data-testid="chip-charges"><i class="d {a.panel?.charges ? 'ok' : 'off'}"></i>{t("Charges")} {a.panel?.charges ? t("On") : t("Off")}</span><span class="mini" data-testid="chip-payouts"><i class="d {a.panel?.payouts ? 'ok' : 'off'}"></i>{t("Payouts")} {a.panel?.payouts ? t("On") : t("Off")}</span><span class="mini" data-testid="chip-verification"><i class="d {a.panel?.verification === 'verified' ? 'ok' : 'off'}"></i>{t("Verification")} {a.panel?.verification === "verified" ? t("Complete") : a.panel?.verification === "pending" ? t("Checking") : t("Needed")}</span></div>
          <dl class="kv">
            <div><dt>{t("Business")}</dt><dd>{a.panel?.business ?? "—"}</dd></div><div><dt>{t("Type")}</dt><dd>{a.panel?.type ?? "—"}</dd></div>
            <div><dt>{t("Website")}</dt><dd class="truncate">{a.panel?.website ?? "—"}</dd></div><div><dt>{t("Support email on receipts")}</dt><dd class="truncate">{a.panel?.supportEmail ?? "—"}</dd></div>
            <div><dt>{t("Country and currency")}</dt><dd>{[a.panel?.country, a.panel?.currency].filter(Boolean).join(" · ") || "—"}</dd></div>
            <div><dt>{t("Account")}</dt><dd class="flex items-center gap-1"><span class="font-mono text-[13px]" data-testid="stripe-account-id">{a.account.masked}</span><CopyButton value={a.account.id} testid="stripe-copy" /></dd></div>
            <div><dt>{t("Connected")}</dt><dd>{day(a.panel?.connectedAt)}{#if a.panel?.connectedBy}{" · "}{a.panel.connectedBy}{/if}<span class="block text-[12px] text-mute">{a.panel?.how}</span></dd></div>
          </dl>
          <div class="cardpiece" aria-hidden="true"><PayCard3D note={a.panel?.business ?? ""} amount="" /></div>
        </div>
        <div class="stack">
          <div class="panel" data-testid="stripe-money">
            <h3 class="h3">{t("Payouts and balance")}</h3>
            {#if a.stripeError && !a.money}<p class="mt-2 text-sm text-mute" data-testid="stripe-unreachable">{t("Stripe did not answer just now. What is shown comes from what Docustay last knew. Try again in a moment.")}</p>{/if}
            {#if a.money}
              <div class="nums"><div><span class="lab">{t("Available")}</span><b data-testid="stripe-available">{cash(a.money.availableMinor)}</b></div><div><span class="lab">{t("Pending")}</span><b data-testid="stripe-pending">{cash(a.money.pendingMinor)}</b></div></div>
              <dl class="kv one">
                <div><dt>{t("Next payout")}</dt><dd data-testid="stripe-next-payout">{#if a.money.next}{cash(a.money.next.amountMinor, a.money.next.currency)} · {day(a.money.next.arrivalAt)}{#if a.money.bank} · {a.money.bank.name ?? t("your bank")} ••{a.money.bank.last4}{/if}{:else}—{/if}</dd></div>
                <div><dt>{t("Last payout")}</dt><dd data-testid="stripe-last-payout">{#if a.money.last}{cash(a.money.last.amountMinor, a.money.last.currency)} · {day(a.money.last.at)} · {a.money.last.status === "paid" ? t("Paid") : t("Failed")}{:else}—{/if}</dd></div>
                <div><dt>{t("Schedule")}</dt><dd>{a.money.schedule ?? "—"}</dd></div>
              </dl>
            {/if}
            <p class="mt-3 text-[13px]"><button type="button" class="lnk" onclick={updateDetails} data-testid="stripe-bank-link">{t("Change your bank or payout schedule at Stripe")} →</button></p>
          </div>
        </div>
      </div>
      <div class="grid2">
        <div class="panel" data-testid="stripe-settings">
          <h3 class="h3">{t("Settings for this workspace")}</h3>
          <div class="row"><div><p class="font-medium">{t("Take payments")}</p><p class="text-[13px] text-mute">{t("Off: payment boxes say payments are paused. People can still sign. Nothing is refunded.")}</p></div>
            <label class="sw"><input type="checkbox" role="switch" checked={!a.settings.paused} disabled={busy} onchange={(e) => takePayments(e.currentTarget.checked)} data-testid="stripe-take-payments" /><span class="sr-only">{t("Take payments")}</span></label></div>
          <div class="row"><div><p class="font-medium">{t("Who can add a payment box")}</p><p class="text-[13px] text-mute">{t("Admins and Owners. This is fixed.")}</p></div><span class="chip">{t("Admins and Owners")}</span></div>
          <div class="row"><div><p class="font-medium">{t("Also send a receipt from Docustay")}</p><p class="text-[13px] text-mute" data-testid="payments-receipts">{t("Stripe already emails a receipt, so signers may get two.")}</p></div>
            <label class="sw"><input type="checkbox" role="switch" checked={a.settings.sendOwnReceipt} disabled={busy} onchange={(e) => receipt(e.currentTarget.checked)} data-testid="stripe-receipt" /><span class="sr-only">{t("Also send a receipt from Docustay")}</span></label></div>
          <p class="mt-3 text-[13px] text-mute" data-testid="payments-fee">{t("Docustay takes {fee}% on payments on {plan}. Stripe's own fees apply.", { fee: a.fee.percent, plan: a.fee.planName ?? t("your plan") })}</p>
        </div>
        <div class="stack">
          <div class="panel" data-testid="stripe-activity"><h3 class="h3">{t("Activity")}</h3>
            {#if a.activity.length}<ul class="act">{#each a.activity as e, i (i)}<li><span>{e.text}{#if e.who} <span class="text-mute">· {e.who}</span>{/if}</span><time class="text-mute">{day(e.at)}</time></li>{/each}</ul>{:else}<p class="mt-2 text-sm text-mute">{t("Nothing yet. Changes to your payments appear here.")}</p>{/if}</div>
          <div class="panel" data-testid="stripe-help"><h3 class="h3">{t("Help")}</h3>
            <details class="qa"><summary>{t("Why does Stripe need my details?")}</summary><p>{t("Stripe is a regulated payment company. It has to know who it pays. Docustay never sees your ID or bank details; Stripe collects them.")}</p></details>
            <details class="qa"><summary>{t("When do I get paid?")}</summary><p>{t("Stripe pays your bank on the schedule shown under Payouts and balance. You can change it at Stripe.")}</p></details>
            <p class="mt-2 text-[13px]"><a class="lnk" href="mailto:hello@docustay.app">{t("Contact support")}</a></p></div>
        </div>
      </div>
      <p class="mt-4"><StripeBadge /></p>
      <p class="mt-6 text-[13px]"><button type="button" class="lnk bad" disabled={busy} onclick={disconnect} data-testid="payments-disconnect">{t("Disconnect Stripe")}</button></p>
    {/if}
  {/if}
</section>
<style>
  .sa { display: grid; gap: 14px; margin-bottom: 28px; min-width: 0; }
  .h { font-size: 19px; font-weight: 600; letter-spacing: -.01em; } .h3 { font-size: 15px; font-weight: 600; }
  .panel { border: 1px solid var(--line); border-radius: 14px; background: var(--card); padding: 20px 22px; min-width: 0; }
  .panel.tint { background: color-mix(in srgb, var(--brand) 6%, var(--card)); }
  .hero { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 18rem); gap: 28px; align-items: center; border: 1px solid var(--line); border-radius: 16px; padding: 28px; background: color-mix(in srgb, var(--brand) 5%, var(--card)); }
  .card3d { min-width: 0; }
  .head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; }
  .grid2 { display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr); gap: 14px; align-items: start; }
  .stack { display: grid; gap: 14px; min-width: 0; }
  .chips { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 14px; }
  .mini { display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; border: 1px solid var(--line); border-radius: 999px; padding: 3px 10px; background: var(--card); }
  .d { width: 7px; height: 7px; border-radius: 50%; background: var(--faint); } .d.ok { background: var(--ok); } .d.off { background: var(--warn); }
  .kv { display: grid; gap: 0; } .kv > div { display: grid; grid-template-columns: minmax(8rem, 11rem) minmax(0, 1fr); gap: 4px 14px; padding: 9px 0; border-top: 1px solid var(--line); font-size: 14px; } .kv dt { color: var(--mute); } .kv dd { min-width: 0; font-weight: 500; }
  .kv.one > div:first-child { border-top: 0; }
  .nums { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin: 12px 0; } .nums .lab { display: block; font-size: 12px; color: var(--mute); } .nums b { font-size: 22px; font-weight: 600; letter-spacing: -.02em; font-variant-numeric: tabular-nums; }
  .cardpiece { max-width: 15rem; margin-top: 18px; }
  .banner { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 14px; border: 1px solid var(--line); border-radius: 12px; padding: 14px 18px; background: var(--card); }
  .banner.warn { border-color: var(--warn-line, #e8c36a); background: var(--warn-bg, #fff8e6); } .banner.bad { border-color: var(--bad-line, #e3a4a4); background: var(--bad-bg, #fdeeee); }
  .test { border: 1px solid var(--warn-line, #e8c36a); background: var(--warn-bg, #fff8e6); border-radius: 10px; padding: 8px 12px; font-size: 14px; }
  .note { font-size: 14px; border-left: 3px solid var(--brand); padding: 4px 12px; }
  .row { display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 12px 0; border-top: 1px solid var(--line); } .h3 + .row { border-top: 0; }
  .sw input { appearance: none; width: 42px; height: 24px; border-radius: 999px; background: var(--line-strong, #cfcbe6); position: relative; cursor: pointer; transition: background .15s; min-height: 24px; }
  .sw input::after { content: ""; position: absolute; top: 3px; left: 3px; width: 18px; height: 18px; border-radius: 50%; background: #fff; transition: transform .15s; }
  .sw input:checked { background: var(--brand); } .sw input:checked::after { transform: translateX(18px); } .sw input:focus-visible { outline: 2px solid var(--brand); outline-offset: 2px; }
  .act { display: grid; gap: 0; margin-top: 8px; } .act li { display: flex; justify-content: space-between; gap: 12px; padding: 8px 0; border-top: 1px solid var(--line); font-size: 13.5px; } .act li:first-child { border-top: 0; }
  .qa { border-top: 1px solid var(--line); padding: 8px 0; font-size: 14px; } .qa summary { cursor: pointer; font-weight: 500; min-height: 28px; } .qa p { margin-top: 4px; color: var(--mute); }
  .lnk { color: var(--brand); text-decoration: underline; text-underline-offset: 2px; background: none; border: 0; padding: 4px 0; cursor: pointer; min-height: 0; text-align: left; } .lnk.bad { color: var(--bad); }
  @media (max-width: 820px) { .hero, .grid2 { grid-template-columns: minmax(0, 1fr); } .kv > div { grid-template-columns: 1fr; } .head .btn { flex: 1 1 100%; min-height: 44px; justify-content: center; } .banner .btn { flex: 1 1 100%; min-height: 44px; } .hero .btn { min-height: 44px; } }
</style>
