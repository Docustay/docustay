<script>
  import { page } from "$app/state";
  import Sec from "$lib/site/desk/Sec.svelte";
  import Flow from "$lib/site/desk/Flow.svelte";
  import Figure from "$lib/site/desk/Figure.svelte";
  import Closing from "$lib/site/desk/Closing.svelte";
  import { L10N } from "$lib/site/l10n.js";
  import { PASS3 } from "$lib/site/l10n-pass3.js";
  const lang = $derived(page.params.lang), x = $derived(PASS3[lang]), t = $derived(L10N[lang]), p = $derived(t.product);
</script>
<svelte:head><title>{p.title} | Docustay</title><meta name="description" content={`${p.lede} ${p.steps.map((s) => s[0]).join(" · ")}`} /></svelte:head>
<section class="d-wrap lh">
  <h1 class="d-h1 sm">{p.title}</h1>
  <p class="d-sub">{p.lede}</p>
  <p class="d-fine" role="note">{t.beta} <a href="/product">{t.original}</a></p>
</section>
<Sec tight><Figure caption="FIG. 01"><Flow nodes={p.steps.map(([a, b], i) => ({ label: a, sub: b, red: i === 2 }))} dims={false} /></Figure></Sec>
<Sec title={x.heading} tight><div class="d-grid d-g3">{#each x.product as [h, b]}<article class="more"><b>{h}</b><p>{b}</p></article>{/each}</div></Sec>
<Closing title={p.title} label={t.menu.start} href="/signup" keep={[[t.menu.trust, `/${lang}/trust`], [t.menu.pricing, "/pricing"], [t.original, "/product"]]} />
<style> .more { border: 1px solid #2a2a2c; background: #131315; padding: 18px 20px; border-radius: 6px; } .more b { display: block; font: 600 17px/1.3 var(--font-sans); color: #f4f2ec; } .more p { margin: 8px 0 0; color: #b9b6ad; font-size: 15px; line-height: 1.5; }  .lh { padding-top: 72px; } </style>
