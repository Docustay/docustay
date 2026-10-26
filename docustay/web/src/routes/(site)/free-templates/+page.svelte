<script>
  // THE TEMPLATES HUB (V2 §4.9): every template in one place, with search and filters. Each page lives at /templates/<slug>.
  import DeskHead from "$lib/site/desk/DeskHead.svelte";
  import Closing from "$lib/site/desk/Closing.svelte";
  import Faq from "$lib/site/desk/Faq.svelte";
  import Sec from "$lib/site/desk/Sec.svelte";
  import HeroVisual from "$lib/site/visuals/HeroVisual.svelte";
    import StackMini from "$lib/site/desk/StackMini.svelte";
  import FormCard from "$lib/site/desk/FormCard.svelte";
  import { COLLECTIONS } from "$lib/site/nav.js";
  import { searchRank } from "$lib/site/rank.js";
  let { data } = $props();
  let q = $state(""), cat = $state("all");
  const n = $derived(data.docs.length + data.forms.length);
  const chips = $derived([["all", "All"], ["docs", "Agreements and letters"], ["forms", "Requests and sign-ins"], ...COLLECTIONS.map(([l, h]) => [h.split("/").pop(), l])]);
  const docs = $derived(searchRank(data.docs.filter((c) => cat === "all" || cat === "docs" || c.use === cat), q, "line"));
  const forms = $derived(searchRank(data.forms.filter((c) => cat === "all" || cat === "forms" || c.use === cat), q, "summary"));
  const faq = [
    ["Are the templates really free?", "Yes. Every template works on the Free plan, including the first send. A template is a starting point in plain words, not legal advice, so change what does not fit before you send it. {{F-TEMPLATES}}"],
    ["Can I change a template?", "Yes. In your workspace a template is your own copy: change the words, add or move a field and save. The original is never changed. {{F-TEMPLATES}}"],
    ["Can I send one from code?", "Yes. Every template has an id, and one API call sends it to the people you name. Try it with a test key first. {{F-API}}"],
  ];
  const ld = $derived(JSON.stringify({ "@context": "https://schema.org", "@type": "ItemList", name: "Docustay templates", numberOfItems: n, itemListElement: [...data.docs.map((c) => ["templates", c]), ...data.forms.map((c) => ["templates", c])].map(([k, c], i) => ({ "@type": "ListItem", position: i + 1, url: `https://docustay.app/${k}/${c.slug}`, name: c.title })) }));
</script>
<!-- claim-until-proven: the "more than 50" templates line is bound to the template counts on /facts -->
<DeskHead title="Free document templates" description="Free document templates: more than 50 contracts, NDAs, leases, waivers, registrations and HR paperwork. Open the real pages, change anything, send in a minute." crumbs={[["Docustay", "/"], ["Templates", "/free-templates"]]} />
<svelte:head>{@html `<script type="application/ld+json">${ld}</script>`}</svelte:head>
<div class="phw">
<section class="d-wrap g" data-page="/free-templates" data-voice="V1" data-template="T5 hub">
  <div class="ph-l"><nav class="d-crumbs" aria-label="Breadcrumb"><a href="/">Docustay</a><span>/</span><span>Templates</span></nav>
    <p class="d-eyebrow" style="margin-top:22px">TEMPLATES · {n}</p>
    <h1 class="d-h1 sm">More than 50 templates, <em>free.</em></h1>
    <p class="d-sub">Free document templates: contracts, waivers, registrations and requests you can send in a minute. Open the real pages, change anything, send. Every template works on Free. <span data-feature="F-TEMPLATES"></span></p>
    <div class="d-actions"><a class="d-btn main" href="#grid">Browse templates</a><a class="d-btn alt" href="/features/scribe">Describe your own</a></div></div>
  <div class="ph-r"><HeroVisual /></div>
