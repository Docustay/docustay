<script>
  import { reveal } from "./reveal.js";
  import { feat, plain } from "./feat.js";
  let { items, id = "faq" } = $props();
  const ld = $derived(JSON.stringify({ "@context": "https://schema.org", "@type": "FAQPage", mainEntity: items.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: plain(a) } })) }));
</script>
<svelte:head>{@html `<script type="application/ld+json">${ld}</script>`}</svelte:head>
<div class="d-faq" {id} data-reveal {@attach reveal}>
  {#each items as [q, a]}{@const f = feat(a)}<details data-feature={f.ids}><summary>{q}</summary><p>{f.text}</p></details>{/each}
</div>
