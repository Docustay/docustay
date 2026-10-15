<script>
  import Blocks from "$lib/site/desk/Blocks.svelte"; import { TOOLS_ADD } from "$lib/site/pages/pass3-tools.js";
  import DeskHead from "$lib/site/desk/DeskHead.svelte";
  import StackMini from "$lib/site/desk/StackMini.svelte";
  import Closing from "$lib/site/desk/Closing.svelte";
  import { GROUPS } from "$lib/site/pages/templateList.js";
  let { data } = $props();
  let q = $state(""), cat = $state("all");
  const cats = $derived([["all", `All ${data.cards.length}`], ...Object.entries(GROUPS)]);
  const shown = $derived(data.cards.filter((c) => (cat === "all" || c.group === cat) && (!q.trim() || (c.title + " " + c.line).toLowerCase().includes(q.trim().toLowerCase()))));
</script>
<!-- claim-until-proven: Scribe lines are on the page now and stay marked until the claims ledger proves them (the maintainer, 8 Oct) -->
<DeskHead title="Free document templates, ready to send" description="Free document templates you can send today: contracts, NDAs, waivers, HR forms, leases and school forms. Each shows its real pages, its fields and who signs." crumbs={[["Docustay", "/"], ["Templates", "/document-templates"]]} />
<section class="d-wrap g" data-page="/document-templates" data-voice="V1" data-template="T5 gallery">
  <p class="d-eyebrow">TEMPLATES · {data.cards.length}</p>
  <h1 class="d-h1 sm">Free document templates.</h1>
  <p class="d-sub">{data.cards.length} ready-to-send documents, in 14 languages. Every one is a real stack of pages you can flip through before you use it. <span data-feature="F-TEMPLATES"></span> Want one link that many people fill in and sign? See the <a href="/form-templates">free form templates</a>.</p>
  <div class="bar"><input type="search" bind:value={q} placeholder="Search templates" aria-label="Search templates" />
    <div class="chips" role="group" aria-label="Filter by use">{#each cats as [k, l]}<button type="button" class="d-chip" aria-pressed={cat === k} onclick={() => (cat = k)}>{l}</button>{/each}</div></div>
  <div class="d-grid d-g4" data-testid="template-grid">{#each shown as c (c.slug)}<StackMini t={c} level={2} />{/each}</div>
  {#if !shown.length}<p class="d-fine" style="margin-top:30px">No template matches. <a href="/product/scribe">Describe it and Scribe will write it.</a></p>{/if}
  <div class="scribe"><p class="d-eyebrow">NOT HERE?</p><h2 class="d-h2" style="margin-top:12px">Describe it, and Scribe builds it.</h2><p class="d-sub">Tell Scribe what you need. It writes the document and places the fields; you review it before anything is sent. <span data-feature="F-SCRIBE"></span></p><div class="d-actions"><a class="d-btn main" href="/product/scribe">See how Scribe works</a></div></div>
</section>
<Blocks blocks={TOOLS_ADD["/document-templates"]} />
<Closing title="Pick one and send it." label="Get started free" href="/signup" keep={[["Form templates", "/form-templates"], ["Use cases", "/use-cases"], ["Scribe", "/product/scribe"], ["Pricing", "/pricing"]]} />
<style>
  .g { padding-top: 56px; } .bar { display: grid; gap: 14px; margin: 34px 0 30px; } .bar input { background: #131315; border: 1px solid #2a2a2c; border-radius: 6px; padding: 13px 16px; color: #f4f2ec; font: 500 15px/1 var(--font-sans); max-width: 420px; } .bar input:focus-visible { outline: 2px solid #8585fd; outline-offset: 2px; }
  .chips { display: flex; flex-wrap: wrap; gap: 8px; } .scribe { margin-top: 64px; border-top: 1px solid #222224; padding-top: 44px; }
</style>
