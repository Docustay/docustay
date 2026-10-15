<script>
  // NOTIFICATIONS (Run 9 board "Notifications"; ruling R9-k). The bell with its unread count, and the panel: tabs All / Signed / Forms / Limits, Mark all read, Settings. Each row is worded
  // here from the facts the server sends (src/product/docustayInbox.mjs), so it reads in the person's own language. Opening a row marks it read and goes to its document. The count is
  // refreshed by the one shared poller (inbox.svelte.js).
  import { Popover } from "@ark-ui/svelte/popover";
  import { Portal } from "@ark-ui/svelte/portal";
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";
  import { api } from "$lib/api.js";
  import { inbox, useCount } from "./inbox.svelte.js";
  import Icon from "$lib/ui/Icon.svelte";
  import { relativeTime } from "$lib/ui/relativeTime.js";
  import { t, i18n } from "$lib/i18n/index.svelte.js";
  import { exploreProFrom } from "$lib/pro/proSheet.svelte.js";
  let { compact = false } = $props();
  let open = $state(false), tab = $state("all"), data = $state(null), busy = $state(false), problem = $state(null);
  const unread = $derived(inbox.unread);
  const TABS = () => [["all", t("All")], ["signed", t("Signed")], ["forms", t("Forms")], ["limits", t("Limits")]];
  const ago = (iso) => relativeTime(iso, { locale: i18n.lang });
  // a calendar day ("2027-08-31") is shown as that day wherever the reader is; a moment keeps the reader's own zone
  const day = (iso) => (!iso ? "" : /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T12:00:00Z`).toLocaleDateString(i18n.lang, { day: "numeric", month: "long", timeZone: "UTC" }) : new Date(iso).toLocaleDateString(i18n.lang, { day: "numeric", month: "long" }));
  const money = (minor, cur) => { try { return new Intl.NumberFormat(i18n.lang, { style: "currency", currency: String(cur || "usd").toUpperCase() }).format(minor / 100); } catch { return String(minor / 100); } };
  /** → { head, sub, pro } in the reader's language */
  function words(n) {
    const who = n.who || t("Someone"), title = n.title ?? "";
    switch (n.kind) {
      case "signed": return { head: t("{who} signed “{title}”", { who, title }) };
      case "completed": return { head: t("Everyone has signed “{title}”", { title }), sub: t("All signers done · sealed copy sent") };
      case "opened": return { head: t("{who} opened “{title}”", { who, title }) };
      case "declined": return { head: t("{who} declined “{title}”", { who, title }) };
      case "expired": return { head: t("“{title}” expired before everyone signed", { title }) };
      case "bounced": return { head: t("An email about “{title}” could not be delivered", { title }) };
      case "changes": return { head: t("{who} asked for changes to “{title}”", { who, title }) };
      case "response": return { head: t("New response: {title}", { title }), sub: n.who ?? "" };
      case "limit": { const l = n.limit ?? {}; const head = l.kind === "templates" ? t("You've used {used} of {limit} new templates this month", l) : l.kind === "emails" ? t("You've sent {used} of {limit} emails today", l) : t("You've used {used} of {limit} documents this month", l);
        return { head, sub: l.kind === "emails" ? t("Resets at midnight UTC") : t("Resets on {date}", { date: day(l.resetsAt) }), pro: true }; }
      case "plan": { const c = n.plan?.change;
        if (c === "pro_started") return { head: t("Welcome to Docustay Pro") };
        if (c === "cancel_scheduled") return { head: t("Your Pro plan is cancelled"), sub: t("Pro stays on until the end of what you paid for.") };
        if (c === "resumed") return { head: t("Pro is back on"), sub: t("Nothing changes.") };
        if (c === "pro_ended") return { head: t("Your Pro plan has ended"), sub: t("Your workspace is on Free.") };
        if (c === "payment_failed") return { head: t("Your last payment did not go through") };
        return { head: n.plan?.planKey === "docustay_pro" && n.plan?.status === "active" ? t("Your workspace is on Pro") : t("Your plan was updated") }; }
      case "playbook": { const x = n.extra ?? {}; const name = x.name ?? t("A playbook"); return x.sent && n.title ? { head: t("Playbook “{name}”: “{title}” is not signed yet.", { name, title: n.title }), sub: "" } : { head: t("Playbook “{name}” ran", { name }), sub: n.title ? t("“{title}”", { title: n.title }) : "" }; }   // Run 9 Part 3.6: the notice carries ids and `sent`; the name comes from the inbox
      // the renewal reminder (R9-i) is about the NOTICE date: the event carries { date, days } (src/documents/keyDates.mjs KEY_DATE_DUE_FACT)
      case "renewal": { const x = n.extra ?? {}; return { head: t("Notice date in {n, plural, one {# day} other {# days}}: {title}", { n: x.days ?? 0, title: x.title ?? title }), sub: x.date ? t("Notice needed by {date}", { date: day(x.date) }) : "" }; }
      case "paid": { const x = n.extra ?? {}; return { head: t("{who} paid {amount} for “{title}”", { who: x.payer ?? who, amount: money(x.amountMinor ?? 0, x.currency), title }) }; }
      case "payment_failed": return { head: t("A payment for “{title}” did not go through", { title }), sub: t("The signature is kept for 7 days while they try again.") };
      default: return { head: title || t("Something happened") };
    }
  }
  async function load() { busy = true; const r = await api(`/api/product/docustay/inbox?tab=${tab}`); busy = false; if (r.ok) { data = r.json?.data ?? r.json; inbox.unread = data.unread ?? 0; problem = null; } else problem = r.error ?? t("Notifications could not be loaded."); }
  async function openRow(n) { open = false; if (!n.read) { api("/api/notifications/read", { method: "POST", body: { notificationId: n.id } }); n.read = true; inbox.unread = Math.max(0, inbox.unread - 1); } if (n.link) await goto(n.link); }
  async function readAll() { const r = await api("/api/product/docustay/inbox/read-all", { method: "POST", body: {} }); if (r.ok) { inbox.unread = 0; for (const n of data?.items ?? []) n.read = true; } }
  function setTab(v) { tab = v; data = null; load(); }
  onMount(() => useCount());
</script>
<Popover.Root {open} lazyMount unmountOnExit onOpenChange={(d) => { open = d.open; if (d.open) load(); }} positioning={{ placement: compact ? "right-start" : "bottom-end", gutter: 8 }}>
  <Popover.Trigger class="bell {compact ? 'compact' : ''}" aria-label={unread ? t("Notifications, {n} unread", { n: unread }) : t("Notifications")} data-testid="bell">
    <Icon name="bell" size={17} />{#if unread}<span class="badge" data-testid="bell-count">{unread > 99 ? "99+" : unread}</span>{/if}
  </Popover.Trigger>
  <Portal><Popover.Positioner><Popover.Content class="inbox" data-testid="inbox">
    <div class="ib-head"><Popover.Title class="ib-title">{t("Notifications")}</Popover.Title><span class="ib-acts"><button class="lnk" onclick={readAll} disabled={!unread} data-testid="inbox-read-all">{t("Mark all read")}</button><a class="lnk" href="/settings?tab=notifications" onclick={() => (open = false)} data-testid="inbox-settings">{t("Settings")}</a></span></div>
    <div class="ib-tabs" role="tablist" aria-label={t("Notifications")}>{#each TABS() as [v, label]}<button role="tab" aria-selected={tab === v} class:on={tab === v} onclick={() => setTab(v)} data-testid={`inbox-tab-${v}`}>{label}</button>{/each}</div>
    <div class="ib-list" role="tabpanel" aria-busy={busy}>
      {#if problem}<p class="ib-note" role="alert">{problem}</p>
      {:else if !data}<p class="ib-note">{t("Loading…")}</p>
      {:else if !data.items.length}<p class="ib-note" data-testid="inbox-empty">{tab === "all" ? t("Nothing new. When someone signs, fills in a form or a limit gets close, it shows here.") : t("Nothing here yet.")}</p>
      {:else}<ul>{#each data.items as n (n.id)}{@const w = words(n)}<li class="ib-row" class:unread={!n.read} data-testid={`inbox-${n.kind}`}>
        <button class="ib-btn" onclick={() => openRow(n)}><span class="dot" aria-hidden="true"></span><span class="ib-text"><span class="ib-h">{w.head}{#if !n.read}<span class="sr-only"> ({t("unread")})</span>{/if}</span><span class="ib-s">{[w.sub, ago(n.at)].filter(Boolean).join(" · ")}</span></span></button>
        {#if w.pro}<button class="lnk ib-pro" onclick={(e) => { open = false; exploreProFrom(n.limit?.kind === "templates" ? "unlimited_templates" : "unlimited_documents", e.currentTarget); }} data-testid="inbox-explore-pro">{t("Explore Pro")}</button>{/if}
      </li>{/each}</ul>{/if}
    </div>
  </Popover.Content></Popover.Positioner></Portal>
</Popover.Root>
<style>
  :global(.bell) { position: relative; display: inline-grid; place-items: center; width: 32px; height: 32px; border-radius: var(--rad-s); color: var(--text-2); background: transparent; }
  :global(.bell:hover) { background: var(--tint); color: var(--ink); }
  :global(.bell[data-state="open"]) { background: var(--lilac-soft); color: var(--violet); }
  .badge { position: absolute; top: 1px; right: 0; min-width: 16px; height: 16px; padding: 0 4px; border-radius: 999px; background: var(--violet); color: #fff; font: 600 10px/16px var(--font-sans); text-align: center; }
  :global(.inbox) { width: min(440px, calc(100vw - 24px)); min-width: min(440px, calc(100vw - 24px)); max-height: min(70vh, 620px); display: flex; flex-direction: column; background: var(--card); border-radius: var(--rad-l); box-shadow: 0 24px 64px rgb(24 20 60 / .18), 0 2px 6px rgb(24 20 60 / .06); overflow: hidden; z-index: 55; transform-origin: top right; }
  :global(.inbox[data-state="open"]) { animation: ib-in 200ms cubic-bezier(.2,.8,.2,1); }
  @keyframes ib-in { from { opacity: 0; transform: perspective(900px) rotateX(-6deg) translateY(-4px); } to { opacity: 1; transform: none; } }
  @media (prefers-reduced-motion: reduce) { :global(.inbox[data-state="open"]) { animation: none; } }
  .ib-head { display: flex; align-items: center; gap: 12px; padding: 18px 20px 10px; }
  :global(.ib-title) { margin: 0; font-size: 16px; font-weight: 600; }
  .ib-acts { margin-left: auto; display: flex; gap: 12px; }
  .lnk { font-size: var(--t-meta); color: var(--violet); text-decoration: underline; text-underline-offset: 2px; background: none; }
  .lnk:disabled { color: var(--mute); text-decoration: none; }
  .ib-tabs { display: flex; gap: 18px; padding: 0 20px 10px; border-bottom: 1px solid var(--hair); }
  .ib-tabs button { font-size: var(--t-meta); color: var(--mute); padding: 2px 0; background: none; } .ib-tabs button.on { color: var(--violet); font-weight: 600; }
  .ib-list { overflow-y: auto; }
  ul { list-style: none; margin: 0; padding: 0; }
  .ib-row { position: relative; border-bottom: 1px solid var(--hair); } .ib-row:last-child { border-bottom: 0; }
  .ib-row.unread { background: color-mix(in srgb, var(--lilac-soft) 55%, transparent); }
  .ib-btn { display: flex; gap: 12px; width: 100%; text-align: left; padding: 14px 20px; background: none; }
  .ib-btn:hover { background: var(--tint); }
  .dot { flex: none; width: 7px; height: 7px; margin-top: 7px; border-radius: 50%; background: transparent; } .unread .dot { background: var(--violet); }
  .ib-text { display: grid; gap: 3px; min-width: 0; }
  .ib-h { font-size: var(--t-body); font-weight: 500; color: var(--ink); } .ib-s { font-size: var(--t-meta); color: var(--mute); }
  .ib-pro { position: absolute; right: 20px; bottom: 14px; }
  .ib-note { margin: 0; padding: 22px 20px; font-size: var(--t-meta); color: var(--mute); }
</style>
