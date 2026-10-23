<script>
  // THE ONE PLAN PROMPT (Part 2, 19 Oct 2026). Three forms of the same thing, all fed by the server's answer (preflight or a refusal's options), none knowing a price:
  //   note   a quiet line next to the control ("Adds $5 a month once they accept and join", "This is your last free document this month"). Gives a charge before it happens; warns once per meter per period at 80 percent;
  //          never before the first sent document; the person can dismiss it and it stays dismissed for the period; at most one prompt on a screen.
  //   sheet  what you hit, where you stand, your options with their prices (cheapest first) and a quiet "Not now". Opened by PlanSheetHost for any refusal.
  //   lock   the same sheet for a plan-bound feature: what it does and which plans have it.
  // Give it an `action` (and its `size`/`item`) and it asks the preflight itself, again whenever `watch` changes; or give it an `answer`.
  import { onMount, tick, untrack } from "svelte";
  import { goto } from "$app/navigation";
  import Icon from "$lib/ui/Icon.svelte";
  import { t } from "$lib/i18n/index.svelte.js";
  import { api } from "$lib/api.js";
  import { plan, loadPlan, EXPLORE_PRO_URL } from "./plan.svelte.js";
  import { usd } from "./money.js";
  import { openUpgrade } from "./proSheet.svelte.js";
  import { askPreflight, kindOf, claimScreen, releaseScreen, screenHolder, beforeFirstSend, isDismissed, rememberDismissed, report, showPlanSheet, closePlanSheet } from "./planPrompt.svelte.js";
  let { action = null, size = {}, item = null, answer: given = null, form = "note", id = "", watch = null, kinds = ["blocked", "price", "soft"], class: cls = "", ctx = null, onclose = null } = $props();
  const me = id || `p${Math.random().toString(36).slice(2, 8)}`;
  let fetched = $state(null), seq = 0, version = $state(0), busy = $state(false), problem = $state(null), card = $state(null), opener = null;
  const ans = $derived(given ?? fetched);
  const kind = $derived(kindOf(ans));
  const charges = $derived(kinds.includes("price") && ((ans?.cost?.minor ?? 0) > 0 || (ans?.cost?.feePercent ?? 0) > 0));   // this answer puts a price on the action
  onMount(() => { loadPlan(); });

  // ── the note ──
  $effect(() => {
    if (!action || given) return;
    void watch; const body = JSON.stringify(size); void body; const mine = ++seq;
    const h = setTimeout(async () => { const a = await askPreflight(action, size, item); if (mine === seq) fetched = a; }, 150);
    return () => clearTimeout(h);
  });
  const wants = $derived.by(() => {
    void version;
    if (form !== "note" || !ans || kind === "none") return false;
    if (charges) return true;   // a charge is never hidden, and never dismissed
    if (!kinds.includes(kind)) return false;
    if (kind === "price" || kind === "info") return true;   // a plain usage line asks for nothing
    if (!plan.loaded || beforeFirstSend()) return false;   // no warning and no pre-click nudge before the first sent document; a refusal the person causes by acting still opens the sheet
    return kind === "blocked" || !isDismissed(ans);
  });
  let held = $state(false);
  // one prompt a screen: claim it while this one is wanted, let go when it is not (untracked: claiming writes the very state this effect would otherwise watch, and looped)
  $effect(() => {
    if (!wants) { untrack(() => { releaseScreen(me); held = false; }); return; }
    untrack(() => { held = claimScreen(me); });
    return () => untrack(() => releaseScreen(me));
  });
  $effect(() => { const free = screenHolder() == null; if (wants && free && !untrack(() => held)) untrack(() => { held = claimScreen(me); }); });   // the screen's first prompt went away: take its place
  const show = $derived(wants && held);
  $effect(() => { if (show) report("prompt_shown", ans, { form: "note", once: true }); });
  const tone = $derived(kind === "blocked" ? "warn" : kind === "soft" ? (ans.severity === "info" ? "info" : "warn") : "info");
  function dismiss() { rememberDismissed(ans); report("prompt_dismissed", ans, { form: "note", option: "close" }); version++; }
  function seeOptions() { report("prompt_clicked", ans, { form: "note", option: "see_options" }); showPlanSheet(ans, { form: ans.reason === "plan_pro_required" ? "lock" : "sheet", ctx: ctx ?? (item ? { item } : null) }); }

  // ── the sheet and the lock ──
  const TITLE = $derived({
    plan_document_limit: t("You have reached your document limit"), budget_reached: t("Your monthly budget is reached"), plan_people_limit: t("Adding team members needs another plan"), plan_signer_limit: t("You have reached this month's limit of different signers"),
    plan_template_limit: t("You have made this month's new templates"), ai_limit_credits: t("You have used this month's AI drafts"), ai_limit_usd: t("You have used this month's AI drafts"),
    plan_pro_required: t("Not included in {plan}", { plan: ans?.plan?.name ?? "your plan" }), too_big: t("That file is too large"),
  });
  const title = $derived(form === "lock" ? t("Not included in {plan}", { plan: ans?.plan?.name ?? "your plan" }) : TITLE[ans?.reason] ?? (ans?.action === "connect_payments" ? t("The fee on payments") : t("Your options")));
  const standing = $derived.by(() => {
    const m = ans?.meter, resets = ans?.period?.resets; if (!m) return "";
    const r = resets ? ` · ${t("resets {date}", { date: resets })}` : "";
    if (m.key === "budget") return `${t("{used} of your {budget} budget used", { used: usd(m.usedMinor), budget: usd(m.budgetMinor) })}${r}`;
    if (m.key === "documents") return `${t("{used} of {n} documents used", { used: m.used, n: m.included })}${r}`;
    if (m.key === "people") return t("{used} of {n} people", { used: m.used, n: m.included });
    if (m.key === "drafts") return `${t("{used} of {n} AI drafts used", { used: Math.round(m.used * 100) / 100, n: m.included })}${r}`;
    if (m.key === "templates") return `${t("{used} of {n} new templates made", { used: m.used, n: m.included })}${r}`;
    if (m.key === "upload") return t("The most on {plan} is {n} MB", { plan: ans?.plan?.name ?? "", n: m.capMb });
    return "";
  });
  const perText = (o) => (o.priceMinor == null ? "" : o.priceMinor === 0 ? "" : `${usd(o.priceMinor)} ${o.per === "once" ? t("one time") : o.per === "month" ? t("a month") : o.per ? t("per {unit}", { unit: o.per.replace(/ a month$/, "") }) + (/ a month$/.test(o.per) ? ` ${t("a month")}` : "") : ""}`.trim());
  const options = $derived(ans?.options ?? []);
  const doable = $derived(options.filter((o) => o.key !== "wait"));
  const wait = $derived(options.find((o) => o.key === "wait"));
  $effect(() => { if (form !== "note" && ans) { opener = document.activeElement; report("prompt_shown", ans, { form }); tick().then(() => card?.querySelector("[data-autofocus]")?.focus()); } });
  function shut(how) { report("prompt_dismissed", ans, { form, option: how }); finish(); }
  function finish() { (onclose ?? closePlanSheet)(); tick().then(() => { if (opener instanceof HTMLElement && document.contains(opener)) opener.focus(); }); }
  const itemFor = () => ctx?.item ?? ({ plan_document_limit: "document_limit", plan_template_limit: "template_limit", plan_people_limit: "team_roles", plan_signer_limit: "signer_limit" })[ans?.reason] ?? null;
  async function choose(o) {
    report("prompt_clicked", ans, { form, option: o.key });
    const onFree = ans?.plan?.key === "free";
    if (o.key === "wait") return finish();
    if (o.key === "raise_budget") { finish(); goto("/billing#billing-budget"); return; }
    if (o.key === "pro") { finish(); if (onFree) openUpgrade(itemFor()); else goto("/billing"); return; }
    if (!onFree) { finish(); goto("/billing"); return; }   // a paid workspace changes plan on the billing page, where the proration is shown
    busy = true; problem = null;
    try { sessionStorage.setItem("docustay:upgrade-from", location.pathname + location.search); } catch { /* the welcome screen then offers the documents list */ }
    const r = await api("/api/product/docustay/checkout", { method: "POST", body: { plan: o.key } });
    const url = r.json?.url ?? r.json?.data?.url;
    if (r.ok && url) { window.location.assign(url); return; }
    busy = false; problem = r.error ?? t("That did not work. Try again.");
  }
  function key(e) {
    if (form === "note" || !ans) return;
    if (e.key === "Escape") { e.preventDefault(); shut("close"); return; }
    if (e.key === "Tab" && card) {
      const f = [...card.querySelectorAll("button:not([disabled]), a[href]")]; if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }
</script>
<svelte:window onkeydown={key} />
{#if form === "note"}
  {#if show && ans.message}
    <div class="notice {tone} plan-note {cls}" role="status" data-testid="plan-note" data-kind={kind} data-severity={ans.severity} data-action={ans.action} data-meter={ans.meter?.key ?? ""} data-reason={ans.reason ?? ""}>
      <span class="msg" data-testid="plan-note-text">{ans.message}</span>
      {#if options.length}<button type="button" class="more" onclick={seeOptions} data-testid="plan-note-options">{t("See options")}</button>{/if}
      {#if kind === "soft" && !charges}<button type="button" class="x" aria-label={t("Dismiss")} onclick={dismiss} data-testid="plan-note-dismiss"><Icon name="close" size={14} /></button>{/if}
    </div>
  {/if}
{:else if ans}
  <div class="fixed inset-0 z-[90] flex items-end justify-center bg-black/40 sm:items-center sm:p-4" role="presentation" onpointerdown={(e) => { if (e.target === e.currentTarget && !busy) shut("close"); }}>
    <div bind:this={card} class="max-h-[92dvh] w-full max-w-[560px] overflow-y-auto overscroll-contain rounded-t-2xl bg-card text-ink shadow-[0_30px_80px_rgb(30_20_70/.3)] sm:rounded-2xl" role="dialog" aria-modal="true" aria-labelledby="pp-title" aria-describedby="pp-msg"
      data-testid={form === "lock" ? "plan-lock" : "plan-sheet"} data-reason={ans.reason ?? ""} data-severity={ans.severity} data-action={ans.action}>
      <div class="flex items-start justify-between gap-3 px-6 pt-5">
        <div class="min-w-0">
          {#if standing}<p class="text-xs text-mute" data-testid="plan-standing">{standing}</p>{/if}
          <h2 id="pp-title" class="mt-1 text-xl font-semibold">{title}</h2>
        </div>
        <button type="button" class="btn quiet !min-h-9 !px-2" aria-label={t("Close")} onclick={() => shut("close")} data-testid="plan-sheet-close"><Icon name="close" size={16} /></button>
      </div>
      {#if ans.message}<p id="pp-msg" class="px-6 pt-2 text-[15px] text-mute" data-testid="plan-message">{ans.message}</p>{/if}
      {#if doable.length}
        <ul class="grid gap-3 px-6 py-4" aria-label={t("Your options")}>
          {#each doable as o, i (o.key)}
            <li class="rounded-xl border p-4 {i === 0 ? 'border-brand' : 'border-line'}" data-testid="plan-option" data-option={o.key}>
              <div class="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <p class="font-semibold">{o.label}{#if o.founders} <span class="ml-1 rounded-full bg-brand-soft px-2 py-0.5 text-[11px] font-medium text-brand">{t("Founders price")}</span>{/if}</p>
                {#if perText(o)}<p class="text-sm text-mute" data-testid="plan-option-price">{perText(o)}</p>{/if}
              </div>
              {#if o.unlocks?.length}<ul class="mt-2 space-y-1 text-sm text-mute">{#each o.unlocks as u}<li class="flex gap-2"><span class="mt-0.5 text-brand" aria-hidden="true"><Icon name="check" size={14} /></span>{u}</li>{/each}</ul>{/if}
              <button type="button" class="btn {i === 0 ? 'primary' : ''} mt-3" data-autofocus={i === 0 ? "" : undefined} disabled={busy} onclick={() => choose(o)} data-testid="plan-option-go">{o.label}</button>
            </li>
          {/each}
        </ul>
      {/if}
      {#if problem}<p class="mx-6 mb-2 text-sm text-bad" role="alert" data-testid="plan-problem">{problem}</p>{/if}
      <div class="flex flex-wrap items-center gap-3 border-t border-line px-6 py-4">
        <button type="button" class="btn quiet" data-autofocus={doable.length ? undefined : ""} onclick={() => shut("not_now")} data-testid="plan-notnow">{wait ? wait.label : t("Not now")}</button>
        {#if doable.length}<a class="ml-auto text-sm text-brand" href={EXPLORE_PRO_URL} target="_blank" rel="noopener">{t("Compare plans")} →</a>{/if}
      </div>
    </div>
  </div>
{/if}
<style>
  .plan-note { display: flex; align-items: flex-start; flex-wrap: wrap; gap: .25rem .75rem; }
  .plan-note .msg { flex: 1 1 18rem; min-width: 0; }
  .plan-note .more { background: none; border: 0; padding: 0; font: inherit; color: var(--brand); cursor: pointer; text-decoration: underline; text-underline-offset: 2px; min-height: 24px; }
  .plan-note .x { margin-left: auto; display: inline-grid; place-items: center; width: 28px; height: 28px; border: 0; background: transparent; color: inherit; border-radius: 6px; cursor: pointer; opacity: .75; }
  .plan-note .x:hover { opacity: 1; background: rgb(0 0 0 / .06); }
  .plan-note .more:focus-visible, .plan-note .x:focus-visible { outline: 2px solid var(--brand); outline-offset: 2px; }
</style>
