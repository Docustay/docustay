<script>
  // The cookie choice for the public website. NOTHING analytics-related loads until the visitor presses Accept: no script tag, no request. Decline (or silence) keeps it that way.
  // Accept loads gtag.js for Google Analytics 4 (G-0MJLPKWX0S), with Consent Mode v2 defaulting to denied. The signed-in app and the signing pages never mount this component.
  import { onMount } from "svelte";
  const GA4 = "G-0MJLPKWX0S", COOKIE = "docustay-consent";
  let asked = $state(false), open = $state(false), tall = $state(0);
  // R8-34 (WCAG 2.2 · 2.4.11): while the card is up, the page scrolls a focused control to stop ABOVE it (app.css reads --consent-h), never under it
  $effect(() => { try { document.documentElement.style.setProperty("--consent-h", `${open ? tall : 0}px`); } catch { /* no page */ } });
  const read = () => { try { return /(?:^|;\s*)docustay-consent=(granted|denied)\b/.exec(document.cookie)?.[1] ?? null; } catch { return null; } };
  const write = (v) => { try { document.cookie = `${COOKIE}=${v}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`; } catch { /* the choice just is not remembered */ } };
  // Consent Mode v2: every signal is DENIED until the visitor presses Accept; only then is it updated to granted and the tag loaded. No personal data goes in any event.
  function gtag() { window.dataLayer = window.dataLayer || []; window.dataLayer.push(arguments); }   // gtag.js reads the Arguments object, not an array
  const DENIED = { ad_storage: "denied", analytics_storage: "denied", ad_user_data: "denied", ad_personalization: "denied" };
  // Accept loads gtag.js for GA4 directly. The key events (demo_ready, demo_keep_complete, signup_complete, plan_cta, template_use, upgrade_completed) go through window.docustayGa, which does nothing until Accept.
  function load() {
    if (window.__docustayGtm) return; window.__docustayGtm = true;
    gtag("consent", "update", { analytics_storage: "granted" });
    gtag("js", new Date()); gtag("config", GA4, { anonymize_ip: true, send_page_view: true });
    window.docustayGa = (name, params) => gtag("event", name, params || {});
    const s = document.createElement("script"); s.async = true; s.src = `https://www.googletagmanager.com/gtag/js?id=${GA4}`; document.head.appendChild(s);
  }
  function forget() {   // delete the cookies Google set on this site, where the browser lets a page do it
    for (const c of document.cookie.split(";")) { const n = c.split("=")[0].trim(); if (/^(_ga|_gid|_gat|_gcl)/.test(n)) { for (const d of [location.hostname, "." + location.hostname.replace(/^www\./, "")]) document.cookie = `${n}=; Path=/; Domain=${d}; Max-Age=0`; document.cookie = `${n}=; Path=/; Max-Age=0`; } }
  }
  function choose(v) { write(v); open = false; asked = true; try { window.dispatchEvent(new CustomEvent("docustay:consent", { detail: v })); } catch { /* none */ } if (v === "granted") load(); else { forget(); delete window.docustayGa; } }
  // the key events the property marks as conversions that the public site can see: a plan button (plan_cta) and "Use this template" (template_use). demo_ready, demo_keep_complete, signup_complete and upgrade_completed happen inside the app.
  const onClick = (e) => {
    if (!window.docustayGa) return; const a = e.target?.closest?.("a[href]"); if (!a) return;
    if (a.matches('[data-testid="use-template"]')) window.docustayGa("template_use", { page: location.pathname });
    const plan = a.closest(".plan"); if (plan && a.matches(".d-btn")) window.docustayGa("plan_cta", { plan: plan.querySelector(".pn")?.textContent?.trim().toLowerCase() ?? "", page: location.pathname });
  };
  onMount(() => {
    document.addEventListener("click", onClick, true);
    gtag("consent", "default", { ...DENIED, wait_for_update: 500 });
    const v = read(); asked = v !== null; open = v === null;
    if (v === "granted") load();
    const again = () => { open = true; }; window.addEventListener("docustay:cookie-settings", again); return () => { document.removeEventListener("click", onClick, true); window.removeEventListener("docustay:cookie-settings", again); };
  });
</script>
{#if open}
  <div class="consent" role="dialog" aria-label="Cookie choice" aria-live="polite" data-testid="consent" bind:clientHeight={tall}>
    <p>Accept and we count visits with Google Analytics and PostHog. Decline and nothing goes to Google; PostHog stores nothing on your device. <a href="/legal/cookies">Details</a></p>
    <div class="row"><button type="button" class="q" onclick={() => choose("denied")} data-testid="consent-decline">Decline</button><button type="button" class="p" onclick={() => choose("granted")} data-testid="consent-accept">Accept</button></div>
  </div>
{/if}
<style>
  /* the docked bar (board 5): slim, at the bottom edge, never over the first screen's content; hidden while the phone menu is open */
  .consent { position: fixed; z-index: 45; left: 50%; bottom: 14px; transform: translateX(-50%); width: min(1180px, calc(100% - 2 * var(--gutter, 20px))); box-sizing: border-box; display: flex; align-items: center; justify-content: space-between; gap: 14px 20px; padding: 10px 12px 10px 22px; border-radius: 16px; border: 1px solid var(--hairline); background: #ffffff; color: var(--tx-1); box-shadow: 0 16px 50px rgb(60 40 140 / 0.225), inset 0 1px 0 rgb(255 255 255 / .08); font-size: 14.5px; }
  @supports (backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px)) { .consent { backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px); } }
  .consent p { margin: 0; } .consent a { color: var(--v-700); text-decoration: underline; text-underline-offset: 3px; }
  .row { display: flex; gap: 8px; flex: none; } .row button { min-height: 44px; padding: 0 18px; border-radius: 999px; font: 500 14px var(--font-sans); cursor: pointer; } .q { background: none; border: 1px solid var(--hairline); color: var(--tx-1); } .p { border: 0; color: #fff; background: linear-gradient(180deg, #8a78ff, #5a3ac1); }
  :global(html.sheet-open) .consent { display: none; }
  @media (max-width: 640px) { .consent { bottom: 8px; padding: 10px; font-size: 13px; line-height: 1.35; flex-direction: column; align-items: stretch; gap: 8px; } .row { justify-content: flex-end; } .row button { padding: 0 14px; } }
</style>
