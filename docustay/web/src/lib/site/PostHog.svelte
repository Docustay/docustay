<script>
  // PostHog for the PUBLIC SITE ONLY (PH1, OPERATION-LIVE §24; never mounted in the signed-in app or on signing pages).
  // ★★★ NOTHING LOADS BEFORE THE COOKIE CHOICE. Accept: PostHog with its cookie (shared with app.docustay.app so a visit can stitch to the account
  //     that signs up), campaign tags and ad click ids. Decline: counted COOKIELESS (memory only, nothing stored on the device), with every ad click id
  //     stripped from the event and the address (the maintainer's default, 16 Oct 2026). Do Not Track, Global Privacy Control and ?notrack=1 turn it off entirely.
  // ★★ Never on: session replay, autocapture (so no form field is ever read), surveys, heatmaps, feature flags. Visitors stay anonymous (no person profile).
  // Events: page views and page leaves, plus the site's own named events (the same names Umami gets): every data-umami-event click, template_open,
  // signup_click, repo_click, docs_viewed, ai_referrer, and the ones lib/site/ui/track.js sends (code_copy, code_tab_switch, menu_open).
  import { onMount } from "svelte";
  import { page } from "$app/state";
  import { classify, stripIds, CLICK_IDS } from "./posthogChannel.js";
  let { config } = $props();

  const EMAIL = /[^\s@"'<>]+@[^\s@"'<>]+/g;

  const readConsent = () => { try { return /(?:^|;\s*)docustay-consent=(granted|denied)\b/.exec(document.cookie)?.[1] ?? null; } catch { return null; } };
  const optedOut = () => { try { return localStorage.getItem("docustay-notrack") === "1"; } catch { return false; } };

  let ph = null, mode = null;
  async function start(choice) {
    if (!config || mode === choice) return;
    const gpc = navigator.globalPrivacyControl === true, dnt = navigator.doNotTrack === "1" || window.doNotTrack === "1";
    // ?posthog_test=1 on a NON-production host (local, staging) lets an automated or embedded test browser through PostHog's bot filter; never on docustay.app
    const testing = new URLSearchParams(location.search).get("posthog_test") === "1" && !/(^|\.)docustay\.app$/.test(location.hostname);
    if (gpc || dnt || optedOut() || (navigator.webdriver && !testing)) return;
    const { default: posthog } = await import("posthog-js");
    const granted = choice === "granted";
    const channel = classify(location.href, document.referrer);
    const opts = {
      api_host: config.host, defaults: "2025-05-24",
      persistence: granted ? "localStorage+cookie" : "memory", cross_subdomain_cookie: granted,
      person_profiles: "identified_only", autocapture: false, capture_pageview: "history_change", capture_pageleave: true,
      disable_session_recording: true, disable_surveys: true, enable_heatmaps: false, capture_dead_clicks: false,
      advanced_disable_flags: true, advanced_disable_feature_flags: true, 
      capture_exceptions: true, respect_dnt: true, opt_out_useragent_filter: testing, mask_all_text: true, mask_all_element_attributes: true,
      // the last word on every event: no email anywhere, and on the declined path no ad click id in any property or address
      before_send: (e) => {
        if (!e) return e;
        const p = e.properties ?? {};
        for (const k of Object.keys(p)) {
          if (typeof p[k] === "string") p[k] = p[k].replace(EMAIL, "[email]");
          if (!granted && (CLICK_IDS.includes(k) || CLICK_IDS.some((c) => k === `$initial_${c}` || k.endsWith(`_${c}`)))) delete p[k];
          if (!granted && typeof p[k] === "string" && /url|referrer/i.test(k)) p[k] = stripIds(p[k]);
        }
        if (e.$set) for (const c of CLICK_IDS) { delete e.$set[c]; delete e.$set[`$initial_${c}`]; }
        if (!granted && e.$set_once) for (const k of Object.keys(e.$set_once)) if (CLICK_IDS.some((c) => k.includes(c))) delete e.$set_once[k];
        return e;
      },
    };
    if (ph) { ph.set_config({ persistence: opts.persistence, cross_subdomain_cookie: granted }); if (!granted) ph.reset(); }
    else { posthog.init(config.token, opts); ph = posthog; }
    ph.register({ consent: granted ? "granted" : "cookieless", site: "docustay.app" });
    ph.register_for_session(granted ? channel : { traffic_channel: channel.traffic_channel, ai_assistant: channel.ai_assistant, ad_network: channel.ad_network });
    if (mode === null && channel.ai_assistant) ph.capture("ai_referrer", { source: channel.ai_assistant, page: location.pathname });
    mode = choice;
    window.docustayPosthog = (name, data) => { try { ph?.capture(name, data ?? {}); } catch { /* never break a page */ } };
  }

  onMount(() => {
    if (!config) return;
    const v = readConsent();
    if (v) start(v);                       // a returning visitor already chose
    const onConsent = (e) => start(e.detail);
    const onClick = (e) => {
      if (!window.docustayPosthog) return;
      const el = e.target?.closest?.("[data-umami-event]");
      if (el) window.docustayPosthog(el.getAttribute("data-umami-event"), { page: location.pathname });
      const a = e.target?.closest?.("a[href]"); if (!a) return; const href = a.getAttribute("href") ?? "";
      if (/^\/(templates|form-templates)\/[^/?#]+/.test(href)) window.docustayPosthog("template_open", { slug: href.split("/")[2].split(/[?#]/)[0], kind: href.startsWith("/form-templates") ? "form" : "document" });
      if (/(^|\/)signup(\?|#|$)/.test(href)) window.docustayPosthog("signup_click", { from: location.pathname });
      else if (/github\.com\/[^/]+\/docustay/i.test(href)) window.docustayPosthog("repo_click", { from: location.pathname });
    };
    window.addEventListener("docustay:consent", onConsent); document.addEventListener("click", onClick, true);
    return () => { window.removeEventListener("docustay:consent", onConsent); document.removeEventListener("click", onClick, true); };
  });
  $effect(() => { const p = page.url.pathname; if (config && p.startsWith("/docs/")) window.docustayPosthog?.("docs_viewed", { page: p }); });
</script>
