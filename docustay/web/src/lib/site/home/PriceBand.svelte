<script>
  // The black pricing band: three huge numbers with thin vertical dividers. Prices come from the page's load (live when the billing system answers, defaults otherwise).
  import { shown } from "$lib/fx/index.js";
  import Counter from "$lib/fx/Counter.svelte";
  import Doodle from "$lib/doodle/Doodle.svelte";
  import { dollars, proShown } from "../plans.js";
  let { plans } = $props();
  const pro = $derived(proShown(plans));
</script>
<div class="wrap">
  <div class="cols">
    <div class="col reveal" style="--i:0" {@attach shown(0.25)}><p class="eyebrow">Free</p><p class="t-xxl"><Counter to={0} prefix="$" /></p><p class="cap">{plans.free.docsPerMonth} documents and {plans.free.templatesPerMonth} new templates a month, forms, Scribe, every signing feature, your own email domain.</p><Doodle name="w-ok" size="6rem" /></div>
    <div class="col reveal" style="--i:1" {@attach shown(0.25)}><p class="eyebrow">Pro</p><p class="t-xxl"><Counter to={pro.monthlyMinor / 100} prefix="$" /><span class="per">/mo</span></p><p class="cap">{pro.founders ? `Founders price, kept while you stay; ${dollars(pro.listMonthlyMinor)} after.` : "Flat for the whole workspace."} {plans.pro.items.slice(0, 3).map((x) => x.charAt(0).toLowerCase() + x.slice(1)).join(", ")}.</p><Doodle name="stars" size="6rem" /></div>
    <div class="col reveal" style="--i:2" {@attach shown(0.25)}><p class="eyebrow">Self-hosted</p><p class="t-xxl">Free</p><p class="cap">Licensed under the AGPL-3.0, on your own server, unlimited documents. Pro items with a $390 a year licence per install.</p><Doodle name="key" size="6rem" /></div>
  </div>
  <div class="mt-10 flex flex-wrap gap-3"><a class="btn on-film" href="/pricing">See every plan</a><a class="btn ghost-film" href="/self-host">Run it yourself</a></div>
</div>
<style>
  .cols { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .col { padding: .5rem clamp(1rem, 3vw, 2.5rem) 1.5rem; border-left: 1px solid var(--black-line); } .col:first-child { border-left: 0; padding-left: 0; }
  .per { font-size: .22em; letter-spacing: 0; margin-left: .3em; color: var(--black-mute); font-family: var(--font-sans); font-weight: 500; }
  .cap { margin: .75rem 0 1.25rem; color: var(--black-mute); font-size: 1.05rem; max-width: 20rem; }
  @media (max-width: 800px) { .cols { grid-template-columns: 1fr; } .col { border-left: 0; border-top: 1px solid var(--black-line); padding-left: 0; } .col:first-child { border-top: 0; } }
</style>
