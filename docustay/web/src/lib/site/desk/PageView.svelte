<script>
  import DeskHead from "./DeskHead.svelte";
  import HeroVisual from "../visuals/HeroVisual.svelte"; import { heroIdFor } from "../visuals/registry.js";
    import Blocks from "./Blocks.svelte";
  import Closing from "./Closing.svelte";
  import { feat } from "./feat.js";
  // One page of the registry on its template: hero (eyebrow, H1, sub, buttons, fine print, art), the blocks, the closing line with one next step and at most three "Keep reading" links.
  let { page, templates = [] } = $props();
  const HUB = { features: "Features", developers: "Developers", "self-host": "Self-host", "use-cases": "Templates collections", trust: "Trust", guides: "Guides", "sign-pdf": "Sign documents from your code", about: "About", licensing: "Licensing", "open-source": "Open source" };
  const NOHUB = { legal: ["Legal", "/legal"], guides: ["Docs", "/docs"] };   // sections with no index page of their own point at the nearest real hub
  // a page with no crumbs of its own gets its hub and itself, so every page below the top has a breadcrumb the structured data can repeat
  const crumbs = $derived(page.crumbs?.length ? page.crumbs : (() => { const segs = (page.path ?? "").split("/").filter(Boolean); if (!segs.length) return []; const hub = NOHUB[segs[0]] ?? [HUB[segs[0]] ?? segs[0][0].toUpperCase() + segs[0].slice(1).replace(/-/g, " "), "/" + segs[0]]; if (segs.length === 1) return [hub]; const own = (page.eyebrow?.split("·").pop() ?? page.h1).replace(/\*/g, "").trim(); return [hub, [own.charAt(0) + own.slice(1).toLowerCase() === own ? own : own[0].toUpperCase() + own.slice(1).toLowerCase(), page.path]]; })());
  const scene = $derived(!!heroIdFor(page.path ?? ""));   // V3: the hero visual comes from visuals/registry.js by path
  const sub = $derived(feat(page.sub));
  // one italic accent word in the serif display font: *word* in the data becomes <em>word</em> (text is escaped first)
  const esc = (t) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const h1html = $derived(esc(page.h1).replace(/\*([^*]+)\*/g, "<em>$1</em>"));
  const jsonCrumbs = $derived(crumbs.length ? [["Docustay", "/"], ...crumbs] : []);
  let current = $state(null);
  $effect(() => {   // the side menu marks the part on screen
    if (!page.toc || typeof IntersectionObserver === "undefined") return;
    const els = page.toc.map(([id]) => document.getElementById(id)).filter(Boolean);
    const io = new IntersectionObserver((es) => { for (const e of es) if (e.isIntersecting) current = e.target.id; }, { rootMargin: "-20% 0px -70% 0px" });
    els.forEach((e) => io.observe(e)); return () => io.disconnect();
  });
  // Menu click: go to the part, then re-check once layout has settled (images and the reveal pass move things after the first scroll).
  function go(e, id) {
    const el = document.getElementById(id); if (!el) return;
    e.preventDefault(); history.replaceState(null, "", `#${id}`); current = id;
    el.scrollIntoView({ block: "start" });
    for (const ms of [250, 700]) setTimeout(() => { const t = el.getBoundingClientRect().top; if (Math.abs(t - 88) > 40) el.scrollIntoView({ block: "start" }); }, ms);
  }
