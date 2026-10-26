<script>
  // A portal screen made of sections (Settings, Developers, Platform): a grouped list on a desktop, one scrolling row of pills on a phone; each section is its own address (?tab=…).
  // `body` is given the current tab key and draws it. Nothing here knows what a section holds.
  import Icon from "$lib/ui/Icon.svelte";
  import { t } from "$lib/i18n/index.svelte.js";
  import PageHeader from "$lib/ui/PageHeader.svelte";
  let { title, sections, def, legacy = {}, testPrefix = "section", body, side = null } = $props();
  const all = $derived(sections.flatMap((s) => s.items));
  const start = () => { const want = typeof location !== "undefined" ? (new URLSearchParams(location.search).get("tab") ?? def) : def; const k = legacy[want] ?? want; return all.some((i) => i[0] === k) ? k : def; };
  let tab = $state(start());
  const pick = (k) => { tab = k; history.replaceState(null, "", `?tab=${k}`); };
  const label = $derived(all.find((i) => i[0] === tab)?.[1] ?? title);
</script>
<svelte:head><title>{label} · {title} · Docustay</title></svelte:head>
<PageHeader {title}>{#snippet actions()}{#if side}{@render side()}{/if}{/snippet}</PageHeader>
<nav aria-label={t("{name} sections", { name: title })} class="-mt-2 mb-6 flex gap-1 overflow-x-auto border-b border-line pb-2" role="tablist">{#each all as [k, l, ic]}<button role="tab" aria-selected={tab === k} aria-current={tab === k ? "page" : undefined} class="tab shrink-0 {tab === k ? 'on' : ''}" onclick={() => pick(k)} data-testid="{testPrefix}-{k}">{l}</button>{/each}</nav>
<div class="min-w-0">{@render body(tab, pick)}</div>
<style>
  .tab { padding: 7px 12px; border-radius: 9px; font-size: 13.5px; color: var(--mute); white-space: nowrap; } .tab:hover { color: var(--ink); background: var(--tint); } .tab.on { background: var(--tint); color: var(--ink); font-weight: 500; }
</style>
