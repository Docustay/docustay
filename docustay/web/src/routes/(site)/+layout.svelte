<script>
  import { page } from "$app/state";
  import "$lib/site/desk.css";
  import DeskHeader from "$lib/site/desk/DeskHeader.svelte";
  import DeskFooter from "$lib/site/desk/DeskFooter.svelte";
  import { L10N, LANG_NAMES, SITE_LANGS } from "$lib/site/l10n.js";
  import { uiFor } from "$lib/site/l10n-ui.js";
  import Consent from "$lib/site/Consent.svelte";
  const ui = $derived(uiFor(page.url.pathname));
  import { onMount, setContext } from "svelte";
  setContext("site-surface", true);
  let { children } = $props();
  let status = $state("checking");
  // Run 8 (R8-10): a refused check (429: this address asked too often) says nothing about the service — it waits and asks once more instead of showing a red dot
  const checkStatus = (retry = true) => fetch("/api/public/status").then((r) => (r.status === 429 && retry ? (setTimeout(() => checkStatus(false), 30_000), null) : r.json())).then((j) => { if (j !== null) status = j?.status === "ok" || j?.status === "operational" ? "ok" : "degraded"; }).catch(() => (status = "degraded"));
  onMount(() => { checkStatus(); });
  let open = $state(null), mobile = $state(false), scrolled = $state(false), sentinel = $state(null);
  const close = () => { open = null; mobile = false; };
  $effect(() => { page.url.pathname; close(); });
  // Pages whose first screen is a full-bleed film or picture: the header floats clear over it, then turns solid once the page has scrolled.
  const BLEED = [];   // pages are added here as they are redesigned (home and its localized copies are bleed by being over-hero)
  const BASE = "https://docustay.app";
  const first = $derived(page.url.pathname.split("/")[1]);
  const loc = $derived(L10N[first] ? first : null);                // a Spanish, French or German page
  const tail = $derived(loc ? page.url.pathname.slice(loc.length + 1) : page.url.pathname);
  const ALT = ["/", "/product", "/trust"];                          // the pages that exist in every language
  const altHref = (l) => (l === "en" ? (tail || "/") : `/${l}${tail === "/" ? "" : tail}`);
  // the share image is the English page's card (share images stay English); a translated page points at its English page's
  const slug = $derived(tail === "/" || tail === "" ? "home" : tail.replace(/^\//, "").replace(/\/$/, "").replace(/\//g, "-"));
  const canonical = $derived(BASE + (page.url.pathname === "/" ? "" : page.url.pathname));
  const md = $derived(page.url.pathname === "/" ? "/index.md" : `${page.url.pathname}.md`);
  const overHero = $derived(page.url.pathname === "/" || (L10N[page.url.pathname.split("/")[1]] && page.url.pathname.split("/").length <= 2));
  const bleed = $derived(overHero || BLEED.includes(page.url.pathname) || page.data?.bleed === true);
  const clear = $derived(overHero && !scrolled);
  const isDocs = $derived(Boolean(page.route.id?.startsWith("/(site)/docs")));
  onMount(() => {
    const io = new IntersectionObserver(([e]) => (scrolled = !e.isIntersecting)); if (sentinel) io.observe(sentinel);
    let lenis = null, gone = false;
    // Smooth scrolling (Lenis, MIT) on the public site only, never in the app or the signing page. Off for people who ask for less motion and on touch screens, where the phone's own scrolling is better.
    if (!matchMedia("(prefers-reduced-motion: reduce)").matches && !matchMedia("(pointer: coarse)").matches) import("lenis").then(({ default: Lenis }) => { if (!gone) lenis = new Lenis({ autoRaf: true, anchors: true, lerp: 0.11, wheelMultiplier: 1 }); }).catch(() => {});
    return () => { gone = true; io.disconnect(); lenis?.destroy(); };
  });
  const is = (href) => page.url.pathname === href || (href !== "/" && page.url.pathname.startsWith(href + "/"));
</script>
<svelte:head>
  <link rel="canonical" href={canonical} />{#if ALT.includes(tail === "" ? "/" : tail)}{#each SITE_LANGS as l}<link rel="alternate" hreflang={l} href={BASE + altHref(l).replace(/^\/$/, "")} />{/each}<link rel="alternate" hreflang="x-default" href={BASE + (tail === "/" || tail === "" ? "" : tail)} />{/if}{#if !loc}<link rel="alternate" type="text/markdown" href={md} />{/if}
  <meta property="og:site_name" content="Docustay" /><meta property="og:type" content="website" /><meta property="og:url" content={canonical} /><meta property="og:image" content="{BASE}/og/{slug}.png" /><meta name="twitter:card" content="summary_large_image" />
</svelte:head>
<svelte:window onkeydown={(e) => e.key === "Escape" && close()} onclick={(e) => { if (!e.target.closest?.("[data-menu]")) open = null; }} />
<div class={isDocs ? "" : "desk"} style="overflow-x: clip">
<a href="#main" class="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-card focus:px-3 focus:py-2">Skip to the content</a>
<div bind:this={sentinel} class="absolute left-0 top-12 h-px w-px" aria-hidden="true"></div>
{#if !isDocs}<DeskHeader {loc} {ui} menus={loc ? L10N[loc].menu : {}} />{/if}
<main id="main">{@render children()}</main>
{#if isDocs}<Consent />{:else}<DeskFooter {loc} {ui} {status} {L10N} altHref={altHref} showLang={ALT.includes(tail === "" ? "/" : tail)} /><Consent />{/if}
</div>
