<script>
  import { page } from "$app/state";
  import Sec from "$lib/site/desk/Sec.svelte";
  import Closing from "$lib/site/desk/Closing.svelte";
  import { L10N } from "$lib/site/l10n.js";
  import { PASS3 } from "$lib/site/l10n-pass3.js";
  const lang = $derived(page.params.lang), x = $derived(PASS3[lang]), t = $derived(L10N[lang]), p = $derived(t.trust);
</script>
<svelte:head><title>{p.title} | Docustay</title><meta name="description" content={p.lede} /></svelte:head>
<section class="d-wrap lh">
  <h1 class="d-h1 sm">{p.title}</h1>
  <p class="d-sub">{p.lede}</p>
  <p class="d-fine" role="note">{t.beta} <a href="/trust">{t.original}</a></p>
</section>
<Sec tight><div class="d-grid d-g3">{#each p.links as [l, h]}<a class="tile" href={h}><b>{l}</b></a>{/each}</div></Sec>
<Sec title={p.notTitle} tight><ul class="not">{#each p.not as n}<li>{n}</li>{/each}</ul></Sec>
<Sec title={x.heading} tight><div class="d-grid d-g3">{#each x.trust as [h, b]}<article class="more"><b>{h}</b><p>{b}</p></article>{/each}</div></Sec>
<Closing title={p.title} label={t.menu.start} href="/signup" keep={[[t.menu.product, `/${lang}/product`], [t.menu.pricing, "/pricing"], [t.original, "/trust"]]} />
<style> .more { border: 1px solid #2a2a2c; background: #131315; padding: 18px 20px; border-radius: 6px; } .more b { display: block; font: 600 17px/1.3 var(--font-sans); color: #f4f2ec; } .more p { margin: 8px 0 0; color: #b9b6ad; font-size: 15px; line-height: 1.5; }  .lh { padding-top: 72px; } .tile { display: block; border: 1px solid #2a2a2c; background: #131315; padding: 18px 20px; border-radius: 6px; text-decoration: none; color: #f4f2ec; } .tile:hover { border-color: #8585fd; } .tile b { font: 600 17px/1.3 var(--font-sans); } .not { margin: 0; padding: 0 0 0 20px; list-style: disc; display: grid; gap: 8px; color: #c9c5bb; line-height: 1.6; max-width: 70ch; } </style>
