<script>
  // ★ R10-62: <main> must not be a mouse-focus target. With tabindex="-1" on it, the FIRST click anywhere in a tall page focused <main> and every engine scrolled the page to its top edge on
  //   that pointerdown, so the control under the pointer moved before the pointer came up and the click never landed (the first press on a switch low on the Settings page did nothing).
  //   The skip link gives it the tabindex only for the moment it moves focus there.
  function skipToContent(e) { const m = document.getElementById("main"); if (!m) return; e.preventDefault(); m.setAttribute("tabindex", "-1"); m.focus(); m.addEventListener("blur", () => m.removeAttribute("tabindex"), { once: true }); }
  import { confirmState } from "$lib/ui/confirm.svelte.js";
  import DeletionBanner from "$lib/DeletionBanner.svelte";
  import { live } from "$lib/live.js";
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";
  import { rememberStarter, markSignedIn } from "$lib/starter.js";
  import { page } from "$app/state";
  import { api } from "$lib/api.js";
  import Logo from "$lib/Logo.svelte";
  import Icon from "$lib/ui/Icon.svelte";
  import Tip from "$lib/ui/Tip.svelte";
  import Kbd from "$lib/ui/Kbd.svelte";
  import { Menu } from "@ark-ui/svelte/menu";
  import { Portal } from "@ark-ui/svelte/portal";
  import AppearanceMenu from "$lib/ui/AppearanceMenu.svelte";
  import { toast } from "$lib/ui/toast.js"; import { toasted } from "$lib/ui/toasted.svelte.js";
  import { theme } from "$lib/theme/theme.svelte.js";
  import { plan, loadPlan } from "$lib/pro/plan.svelte.js";
  $effect(() => { loadPlan(); });   // the sidebar's "Pro until" notice reads the one plan copy
  import { probeLite } from "$lib/fx/index.js";
  import DrawnMark from "$lib/fx/Mark.svelte";
  import { chat } from "$lib/chat/chat.svelte.js";
  import { AGENT_DEFAULT_NAME } from "$lib/flow/agentName.js";
  import { t, startLang } from "$lib/i18n/index.svelte.js"; import LangPicker from "$lib/i18n/LangPicker.svelte"; import SuggestTranslation from "$lib/i18n/SuggestTranslation.svelte";
  import { edition, loadEdition } from "$lib/edition.svelte.js";
  import LazyIdle from "$lib/ui/LazyIdle.svelte";
  import { proSheet, upgradeSheet } from "$lib/pro/proSheet.svelte.js";
  import { palette } from "$lib/search/palette.svelte.js";
  import Bell from "$lib/inbox/Bell.svelte";
  import { twoStepGate } from "$lib/twoStepGate.svelte.js";
  let { children } = $props();
  $effect(() => { edition.testMode = testMode; });
  let wsName = $state(""), wsLoaded = $state(false);   // D-062: no placeholder name while the real one is on its way
  let me = $state(null), testMode = $state(false), menu = $state(false), flipping = $state(false);
  // Launch step 7: nine rows. Contracts is a view of Documents; Payments is a section of Billing; Playbooks are the Packs section of Plays; Workspace and Developers are areas of Settings.
  const nav = $derived([[t("Documents"), "/documents", "files"], [t("Templates"), "/templates", "template"], [t("Forms"), "/forms", "link"], [t("People"), "/people", "users"], [t("Automations"), "/automations", "zap"], [t("Plays"), "/plays", "sparkle"], [t("Reports"), "/reports", "chart"], [edition.selfHost ? t("Payments") : t("Billing"), "/billing", edition.selfHost ? "banknote" : "card"], [t("Settings"), "/settings", "settings"]].filter((r) => !(edition.rank === "member" && MEMBER_HIDDEN.includes(r[1]))));
  // Run 8 (roles matrix): a member sends and tracks documents. Forms, the workspace, developers and billing are an owner's or an admin's — the server refuses a member there, so the
  // sidebar no longer offers rows that open onto a refusal. (Settings stays: a member's own account lives there.)
  const MEMBER_HIDDEN = ["/forms", "/people", "/billing"];   // Run 9 Part 3.7: refunds are an admin act (the delete verb on the server)   // R8-40: People (the workspace address book) is admin-only on the server too
  const here = (h) => page.url.pathname.startsWith(h);
  // R10-60: the page's own title is in the very first paint (the server's HTML), in the same type and place as the real heading, so the largest text on a phone is drawn at once and the real heading, being no bigger, does not move it
  const START_TITLES = [["/documents", "Documents"], ["/templates", "Templates"], ["/forms", "Forms"], ["/people", "People"], ["/plays", "Plays"], ["/reports", "Reports"], ["/billing", "Billing"], ["/settings", "Settings"]];
  const startTitle = $derived.by(() => { const hit = START_TITLES.find(([h]) => page.url.pathname === h || page.url.pathname.startsWith(h + "/")); return hit ? t(hit[1]) : null; });
  // D-048: a self-hosted install has no plans or billing, so the Billing row is not shown there (the setup state answers only on self-host)
  // D-014: the workspace is called by its organisation name; the email From name is for email only
  async function readTestMode() { const st = await api("/api/documents/settings"); if (!st.ok) return;   /* P10-A-12: a failed read keeps the name already shown */
    const fs = st.ok ? (st.json.groups ?? []).flatMap((g) => g.fields) : []; testMode = fs.some((f) => f.key === "test_mode.on" && f.value === true); if (st.json?.organisation) wsName = st.json.organisation; wsLoaded = true;   /* never the placeholder words: the real name, or a skeleton */ }
  // Run 8 (R8-19): only "not signed in" (401) sends a person to sign-in. A busy server (429), a fault (5xx) or no network used to as well — a signed-in person was thrown out
  // to the sign-in page by one slow moment. Those now say so and try again on their own (after the server's Retry-After, or 5 seconds), with a button to try at once.
  let startProblem = $state(null), retryTimer = null;
  async function startNav() {
    let r; try { r = await api("/api/nav"); } catch { r = { ok: false, status: 0 }; }
    if (r.ok || r.status === 401 || r.status === 403) { startProblem = null; return r; }
    startProblem = r.status === 429 ? (r.error ?? t("Docustay is busy. Trying again…")) : r.status === 0 ? t("You seem to be offline. Trying again…") : t("Docustay could not answer just now. Trying again…");
    clearTimeout(retryTimer); retryTimer = setTimeout(retryStart, r.status === 429 ? 10000 : 5000); return null;
  }
  // D1 (13 Oct 2026): a person whose session ended mid-task (a checkout return, a long form) is sent back to exactly where they were once they sign in again. Only in-app paths are kept.
  const rememberWhereIWas = () => { try { const here = location.pathname + location.search; if (/^\/(billing|documents|templates|forms|people|plays|reports|settings|automations)(\/|\?|$)/.test(here)) sessionStorage.setItem("ds-after-login", here); } catch { /* storage blocked */ } };
  async function retryStart() { clearTimeout(retryTimer); const r = await startNav(); if (!r) return; if (!r.ok) { markSignedIn(false); rememberWhereIWas(); await goto("/login"); return; } me = r.json?.data ?? r.json ?? true; edition.rank = me?.rank ?? null; markSignedIn(); loadEdition(); await readTestMode(); }
  /* R10-53: offline, a part of the page that loads on demand cannot arrive. The person is already told they are offline (and nothing is lost), so the failed load is not an uncaught error. */
  onMount(() => { const quiet = (e) => { if (navigator.onLine === false && /dynamically imported module|Importing a module script failed|Load failed/i.test(String(e?.reason?.message ?? e?.reason ?? ""))) e.preventDefault(); }; window.addEventListener("unhandledrejection", quiet);
    /* R10-59 (WCAG 2.4.11): keyboard focus must not land under the Scribe bar; if the middle of the focused control would sit under it, scroll just enough */
    const clear = (ev) => { const e = ev.target, bar = document.querySelector('[data-testid="ask-bar"]'); if (!bar || !(e instanceof HTMLElement)) return; const fix = () => { const r = e.getBoundingClientRect(), f = bar.getBoundingClientRect(), mid = r.top + r.height / 2; if (r.top < innerHeight && mid > f.top) window.scrollBy({ top: mid - f.top + 16, behavior: "instant" }); }; fix(); requestAnimationFrame(fix); };
    document.addEventListener("focusin", clear);
    return () => { window.removeEventListener("unhandledrejection", quiet); document.removeEventListener("focusin", clear); }; });
  onMount(async () => { probeLite(); startLang(); const r = await startNav(); if (!r) return; if (!r.ok) { markSignedIn(false); rememberWhereIWas(); const st = rememberStarter(); await goto(st ? `/login?starter=${encodeURIComponent(st)}` : "/login"); return; } me = r.json?.data ?? r.json ?? true; edition.rank = me?.rank ?? null; markSignedIn(); loadEdition(); await readTestMode(); return live(["settings", "team", "billing", "keys"], readTestMode); });
  // the test-mode switch lives in the header on every screen (the same setting as Settings → Test mode)
  async function flipTest() {
    flipping = true;
    const r = await api("/api/documents/settings", { method: "POST", body: { key: "test_mode.on", value: !testMode } });
    if (r.ok) { testMode = !testMode; toast(testMode ? t("Test mode is on. Documents go only to you and are stamped TEST.") : t("Test mode is off."), testMode ? "warn" : "ok"); } else toast(r.error ?? t("That did not change."), "bad");
    flipping = false;
  }
  async function out() { await api("/api/auth/logout", { method: "POST", body: {} }); markSignedIn(false); try { sessionStorage.setItem("ds-signed-out", "1"); } catch { /* ignore */ } /* D-040: the sign-in page must not sign the person straight back in */ await goto("/login"); }
  $effect(() => { page.url.pathname; menu = false; });
