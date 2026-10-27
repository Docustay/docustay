<script>
  // The docs shell (frame: Docs, API reference, LIGHT): a top bar with the logo and three tabs, a 270px sidebar (search with ⌘K, an assistant button, groups, a System | Light | Dark switch at the foot) and a white rounded content card with a docked "Ask a question" bar.
  // The docs follow the account's Appearance (light by default). Search and the Ask bar read one prebuilt index (/docs/search.json) and answer from the documentation text only: no AI is involved.
  import { page } from "$app/state";
  import { setContext, onMount } from "svelte";
  import SiteLogo from "$lib/site/ui/Logo.svelte";
  import Icon from "$lib/ui/Icon.svelte";
  import Kbd from "$lib/ui/Kbd.svelte";
  import Segment from "$lib/ui/Segment.svelte";
  import MethodPill from "$lib/site/MethodPill.svelte";
  import { theme } from "$lib/theme/theme.svelte.js";
  import { rank } from "$lib/docs/search.js";
  let { data, children } = $props();
  const slug = $derived(page.url.pathname.replace(/^\/docs\//, "").replace(/\/$/, ""));
  const onApi = $derived(slug === "api-reference");
  const tab = $derived(onApi ? "api" : (data.nav.find((n) => n.slug === slug)?.tab ?? "docs"));
  const groups = $derived(tab === "guides" ? [["Guides", data.nav.filter((n) => n.tab === "guides")]] : tab === "docs" ? [["Start", data.nav.filter((n) => n.tab === "docs" && ["index", "authentication", "sdks", "errors-and-limits"].includes(n.slug))], ["Build", data.nav.filter((n) => n.tab === "docs" && ["templates-and-text-tags", "field-detection", "embedding", "webhooks", "search-and-payments", "email-setup", "email-api", "settings-reference"].includes(n.slug))], ["Self-host and licences", data.nav.filter((n) => n.tab === "docs" && (n.slug.startsWith("self-host") || n.slug === "licensing"))]] : []);
  let index = $state(null), q = $state(""), askQ = $state(""), asked = $state(""), searchEl = $state(null), askEl = $state(null), focused = $state(false);
  const load = async () => { if (index) return; try { index = await (await fetch("/docs/search.json")).json(); } catch { index = []; } };
  const hits = $derived(index && q.trim() ? rank(index, q, 6) : []);
  const answers = $derived(index && asked ? rank(index, asked, 3) : []);
  const href = (h) => `/docs/${h.slug}${h.id ? `#${h.id}` : ""}`;
  setContext("docs-search", { open: () => searchEl?.focus() });
  onMount(() => {
    const k = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); load(); searchEl?.focus(); }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "i") { e.preventDefault(); load(); askEl?.focus(); }
    };
    window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k);
  });
  const pref = $derived(theme.preference);
  let navOpen = $state(false);
