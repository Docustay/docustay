<script>
  import { page } from "$app/state";
  import Sec from "$lib/site/desk/Sec.svelte";
  import Faq from "$lib/site/desk/Faq.svelte";
  import Flow from "$lib/site/desk/Flow.svelte";
  import Figure from "$lib/site/desk/Figure.svelte";
  import Closing from "$lib/site/desk/Closing.svelte";
  import HeroSheets from "$lib/site/desk/HeroSheets.svelte";
  import { L10N } from "$lib/site/l10n.js";
  import { PASS3 } from "$lib/site/l10n-pass3.js";
  // The home page in another language: a machine-written draft (Beta) of the English page, in the same Desk look.
  const lang = $derived(page.params.lang), x = $derived(PASS3[lang]), t = $derived(L10N[lang]), h = $derived(t.home);
</script>
<svelte:head><title>Docustay | {h.title}</title><meta name="description" content={h.lede} /></svelte:head>
<section class="d-wrap lh">
  <p class="d-eyebrow">{h.eyebrow}</p>
  <h1 class="d-h1">{h.title}</h1>
  <p class="d-sub">{h.lede}</p>
  <div class="d-actions"><a class="d-btn main" href="/signup">{h.start}</a><a class="d-btn alt" href="/{lang}/product">{h.how}</a></div>
  <p class="d-fine" role="note">{t.beta} <a href="/">{t.original}</a></p>
</section>
<Sec title={h.stepsTitle} tight><Figure caption="FIG. 01"><Flow nodes={h.steps.map(([a, b], i) => ({ label: a, sub: b, red: i === 2 }))} dims={false} /></Figure></Sec>
<Sec title={h.proofTitle} sub={h.proof} tight><div class="d-actions"><a class="d-btn alt" href="/verify">{h.verify}</a></div></Sec>
<Sec title={h.faqTitle} tight><Faq items={h.faq} /></Sec>
<Sec title={x.heading} tight><div class="d-grid d-g3">{#each x.home as [h, b]}<article class="more"><b>{h}</b><p>{b}</p></article>{/each}</div></Sec>
<Closing title={h.title} label={h.start} href="/signup" keep={[[h.how, `/${lang}/product`], [t.menu.trust, `/${lang}/trust`], [t.original, "/"]]} />
<style> .more { border: 1px solid #2a2a2c; background: #131315; padding: 18px 20px; border-radius: 6px; } .more b { display: block; font: 600 17px/1.3 var(--font-sans); color: #f4f2ec; } .more p { margin: 8px 0 0; color: #b9b6ad; font-size: 15px; line-height: 1.5; }  .lh { padding-top: 72px; } </style>
