<script>
  import DeskHead from "$lib/site/desk/DeskHead.svelte";
  import Closing from "$lib/site/desk/Closing.svelte";
  import FormCard from "$lib/site/desk/FormCard.svelte";
  import FormPreview from "$lib/site/desk/FormPreview.svelte";
  let { data } = $props();
  let q = $state(""), cat = $state("all");
  const cats = $derived([["all", `All ${data.cards.length}`], ...Object.entries(data.cats).filter(([k]) => data.cards.some((c) => c.use === k))]);
  const shown = $derived(data.cards.filter((c) => (cat === "all" || c.use === cat) && (!q.trim() || (c.title + " " + c.summary).toLowerCase().includes(q.trim().toLowerCase()))));
</script>
<DeskHead title="Free form templates: one link, many responses" description="Thirty free form templates: registrations, applications, requests, reports and sign-ins. Publish one link; every response is filled in, signed and kept as its own copy." crumbs={[["Docustay", "/"], ["Form templates", "/form-templates"]]} />
<section class="d-wrap g" data-page="/form-templates" data-voice="V1" data-template="T5 gallery">
  <p class="d-eyebrow">FORM TEMPLATES · {data.cards.length}</p>
  <h1 class="d-h1 sm">Free form templates.</h1>
  <p class="d-sub">A form is one link that anyone can open, fill in and sign. Each of these {data.cards.length} shows every field before you use it. <span data-feature="F-FORMS"></span></p>
  <div class="bar"><input type="search" bind:value={q} placeholder="Search form templates" aria-label="Search form templates" />
    <div class="chips" role="group" aria-label="Filter by use">{#each cats as [k, l]}<button type="button" class="d-chip" aria-pressed={cat === k} onclick={() => (cat = k)}>{l}</button>{/each}</div></div>
  <div class="d-grid d-g3" data-testid="form-template-grid">{#each shown as c (c.slug)}<FormCard t={c} />{/each}</div>
  {#if !shown.length}<p class="d-fine" style="margin-top:30px">No form template matches. <a href="/document-templates">See the document templates</a>.</p>{/if}
  <div class="ex"><div><p class="d-eyebrow">WHAT PEOPLE SEE</p><h2 class="d-h2 sm">Each form opens like this.</h2><p class="d-sub">The first part of the <a href="/form-templates/{data.sample.slug}">{data.sample.title.toLowerCase()} form</a>, drawn from its own fields. People type their name and email, fill in each box and sign.</p></div><FormPreview f={data.sample} limit={1} /></div>
  <p class="d-fine" style="margin-top:40px">Need one person to sign one document instead? <a href="/document-templates">Document templates</a>.</p>
</section>
<Closing title="Pick a form and publish it." label="Get started free" href="/signup" keep={[["Document templates", "/document-templates"], ["How forms work", "/product/forms"], ["Pricing", "/pricing"]]} />
<style>
  .g { padding-top: 56px; } .bar { display: grid; gap: 14px; margin: 34px 0 30px; } .bar input { background: #131315; border: 1px solid #2a2a2c; border-radius: 6px; padding: 13px 16px; color: #f4f2ec; font: 500 15px/1 var(--font-sans); max-width: 420px; } .bar input:focus-visible { outline: 2px solid var(--d-accent, #8b7cf6); outline-offset: 2px; }
  .ex { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 40px; align-items: center; margin-top: 64px; } @media (max-width: 900px) { .ex { grid-template-columns: 1fr; } }
  .chips { display: flex; flex-wrap: wrap; gap: 8px; }
</style>