</script>
<div class="docs-root min-h-screen bg-[var(--sidebar)]">
  <header class="sticky top-0 z-30 border-b border-line bg-[var(--paper)]"><!-- R13-D164: solid; at 90% the page text scrolling behind it showed through as ghost fragments -->
    <div class="mx-auto flex min-h-14 max-w-[1500px] flex-wrap items-center gap-x-2 gap-y-1 px-4 py-2 sm:h-14 sm:flex-nowrap sm:gap-6 sm:px-6 sm:py-0"><!-- R13-D248: below 640px the tabs take their own row instead of squeezing to "Gu" -->
      <a href="/" class="inline-flex items-center" aria-label="Docustay home"><SiteLogo variant={theme.resolved === "dark" ? "white" : "violet"} height={22} /></a>
      <nav class="order-last flex w-full min-w-0 items-center gap-1 overflow-x-auto sm:order-none sm:w-auto" aria-label="Documentation sections" style="scrollbar-width:none">
        {#each [["docs", "Documentation", "/docs/index"], ["guides", "Guides", "/docs/quickstart"], ["api", "API Reference", "/docs/api-reference"]] as [k, label, h]}<a href={h} class="tab {tab === k ? 'on' : ''}" aria-current={tab === k ? "page" : undefined}>{label}</a>{/each}
      </nav>
      <div class="ml-auto flex shrink-0 items-center gap-2"><a class="hidden min-h-6 items-center text-[14px] text-mute no-underline hover:text-ink sm:inline-flex" href="/">docustay.app</a><a class="btn primary !min-h-0 !py-1.5" href="/signup">Get started</a></div>
    </div>
  </header>
  <div class="mx-auto grid max-w-[1500px] grid-cols-[minmax(0,1fr)] gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[270px_minmax(0,1fr)]">
    <aside class="lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:self-start lg:overflow-y-auto" aria-label="Documentation">
      <div class="relative">
        <Icon name="search" size={15} class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-mute" />
        <input bind:this={searchEl} bind:value={q} onfocus={() => { load(); focused = true; }} onblur={() => setTimeout(() => (focused = false), 150)} class="field !rounded-[10px] !pl-9 !pr-14" type="search" placeholder="Search the docs" aria-label="Search the docs" data-testid="docs-search" />
        <span class="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2"><Kbd mod>K</Kbd></span>
        {#if focused && q.trim()}<ul class="absolute left-0 right-0 top-full z-20 mt-1 max-h-80 overflow-y-auto rounded-[12px] border border-line-strong bg-card p-1 shadow-[var(--shadow)]" data-testid="docs-search-results">{#each hits as h}<li><a href={href(h)} class="block rounded-[8px] px-2.5 py-2 text-[13.5px] no-underline hover:bg-tint"><span class="block font-medium">{h.heading}</span><span class="block text-[12px] text-mute">{h.title}</span></a></li>{:else}<li class="px-2.5 py-2 text-[13px] text-mute">{index ? "Nothing matches that." : "Loading the index…"}</li>{/each}</ul>{/if}
      </div>
      <button type="button" class="mt-3 flex w-full items-center gap-2 rounded-[10px] border border-line bg-card px-3 py-2 text-left text-[13.5px] text-text-2 hover:border-[var(--accent-line)]" onclick={() => { load(); askEl?.focus(); }}><span class="grid h-6 w-6 place-items-center rounded-[7px] bg-[var(--accent-soft)] text-[var(--accent)]"><Icon name="sparkle" size={14} /></span>Ask a question<span class="ml-auto"><Kbd mod>I</Kbd></span></button>
      <button type="button" class="navtoggle mt-3 flex w-full items-center justify-between rounded-[10px] border border-line bg-card px-3 py-2 text-left text-[13.5px] lg:hidden" aria-expanded={navOpen} aria-controls="docs-pages" onclick={() => (navOpen = !navOpen)}><span>Browse all pages</span><span aria-hidden="true">{navOpen ? "−" : "+"}</span></button>
      <div id="docs-pages" class={navOpen ? "" : "hidden lg:block"}>
      <nav class="mt-5 grid gap-5" aria-label="Pages">
        {#if tab === "api"}
          {#each data.api as g}<div><p class="grp">{g.tag}</p><ul class="grid gap-0.5">{#each g.items as o}<li><a href="/docs/api-reference#{o.id}" class="side"><MethodPill method={o.method} class="!px-1.5 !py-0 !text-[.6rem]" /><span class="truncate">{o.summary || o.path}</span></a></li>{/each}</ul></div>{/each}
        {:else}
          {#each groups as [title, items]}{#if items.length}<div><p class="grp">{title}</p><ul class="grid gap-0.5">{#each items as n}<li><a href="/docs/{n.slug}" class="side {slug === n.slug ? 'on' : ''}" aria-current={slug === n.slug ? "page" : undefined}>{n.title}</a></li>{/each}</ul></div>{/if}{/each}
        {/if}
      </nav>
      <div class="mt-6 border-t border-line pt-4"><p class="grp">Appearance</p><Segment label="Appearance" value={pref} onchange={(v) => theme.set(v)} options={[{ value: "system", label: "System" }, { value: "light", label: "Light" }, { value: "dark", label: "Dark" }]} testid="docs-appearance" /></div>
      </div>
    </aside>
    <div class="min-w-0">
      <div class="docs-card relative rounded-[20px] border border-line bg-card px-6 py-8 shadow-[var(--shadow)] sm:px-10">
        {@render children()}
        <div class="askdock z-10 mt-10 sm:sticky sm:bottom-4"><!-- R13-D248: on a phone the ask box sits at the end of the page instead of covering the text -->
          {#if asked}<div class="mb-2 rounded-[14px] border border-line-strong bg-card p-3 shadow-[var(--shadow)]" role="status" data-testid="docs-ask-answer"><p class="text-[12.5px] text-mute">From the documentation, best matches for “{asked}”:</p>
            {#each answers as h}<a href={href(h)} class="mt-2 block rounded-[10px] border border-line bg-[var(--sidebar)] p-2.5 no-underline hover:border-[var(--accent-line)]"><span class="block text-[14px] font-medium">{h.heading} <span class="font-normal text-mute">· {h.title}</span></span><span class="mt-0.5 block text-[12.5px] leading-snug text-mute">{h.text.slice(0, 180)}{h.text.length > 180 ? "…" : ""}</span></a>{:else}<p class="mt-2 text-[13.5px]">Nothing in the documentation matches that. <a class="underline" href="/contact">Write to us</a>.</p>{/each}</div>{/if}
          <form class="ask-box flex items-center gap-2 rounded-[14px] border border-line-strong bg-card p-2 pl-4 shadow-[var(--shadow)]" onsubmit={(e) => { e.preventDefault(); load(); asked = askQ.trim(); }}>
            <label class="sr-only" for="docs-ask">Ask a question</label><input id="docs-ask" bind:this={askEl} bind:value={askQ} class="min-h-[28px] min-w-0 flex-1 bg-transparent text-[14.5px] outline-none placeholder:text-mute" placeholder="Ask a question…" data-testid="docs-ask" />
            <Kbd mod>I</Kbd><button class="btn primary !min-h-0 !px-3 !py-1.5" type="submit" aria-label="Ask"><Icon name="arrow-right" size={15} /></button>
          </form>
        </div>
      </div>
    </div>
  </div>
</div>
<style>
  /* the site's tokens.css sets bright status colours for dark pages; on the light docs theme the chips (GET, 200, required) need the dark inks the app uses (axe: 1.4 to 1.8:1 before) */
  :global(:root[data-theme="light"]) .docs-root { --ok: #0b6a40; --ok-bg: rgb(15 122 75 / .09); --ok-line: rgb(15 122 75 / .32); --warn: #8a5600; --warn-bg: rgb(176 112 0 / .1); --warn-line: rgb(176 112 0 / .35); --bad: #b42318; --bad-bg: rgb(180 35 24 / .08); --bad-line: rgb(180 35 24 / .3); --info: #3f2899; --info-bg: rgb(90 58 193 / .09); --info-line: rgb(90 58 193 / .3); }
  .docs-card :global(summary) { min-height: 24px; }
  /* code comments: the highlighter's grey is 4.44:1 on the code tint; a shade darker clears 4.5:1 (axe) */
  .docs-card :global(.shiki span[style*="--shiki-light:#66707b" i]) { --shiki-light: #59626d !important; }
  /* Run 8 (S8): the question box's input draws no outline of its own, so the box shows where focus is (WCAG 2.4.7) */
  .ask-box:focus-within { outline: 3px solid var(--accent); outline-offset: 2px; }

  .tab { flex: none; white-space: nowrap; padding: .4rem .75rem; border-radius: 9px; font-size: 14px; color: var(--mute); text-decoration: none; } .tab:hover { color: var(--ink); } .tab.on { background: var(--tint); color: var(--ink); font-weight: 500; }
  .grp { font-family: var(--font-mono); font-size: 12px; letter-spacing: .08em; text-transform: uppercase; color: var(--faint); padding: 0 .5rem .4rem; }
  .side { display: flex; align-items: center; gap: .5rem; padding: .4rem .6rem; border-radius: 9px; font-size: 14px; color: var(--text-2); text-decoration: none; min-width: 0; } .side:hover { background: var(--tint); } .side.on { background: var(--tint); font-weight: 500; color: var(--ink); }
  .docs-card :global(.prose-docs h1) { font-size: 34px; font-weight: 600; letter-spacing: -.02em; line-height: 1.15; }
  /* a name in a table cell stays whole (the table scrolls sideways if it must) (it was breaking mid-word: documents:rea / d, requi / red) */
  /* R13-D204: a parameter name (code) stays on one line; plain words in a first column wrap between words, or a two-column table of sentences was 736px wide on a 390px phone */
  .docs-card :global(td code) { overflow-wrap: normal; word-break: keep-all; white-space: nowrap; } .docs-card :global(td:first-child) { overflow-wrap: normal; word-break: keep-all; }
  .docs-card :global(table) { display: block; max-width: 100%; overflow-x: auto; }
  .docs-card :global(pre:not(.shiki)) { max-width: 100%; overflow-x: auto; border-radius: 12px; background: var(--code, var(--tint)); padding: 1rem; font-size: 13px; line-height: 1.7; }
  .docs-card :global(img), .docs-card :global(video) { max-width: 100%; height: auto; }
  .docs-card :global(code) { overflow-wrap: anywhere; }
  .docs-card :global(pre code) { overflow-wrap: normal; }
</style>