</script>
{#if me}
<!-- Run 8 (S8): a keyboard user reaches the screen without first tabbing through the whole sidebar (WCAG 2.4.1), the same link the site has -->
<a href="#main" onclick={skipToContent} class="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-card focus:px-3 focus:py-2" data-testid="skip-link">{t("Skip to the content")}</a>
<div class="flex min-h-screen flex-col md:flex-row">
  <!-- phone: a top bar with a menu button; from 768px: a sidebar that never collapses -->
  <header class="sticky top-0 z-30 flex items-center gap-2 border-b border-line bg-paper px-3 py-2 md:hidden">
    <button class="btn quiet !min-h-0 !p-2" aria-label={t("Menu")} aria-expanded={menu} aria-controls="app-nav" onclick={() => (menu = !menu)}><Icon name={menu ? "close" : "menu"} size={22} /></button>
    <Logo />
    <span class="ml-auto flex items-center gap-1"><button class="btn quiet !min-h-0 !h-8 !w-8 !p-0 !justify-center" onclick={() => (palette.open = true)} aria-label={t("Search")} data-testid="search-open-phone"><Icon name="search" size={17} /></button><Bell /><button class="chip {testMode ? 'warn' : 'mute'} !min-h-8 cursor-pointer" onclick={flipTest} disabled={flipping} aria-pressed={testMode} data-testid="test-switch"><Icon name="flask" size={14} />{testMode ? t("Test mode on") : t("Test mode")}</button></span>
  </header>
  <aside id="app-nav" class="{menu ? 'flex' : 'hidden'} w-full shrink-0 flex-col gap-1 border-b border-line bg-[var(--sidebar)] p-3 md:sticky md:top-0 md:flex md:h-screen md:w-[4.75rem] md:items-center wide:w-[15rem] wide:items-stretch md:border-b-0 md:border-r md:px-3 md:py-3.5">
    <div class="mb-3 hidden flex-col items-center gap-2 md:flex wide:hidden"><Logo mark /><Tip text={t("Search (⌘K)")}><button class="btn quiet !min-h-0 !h-8 !w-8 !p-0 !justify-center" onclick={() => (palette.open = true)} aria-label={t("Search")} aria-keyshortcuts="Control+K Meta+K" data-testid="search-open-rail"><Icon name="search" size={17} /></button></Tip><Bell compact /></div>
    <Menu.Root positioning={{ placement: "bottom-start" }}>
      <Menu.Trigger class="ws mb-3 hidden w-full items-center gap-3 rounded-[10px] px-2 py-1.5 text-left hover:bg-tint wide:flex" data-testid="workspace-switcher"><span class="grid h-[26px] w-[26px] shrink-0 place-items-center rounded-[8px] text-[12px] font-semibold text-white" style="background: linear-gradient(135deg, #6c5ce0, #2b7be0)">{(wsName || " ").slice(0, 1).toUpperCase()}</span><span class="min-w-0 flex-1 truncate text-[14px] font-medium">{#if wsName}{wsName}{:else}<span class="inline-block h-3 w-28 animate-pulse rounded bg-tint align-middle" aria-hidden="true"></span>{/if}</span><Icon name="chevron-down" size={14} class="text-mute" /></Menu.Trigger>
      <Portal><Menu.Positioner><Menu.Content data-testid="workspace-menu">
        <Menu.Item value="test" onSelect={flipTest} data-testid="ws-test"><Icon name="flask" size={16} /><span>{testMode ? t("Turn test mode off") : t("Turn test mode on")}</span></Menu.Item>
        <Menu.Item value="out" onSelect={out} data-testid="ws-signout"><Icon name="out" size={16} /><span>{t("Sign out")}</span></Menu.Item>
      </Menu.Content></Menu.Positioner></Portal>
    </Menu.Root>
    <div class="mb-2 hidden items-center gap-1.5 wide:flex"><button class="search-row flex min-w-0 flex-1 items-center gap-2 rounded-[10px] px-3 py-[7px] text-left text-[13px] text-mute" onclick={() => (palette.open = true)} aria-keyshortcuts="Control+K Meta+K" data-testid="search-open"><Icon name="search" size={15} /><span class="flex-1 truncate">{t("Search")}</span><Kbd mod>K</Kbd></button><Bell /></div>
    <!-- Run 9 Part 3.7 (B5): after cancelling, a slim countdown with Resume Pro until the paid period ends -->
    {#if plan.data?.plan?.key === "docustay_pro" && plan.data.plan.cancelsAt && new Date(plan.data.plan.cancelsAt) > new Date()}<a href="/billing" class="mb-2 hidden items-center justify-between gap-2 rounded-[10px] border border-line px-3 py-[7px] text-[12.5px] no-underline wide:flex" data-testid="pro-ending"><span class="text-mute">{t("Pro until {date}", { date: new Date(plan.data.plan.cancelsAt).toLocaleDateString(undefined, { day: "numeric", month: "short", timeZone: "UTC" }) })}</span><span class="font-medium text-brand">{t("Resume Pro")}</span></a>{/if}
    <nav class="flex flex-col gap-0.5 md:items-center wide:items-stretch" aria-label={t("Main")}>{#each nav as [t, h, ic]}<a href={h} aria-current={here(h) ? "page" : undefined} class="rail group relative flex items-center gap-3 rounded-[10px] px-3 py-[9px] text-[14px] no-underline md:h-11 md:w-11 md:justify-center md:p-0 wide:h-auto wide:w-full wide:justify-start wide:px-3 wide:py-[9px] hover:bg-tint {here(h) ? 'bg-tint font-medium text-ink' : 'text-text-2'}"><Icon name={ic} size={17} /><span class="rail-t">{t}</span></a>{/each}</nav>
    <div class="mt-auto hidden flex-col gap-2 md:flex">
      <button class="chip {testMode ? 'warn' : 'mute'} !justify-center md:!hidden wide:!inline-flex cursor-pointer" onclick={flipTest} disabled={flipping} aria-pressed={testMode} data-testid="test-switch-side"><Icon name="flask" size={13} />{testMode ? t("Test mode is on") : t("Test mode is off")}</button>
      <button class="chip {testMode ? 'warn' : 'mute'} hidden !h-8 !w-8 !justify-center !p-0 md:inline-flex wide:!hidden" onclick={flipTest} aria-label={testMode ? t("Test mode is on") : t("Test mode is off")} aria-pressed={testMode}><Icon name="flask" size={15} /></button>
      <div class="foot flex items-center gap-1 md:flex-col wide:flex-row">
        <AppearanceMenu class="!h-8 !w-8 !min-h-0 !p-0 !justify-center" />
        <Tip text={t("Feedback")}><a class="btn quiet !min-h-0 !h-8 !w-8 !p-0 !justify-center" href="/contact" target="_blank" rel="noopener" aria-label={t("Feedback")} data-testid="foot-feedback"><Icon name="message-square" size={17} /></a></Tip>
        <Tip text={t("Help")}><a class="btn quiet !min-h-0 !h-8 !w-8 !p-0 !justify-center" href="/docs/index" target="_blank" rel="noopener" aria-label={t("Help")} data-testid="foot-help"><Icon name="circle-help" size={17} /></a></Tip>
        <SuggestTranslation variant="icon" class="!min-h-0 !h-8 !w-8 !p-0 !justify-center" />
        <Tip text={t("Sign out")}><button class="btn quiet !min-h-0 !h-8 !w-8 !p-0 !justify-center wide:!hidden" onclick={out} aria-label={t("Sign out")} data-testid="rail-signout"><Icon name="out" size={17} /></button></Tip>
      </div>
    </div>
    <div class="md:hidden"><LangPicker /></div>
    <div class="md:hidden"><AppearanceMenu full placement="top-start" /></div>
    <button class="btn quiet !justify-start md:hidden" onclick={out}><Icon name="out" />{t("Sign out")}</button>
  </aside>
  <div class="dock-col flex min-w-0 flex-1 flex-col" style="margin-right: var(--chat-dock, 0px)">
    <main id="main" class="min-w-0 flex-1 px-4 pb-8 pt-6 outline-none md:px-9 md:pb-10 md:pt-7"><DeletionBanner />{#if plan.data?.demo}{#await import("$lib/demo/DemoBanner.svelte") then { default: DemoBanner }}<DemoBanner />{/await}{/if}{#if testMode}<p class="notice warn mb-4" data-testid="test-mode-banner">{t("Test mode is on: documents you send now go only to you, are stamped TEST and are not counted.")} <button class="underline" onclick={flipTest} disabled={flipping}>{t("Turn it off")}</button></p>{/if}{#if twoStepGate.needed}{#await import("$lib/TwoStepGate.svelte") then { default: Gate }}<Gate />{/await}{:else}{@render children()}{/if}</main>
    {#if true}
      <footer class="ask-bar sticky bottom-0 z-20 flex items-center justify-between border-t border-line bg-card px-[18px] py-2 text-[12.5px]" data-testid="ask-bar">
        <a class="ask-docs inline-flex min-h-6 items-center gap-2 font-mono text-mute no-underline hover:text-ink" href="/docs/index" target="_blank" rel="noopener" data-testid="ask-docs"><Icon name="file" size={14} />/docs</a>
        {#if chat.status === null || chat.status.enabled}<button type="button" class="ask-go inline-flex min-h-6 items-center gap-2 text-text-2 hover:text-ink" aria-expanded={chat.open} aria-keyshortcuts="Control+I Meta+I" data-testid="chat-launcher" onclick={() => { menu = false; chat.open ? chat.close() : chat.show(); }}><Icon name="sparkle" size={14} class="text-[var(--accent)]" /><span>{t("Ask {name}", { name: chat.status?.agentName || AGENT_DEFAULT_NAME })}</span><Kbd mod>I</Kbd>{#if chat.unread}<span class="chat-dot" data-testid="chat-unread" role="status" aria-label={t("The assistant has finished")}></span>{/if}</button>{/if}
      </footer>
    {/if}
  </div>
</div>
<!-- Launch step 5: the heavy panels load after the first paint (or the moment one is asked for), not in the first download -->
<LazyIdle load={() => import("$lib/chat/ChatAssistant.svelte")} now={chat.open} />
<LazyIdle load={() => import("$lib/search/Palette.svelte")} now={palette.open} />
<LazyIdle load={() => import("$lib/pro/ExploreProSheet.svelte")} now={proSheet.open} />
<LazyIdle load={() => import("$lib/pro/UpgradeSheet.svelte")} now={upgradeSheet.open} />
<LazyIdle load={() => import("$lib/ui/ConfirmHost.svelte")} now={confirmState.open} />
<LazyIdle load={() => import("$lib/ui/ToasterHost.svelte")} now={toasted.n > 0} />
{:else if startProblem}<div class="grid min-h-screen place-items-center p-6"><div class="max-w-sm text-center" role="alert" data-testid="start-problem"><p class="text-[15px]">{startProblem}</p><button class="btn mt-4" onclick={retryStart}>{t("Try again")}</button></div></div>
{:else}<div class="flex min-h-screen flex-col md:flex-row" aria-busy="true"><span class="sr-only" role="status">{t("Loading…")}</span><span class="app-start" aria-hidden="true"><DrawnMark size={40} /></span>
  <aside class="hidden shrink-0 border-r border-line bg-[var(--sidebar)] p-4 md:block md:w-[4.75rem] wide:w-[15rem]" aria-hidden="true"><div class="sk h-8 w-full rounded-lg"></div><div class="mt-6 space-y-3">{#each Array(9) as _}<div class="sk h-5 w-full rounded-md"></div>{/each}</div></aside>
  <main class="min-w-0 flex-1 px-4 pt-6 md:px-9 md:pt-7" aria-hidden="true">{#if startTitle}<header class="mb-6 flex flex-wrap items-center justify-between gap-x-6 gap-y-3"><div class="min-w-0"><h1 class="text-[length:var(--t-title)] font-medium leading-tight tracking-[-0.02em]">{startTitle}</h1></div></header>{:else}<div class="sk h-8 w-48 rounded-lg"></div>{/if}<div class="sk mt-4 h-4 w-80 max-w-full rounded-md"></div><div class="sk mt-8 h-40 w-full max-w-4xl rounded-xl"></div></main></div>{/if}
<style>
  /* opening Scribe docked: the page gives it room in step with the panel sliding in (motion board Load 3); reduced motion: at once */
  .dock-col { transition: margin-right 320ms cubic-bezier(.2,.8,.2,1); }
  /* app start (motion board Load 6): the drawn mark over the skeleton, centred, never in the way of anything (nothing is clickable yet) */
  .app-start { position: fixed; left: 50%; top: 42%; margin: -20px 0 0 -20px; z-index: 5; pointer-events: none; }
  @media (prefers-reduced-motion: reduce) { .dock-col { transition: none; } }
  .sk { background: linear-gradient(90deg, var(--tint), var(--line), var(--tint)); background-size: 200% 100%; animation: sk 1.4s ease-in-out infinite; }
  @keyframes sk { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
  @media (prefers-reduced-motion: reduce) { .sk { animation: none; } }
  .search-row { background: var(--card); box-shadow: inset 0 0 0 1px var(--line); }
  .search-row:hover { color: var(--ink); box-shadow: inset 0 0 0 1px var(--line-strong); }
  .rail-t { white-space: nowrap; }
  @media (min-width: 1100px) { .rail-t { position: static !important; transform: none !important; opacity: 1 !important; background: none !important; color: inherit !important; padding: 0 !important; font-size: .95rem !important; font-weight: inherit !important; box-shadow: none !important; pointer-events: auto !important; } }
  @media (min-width: 768px) {
    .rail-t { position: absolute; left: calc(100% + .6rem); top: 50%; transform: translateY(-50%) translateX(-4px); padding: .3rem .65rem; border-radius: .5rem; background: var(--ink); color: var(--paper); font-size: .8rem; font-weight: 600; opacity: 0; pointer-events: none; transition: opacity .15s, transform .15s; z-index: 50; }
    .rail:hover .rail-t, .rail:focus-visible .rail-t { opacity: 1; transform: translateY(-50%); }
  }
  @media (prefers-reduced-motion: reduce) { .rail-t { transition: none; } }
</style>