</section></div>
<section class="d-wrap grid" id="grid">
  <div class="bar"><input type="search" bind:value={q} placeholder="Search {n} templates" aria-label="Search templates" />
    <div class="chips" role="group" aria-label="Filter by kind or collection">{#each chips as [k, l]}<button type="button" class="d-chip" aria-pressed={cat === k} onclick={() => (cat = k)} data-umami-event="template_filter" data-umami-event-filter={k}>{l}</button>{/each}</div></div>
  {#if docs.length}<h2 class="d-h2 sm">Agreements and letters <span class="ct">{docs.length}</span></h2><div class="d-grid d-g4" data-testid="template-grid">{#each docs as c (c.slug)}<StackMini t={c} level={3} />{/each}</div>{/if}
  {#if forms.length}<h2 class="d-h2 sm gap">Requests, registrations and sign-ins <span class="ct">{forms.length}</span></h2><div class="d-grid d-g3" data-testid="form-template-grid">{#each forms as c (c.slug)}<FormCard t={c} level={3} />{/each}</div>{/if}
  {#if !docs.length && !forms.length}<p class="d-fine" style="margin-top:30px">No template matches. <a href="/features/scribe">Describe it and Scribe will write it.</a></p>{/if}
</section>
<Sec eyebrow="How to pick" title="Three questions, one template." tight>
  <div class="d-grid d-g3 pick">
    <div class="pk"><b>1 · Who signs?</b><p>Name the people. A template lists its roles, such as Provider and Client, so you can see how many signers it needs before you open it.</p></div>
    <div class="pk"><b>2 · What must be in it?</b><p>Every card shows its real pages and its field count. Flip through the pages and read the wording, because a template is a starting point, not legal advice.</p></div>
    <div class="pk"><b>3 · Does it need to be paid?</b><p>Some templates carry a payment field, such as the payment plan agreement. Add one to any template when the signer should pay as part of signing. <span data-feature="F-PAYMENTS"></span></p></div>
  </div>
</Sec>
<Sec eyebrow="By collection" title="Start from the kind of paperwork you do." tight>
  <ul class="cl">{#each COLLECTIONS as [l, h]}<li><a href={h}>{l}</a></li>{/each}</ul>
</Sec>
<Sec eyebrow="Questions" title="Quick answers." tight><Faq items={faq} id="templates-hub-faq" /></Sec>
<Closing title="Pick one and send it." label="Try the demo" href="/demo" keep={[["Scribe", "/features/scribe"], ["Pricing", "/pricing"], ["Use cases", "/use-cases"]]} />
<style>
  .phw { position: relative; isolation: isolate; } .phw > :global(.bd) { z-index: -1; -webkit-mask-image: linear-gradient(to bottom, #000 55%, transparent); mask-image: linear-gradient(to bottom, #000 55%, transparent); }
  .g { position: relative; display: grid; grid-template-columns: minmax(0, 1.02fr) minmax(0, 1fr); gap: 30px; align-items: center; padding-top: 132px; padding-bottom: 20px; } .ph-r { min-width: 0; }
  .grid { padding-top: 40px; } .bar { display: grid; gap: 14px; margin: 0 0 30px; } .bar input { background: var(--glass-obsidian-bg); border: 1px solid var(--ln-2); border-radius: 12px; padding: 13px 16px; color: var(--tx-1); font: 500 15px/1 var(--f-ui); max-width: 420px; } .bar input:focus-visible { outline: 2px solid var(--v-500); outline-offset: 2px; }
  .chips { display: flex; flex-wrap: wrap; gap: 8px; } .ct { font: 500 14px var(--f-mono); color: var(--tx-3); } .gap { margin-top: 54px; } .grid :global(h2.d-h2) { margin-bottom: 22px; }
  .pick, .pk { min-width: 0; } .pk { padding: 24px; border-radius: 18px; border: 1px solid var(--ln-2); } .pk b { font-weight: 500; font-size: 17px; } .pk p { margin: 10px 0 0; color: var(--tx-2); line-height: 1.6; font-size: 15.5px; }
  .cl { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 12px; } .cl a { display: inline-flex; align-items: center; min-height: 48px; padding: 0 22px; border-radius: 999px; border: 1px solid var(--ln-2); text-decoration: none; color: var(--tx-1); } .cl a:hover { border-color: var(--v-300); }
  @media (max-width: 900px) { .g { grid-template-columns: minmax(0, 1fr); padding-top: 104px; } }
</style>
