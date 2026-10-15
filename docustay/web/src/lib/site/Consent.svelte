<script>
  // The cookie choice for the public website. NOTHING analytics-related loads until the visitor presses Accept: no script tag, no request. Decline (or silence) keeps it that way.
  // Accept loads Google Tag Manager (GTM-M4XHM72X), which carries Google Analytics 4 (G-0MJLPKWX0S). The signed-in app and the signing pages never mount this component.
  import { onMount } from "svelte";
  const GTM = "GTM-M4XHM72X", COOKIE = "docustay-consent";
  let asked = $state(false), open = $state(false), tall = $state(0);
  // R8-34 (WCAG 2.2 · 2.4.11): while the card is up, the page scrolls a focused control to stop ABOVE it (app.css reads --consent-h), never under it
  $effect(() => { try { document.documentElement.style.setProperty("--consent-h", `${open ? tall : 0}px`); } catch { /* no page */ } });
  const read = () => { try { return /(?:^|;\s*)docustay-consent=(granted|denied)\b/.exec(document.cookie)?.[1] ?? null; } catch { return null; } };
  const write = (v) => { try { document.cookie = `${COOKIE}=${v}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`; } catch { /* the choice just is not remembered */ } };
  function load() {
    if (window.__docustayGtm) return; window.__docustayGtm = true;
    window.dataLayer = window.dataLayer || []; window.dataLayer.push({ "gtm.start": Date.now(), event: "gtm.js" });
    const s = document.createElement("script"); s.async = true; s.src = `https://www.googletagmanager.com/gtm.js?id=${GTM}`; document.head.appendChild(s);
  }
  function forget() {   // delete the cookies Google set on this site, where the browser lets a page do it
    for (const c of document.cookie.split(";")) { const n = c.split("=")[0].trim(); if (/^(_ga|_gid|_gat|_gcl)/.test(n)) { for (const d of [location.hostname, "." + location.hostname.replace(/^www\./, "")]) document.cookie = `${n}=; Path=/; Domain=${d}; Max-Age=0`; document.cookie = `${n}=; Path=/; Max-Age=0`; } }
  }
  function choose(v) { write(v); open = false; asked = true; if (v === "granted") load(); else forget(); }
  onMount(() => {
    const v = read(); asked = v !== null; open = v === null;
    if (v === "granted") load();
    const again = () => { open = true; }; window.addEventListener("docustay:cookie-settings", again); return () => window.removeEventListener("docustay:cookie-settings", again);
  });
</script>
{#if open}
  <div class="consent" role="dialog" aria-label="Cookie choice" aria-live="polite" data-testid="consent" bind:clientHeight={tall}>
    <p>We use a few cookies to make the site work. With your OK we also count visits with Google Analytics. Nothing is sent to Google unless you accept. <a href="/legal/cookies">Details</a></p>
    <div class="row"><button type="button" class="btn quiet" onclick={() => choose("denied")} data-testid="consent-decline">Decline</button><button type="button" class="btn primary" onclick={() => choose("granted")} data-testid="consent-accept">Accept</button></div>
  </div>
{/if}
<style>
  .consent { position: fixed; z-index: 60; left: 1rem; right: 1rem; bottom: 1rem; max-width: 34rem; display: grid; gap: .75rem; padding: 1rem 1.1rem; border-radius: 14px; border: 1px solid var(--line-strong); background: var(--card); color: var(--ink); box-shadow: 0 12px 40px rgb(0 0 0 / .35); font-size: .9rem; }
  .consent p { margin: 0; color: var(--text-2, var(--ink)); } .consent a { text-decoration: underline; }
  .row { display: flex; gap: .5rem; justify-content: flex-end; }
  @media (min-width: 700px) { .consent { left: auto; right: 1.25rem; bottom: 1.25rem; } }
</style>
