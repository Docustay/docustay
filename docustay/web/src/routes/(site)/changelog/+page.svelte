<script>
  import SceneHero from "$lib/site/desk/SceneHero.svelte";
  import Blocks from "$lib/site/desk/Blocks.svelte"; import { ADD4_MISC } from "$lib/site/pages/pass4-misc.js";
  import DeskHead from "$lib/site/desk/DeskHead.svelte";
  import Closing from "$lib/site/desk/Closing.svelte";
  import { CHANGES } from "$lib/site/changelog.js";
  // Changelog (voice V4 Maker): dated entries, newest first; each says what changed in the words of a person who made it.
  let q = $state("");
  const list = $derived(CHANGES.filter((c) => !q.trim() || `${c.title} ${c.items.join(" ")}`.toLowerCase().includes(q.trim().toLowerCase())));
  const iso = (d) => { const m = /^(\w+) (\d{4})$/.exec(d); return m ? new Date(`${m[1]} 1, ${m[2]}`).toISOString().slice(0, 7) : d; };
</script>
<DeskHead title="Docustay changelog" description="What changed in Docustay, newest first, in the words of the people who built it." crumbs={[["Docustay", "/"], ["Changelog", "/changelog"]]} />
<svelte:head><link rel="alternate" type="application/atom+xml" title="Docustay changelog" href="/changelog.xml" /></svelte:head>
<SceneHero scene="papers" cls="clh">
  <p class="d-eyebrow">CHANGELOG</p>
  <h1 class="d-h1 sm">What <em>changed.</em></h1>
  <p class="d-sub">Newest first, in the words of the people who built it.</p>
  <div class="d-actions"><input type="search" bind:value={q} placeholder="Search the changelog" aria-label="Search the changelog" /><a class="d-btn alt" href="/changelog.xml">Subscribe</a></div>
</SceneHero>
<section class="d-wrap cl" data-page="/changelog" data-voice="V4" data-template="Changelog">
  <ol class="log">{#each list as c (c.title)}<li><time datetime={iso(c.date)}>{c.date}</time><article class="card"><p class="cnt">{c.items.length} {c.items.length === 1 ? "CHANGE" : "CHANGES"}</p><h2>{c.title}</h2><ul>{#each c.items as it}<li>{it}</li>{/each}</ul></article></li>{:else}<li>Nothing in the changelog matches “{q}”.</li>{/each}</ol>
</section>
<Blocks blocks={ADD4_MISC["/changelog"]} />
<Closing title="Try what is new." label="Get started free" href="/signup" keep={[["Features", "/features"], ["Developers", "/developers"], ["Status", "/status"]]} />
<style>
  .cl { padding-top: 40px; } .d-actions input { background: #ffffff; border: 1px solid var(--hairline); border-radius: 6px; padding: 12px 16px; color: var(--tx-1); font: 500 15px/1 var(--font-sans); width: 280px; max-width: 100%; }
  .log { list-style: none; margin: 48px 0 0; padding: 0; display: grid; } .log > li { display: grid; grid-template-columns: 180px minmax(0, 1fr); gap: 30px; padding: 28px 0; border-top: 1px solid var(--hairline); } .log time { font: 500 12px/1.8 var(--font-mono); letter-spacing: .1em; text-transform: uppercase; color: var(--tx-3); }
  .log h2 { margin: 0 0 12px; font: 600 24px/1.2 var(--font-sans); letter-spacing: -.02em; } .log ul { margin: 0; padding: 0 0 0 20px; list-style: disc; display: grid; gap: 9px; color: var(--tx-2); line-height: 1.6; max-width: 70ch; }
  .card { border: 1px solid var(--hairline); background: #ffffff; border-radius: 6px; padding: 26px 28px; } .cnt { margin: 0 0 10px; font: 500 11px/1 var(--font-mono); letter-spacing: .12em; color: var(--v-700); }
  @media (max-width: 700px) { .log > li { grid-template-columns: minmax(0, 1fr); gap: 8px; } }
</style>