</script>
<DeskHead title={page.seo} description={page.meta} crumbs={jsonCrumbs} software={page.software} />
<div class="phw">
<section class="d-wrap ph {scene ? 'art' : 'plain'}" data-page={page.path} data-voice={page.voice} data-template={page.tpl}>
  <div class="ph-l">
    {#if crumbs.length}<nav class="d-crumbs" aria-label="Breadcrumb"><a href="/">Docustay</a>{#each crumbs as [n, h], i}<span>/</span>{#if i === crumbs.length - 1}<span>{n}</span>{:else}<a href={h}>{n}</a>{/if}{/each}</nav>{/if}
    {#if page.eyebrow}<p class="d-eyebrow" style="margin-top:22px">{page.eyebrow}</p>{/if}
    <h1 class="d-h1 sm" style={page.eyebrow ? "" : "margin-top:22px"}>{@html h1html}</h1>
    <p class="d-sub" data-feature={sub.ids}>{sub.text}</p>
    {#if page.actions}<div class="d-actions">{#each page.actions as [l, h, k, f]}<a class="d-btn {k ?? 'main'}" href={h} data-feature={f}>{l}</a>{/each}</div>{/if}
    {#if page.fine}<p class="d-fine">{page.fine}</p>{/if}
  </div>
  {#if scene}<div class="ph-r"><HeroVisual id={heroIdFor(page.path ?? "")} /></div>{/if}
</section></div>
{#if page.toc}
  <!-- Run 7: a long page with a side menu (the Trust centre). Desktop: the menu stays in view and marks the part being read; phone: a row of links under the hero. -->
  <div class="d-wrap tc">
    <nav class="toc" aria-label="On this page" data-testid="page-toc"><p class="d-eyebrow">On this page</p><ul>{#each page.toc as [id, label]}<li><a href={`#${id}`} onclick={(e) => go(e, id)} aria-current={current === id ? "true" : undefined}>{label}</a></li>{/each}</ul></nav>
    <div class="tc-main"><Blocks blocks={page.blocks} {templates} /></div>
  </div>
{:else}<Blocks blocks={page.blocks} {templates} />{/if}
<Closing title={page.closing.title} label={page.closing.label} href={page.closing.href} keep={page.keep ?? []} />
<style>
  .ph { display: grid; gap: 30px; padding-top: 132px; padding-bottom: 20px; align-items: center; } .ph.art { grid-template-columns: minmax(0, 1.02fr) minmax(0, 1fr); } .ph.plain { grid-template-columns: minmax(0, 860px); }
  .phw { position: relative; isolation: isolate; } .phw > :global(.bd) { z-index: -1; -webkit-mask-image: linear-gradient(to bottom, #000 55%, transparent); mask-image: linear-gradient(to bottom, #000 55%, transparent); } .ph { position: relative; }
  .ph-r { min-width: 0; }
  .tc { display: grid; grid-template-columns: 200px minmax(0, 1fr); gap: 48px; align-items: start; }
  .toc { position: sticky; top: 96px; padding-top: 48px; } .toc ul { list-style: none; margin: 10px 0 0; padding: 0; display: grid; gap: 2px; border-left: 1px solid var(--hairline); }
  .toc a { display: block; padding: 6px 0 6px 14px; margin-left: -1px; border-left: 2px solid transparent; color: var(--tx-3); font-size: 14px; text-decoration: none; }
  .toc a:hover { color: var(--tx-1); } .toc a[aria-current="true"] { color: var(--tx-1); border-left-color: rgb(90 58 193 / 0.5); }
  .tc-main { min-width: 0; } .tc-main :global(.d-wrap), .tc-main :global(.d-sec) { padding-left: 0; padding-right: 0; max-width: none; }
  :global(html) { scroll-padding-top: 88px; }
  @media (max-width: 900px) { .ph { padding-top: 104px; } .ph.art { grid-template-columns: minmax(0, 1fr); }
    .tc { grid-template-columns: minmax(0, 1fr); gap: 0; } .tc > * { min-width: 0; } .toc { position: sticky; top: 72px; z-index: 5; background: var(--d-ground); padding: 12px 0; } .toc :global(.d-eyebrow) { display: none; } .toc ul { display: flex; flex-wrap: nowrap; overflow-x: auto; gap: 8px; border: 0; margin: 0; } .toc a { white-space: nowrap; } .toc a { border: 1px solid var(--hairline); border-radius: 999px; padding: 6px 12px; margin: 0; } .toc a[aria-current="true"] { border-color: rgb(90 58 193 / 0.5); } }
</style>
