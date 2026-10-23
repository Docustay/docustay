<script>
  // Page analytics for the PUBLIC SITE ONLY (never mounted in the signed-in app or on signing pages): Umami, self-hosted, MIT. It sets no cookie and keeps no personal data: a page view carries the page, the referrer, the browser, the screen size and the country (from the request); no IP address is stored, no one is identified.
  // Respected: a visitor who pressed Decline in the cookie choice, a browser that sends Do Not Track or Global Privacy Control, and anyone who opted out (visit any page with ?notrack=1 once, and this browser is never counted). Automated browsers are not counted (navigator.webdriver) unless the address has ?umami_test=1 on a non-production host.
  // Events (named in docs/launch-site; V3 adds template_open, ai_referrer and menu_open): page views are automatic; docs_viewed (a docs page was opened), signup_started (a Sign up link was clicked), demo_button_* (the Try the demo buttons, via data-umami-event), repo_click (a link to the source repository). demo_started, demo_step, demo_converted_to_account, signup_completed and first_document_sent come from the app's server.
  import { onMount } from "svelte";
  import { page } from "$app/state";
  let { config } = $props();
  const readConsent = () => { try { return /(?:^|;\s*)docustay-consent=(granted|denied)\b/.exec(document.cookie)?.[1] ?? null; } catch { return null; } };
  const OFF = "umami.disabled";   // the key Umami's own tracker checks before it sends anything
  const flag = (on) => { try { if (on) localStorage.setItem(OFF, "1"); else localStorage.removeItem(OFF); } catch { /* storage blocked */ } };
  const track = (name, data) => { try { window.umami?.track(name, data); } catch { /* never break the page for analytics */ } };
  onMount(() => {
    if (!config) return;
    const q = new URLSearchParams(location.search);
    if (q.get("notrack") === "1") { try { localStorage.setItem("docustay-notrack", "1"); } catch {} flag(true); }
    const optedOut = (() => { try { return localStorage.getItem("docustay-notrack") === "1"; } catch { return false; } })();
    const testing = q.get("umami_test") === "1" && !/(^|\.)docustay\.app$/.test(location.hostname);
    const gpc = navigator.globalPrivacyControl === true, dnt = navigator.doNotTrack === "1" || window.doNotTrack === "1";
    const denied = readConsent() === "denied";
    if (optedOut || gpc || dnt || denied || (navigator.webdriver && !testing)) { flag(true); return; }
    flag(false);
    const s = document.createElement("script"); s.defer = true; s.src = `${config.url}/u`; s.dataset.websiteId = config.id; s.dataset.doNotTrack = "true"; s.dataset.domains = location.hostname; document.head.appendChild(s);
    const onConsent = (e) => flag(e.detail === "denied");
    const onClick = (e) => {
      const a = e.target?.closest?.("a[href]"); if (!a) return; const href = a.getAttribute("href") ?? "";
      if (/^\/(templates|form-templates)\/[^/?#]+/.test(href)) track("template_open", { slug: href.split("/")[2].split(/[?#]/)[0], kind: href.startsWith("/form-templates") ? "form" : "document" });
      if (/(^|\/)signup(\?|#|$)/.test(href)) track("signup_started", { from: location.pathname });
      else if (/github\.com\/[^/]+\/docustay/i.test(href)) track("repo_click", { from: location.pathname });
    };
    // a visit that arrives from an AI assistant is counted by source name only (no personal data)
    try { const h = new URL(document.referrer).hostname.replace(/^www\./, ""); const AI = { "chatgpt.com": "chatgpt", "perplexity.ai": "perplexity", "claude.ai": "claude", "gemini.google.com": "gemini", "copilot.microsoft.com": "copilot" }; if (AI[h]) { let n = 0; const t = setInterval(() => { if (window.umami || ++n > 20) { clearInterval(t); track("ai_referrer", { source: AI[h], page: location.pathname }); } }, 500); } } catch { /* no referrer */ }
    window.addEventListener("docustay:consent", onConsent); document.addEventListener("click", onClick, true);
    return () => { window.removeEventListener("docustay:consent", onConsent); document.removeEventListener("click", onClick, true); };
  });
  $effect(() => { const p = page.url.pathname; if (config && p.startsWith("/docs/")) { let n = 0; const t = setInterval(() => { if (window.umami || ++n > 20) { clearInterval(t); track("docs_viewed", { page: p }); } }, 500); return () => clearInterval(t); } });
</script>
