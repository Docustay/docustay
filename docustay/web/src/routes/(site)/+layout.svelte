<script>
  import { page } from "$app/state";
  import { onNavigate, beforeNavigate } from "$app/navigation";
  import "$lib/site/desk.css";
  import DeskHeader from "$lib/site/desk/DeskHeader.svelte";
  import DeskFooter from "$lib/site/desk/DeskFooter.svelte";
  import Consent from "$lib/site/Consent.svelte";
  import Analytics from "$lib/site/Analytics.svelte";
  import PostHog from "$lib/site/PostHog.svelte";
  import { AREA, areaOf } from "$lib/site/3d/palette.js";
  import { onMount, setContext } from "svelte";
  setContext("site-surface", true);
  // R13-D004: the demo must start on the app's own address (its session lives there). A link click here would stay on this page's address, so /demo is a full page load
  // and the server sends it on (on a single-address install such as beta it simply loads /demo)
  beforeNavigate((nav) => { if (nav.type === "link" && nav.to?.url?.pathname === "/demo" && nav.to.url.origin === location.origin) { nav.cancel(); location.assign(nav.to.url.href); } });
  let { children, data } = $props();
  // Page changes cross-fade with the browser's own View Transitions API (no library, 0 KB); skipped for reduced motion and where the browser has no support
  onNavigate((nav) => { if (!document.startViewTransition || matchMedia("(prefers-reduced-motion: reduce)").matches) return; return new Promise((resolve) => { document.startViewTransition(async () => { resolve(); await nav.complete; }); }); });
  let status = $state("checking");
  // Pages whose first screen is a full-bleed film or picture: the header floats clear over it, then turns solid once the page has scrolled.
  const BLEED = [];   // pages are added here as they are redesigned (the home page is bleed by being over-hero)
  const BASE = "https://docustay.app";
  // the share image is the page's own card
  const slug = $derived(page.url.pathname === "/" || page.url.pathname === "" ? "home" : page.url.pathname.replace(/^\//, "").replace(/\/$/, "").replace(/\//g, "-"));
  const canonical = $derived(BASE + (page.url.pathname === "/" ? "" : page.url.pathname));
  const md = $derived(page.url.pathname === "/" ? "/index.md" : `${page.url.pathname}.md`);
  const overHero = $derived(page.url.pathname === "/");
  const bleed = $derived(overHero || BLEED.includes(page.url.pathname) || page.data?.bleed === true);
  // R13-D355: after an in-site click from the home page the route id did not read as docs (the canonical showed /docs/index), so the floating site header stayed over the docs bar; the address decides too
  const isDocs = $derived(Boolean(page.route.id?.startsWith("/(site)/docs")) || page.url.pathname === "/docs" || page.url.pathname.startsWith("/docs/"));
  // (no smooth-scroll library: the site never takes over the scroll)
  const is = (href) => page.url.pathname === href || (href !== "/" && page.url.pathname.startsWith(href + "/"));
</script>
<svelte:head>
  <link rel="preload" href="/fonts/instrument-serif-latin-400-normal.woff2" as="font" type="font/woff2" crossorigin />
  <link rel="icon" href="/brand/favicon-d.svg" type="image/svg+xml" /><link rel="icon" href="/brand/favicon.ico" sizes="48x48" /><link rel="apple-touch-icon" href="/brand/apple-touch-icon.png" />
  <link rel="canonical" href={canonical} /><link rel="alternate" type="text/markdown" href={md} />
  <meta property="og:site_name" content="Docustay" /><meta property="og:type" content="website" /><meta property="og:url" content={canonical} /><meta property="og:image" content="{BASE}/og/{slug}.png" /><meta name="twitter:card" content="summary_large_image" />
</svelte:head>
<div class={isDocs ? "" : "desk"} data-area={areaOf(page.url.pathname)} style="overflow-x: clip; --area: {AREA[areaOf(page.url.pathname)].accent}">
<a href="#main" class="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-card focus:px-3 focus:py-2">Skip to the content</a>
{#if !isDocs}<DeskHeader />{/if}
<main id="main">{@render children()}</main>
{#if isDocs}<Consent /><Analytics config={data.umami} /><PostHog config={data.posthog} />{:else}<DeskFooter bind:status /><Consent /><Analytics config={data.umami} /><PostHog config={data.posthog} />{/if}
</div>
