<script>
  // The section kit's lighter blocks (screens, 3D scenes, steps, terminal replay, number strip) without the rest of Blocks, so the home page ships only what it draws.
  import Sec from "./Sec.svelte";
  import Figure from "./Figure.svelte";
  import Screen from "./Screen.svelte";
  import Story from "./Story.svelte";
  import Scene3D from "./Scene3D.svelte";
  import Console from "./Console.svelte";
  import { feat } from "./feat.js";
  let { blocks } = $props();
</script>
{#each blocks as b}
  {#if b.t === "screen" || b.t === "scene"}
    <Sec id={b.id} tight>
      <div class="d-split" class:rev={b.rev}>
        <div><p class="d-eyebrow">{b.eyebrow}</p><h2 class="d-h2">{b.h2}</h2><p class="d-sub" data-feature={feat(b.sub).ids}>{feat(b.sub).text}</p>
          {#if b.notes}<dl class="nts">{#each b.notes as [h, p]}{@const x = feat(p)}<div data-feature={x.ids}><dt>{h}</dt><dd>{x.text}</dd></div>{/each}</dl>{/if}
          {#if b.actions}<div class="d-actions" style="margin-top:22px">{#each b.actions as [l, h, k]}<a class="d-btn {k ?? 'alt'}" href={h}>{l}</a>{/each}</div>{/if}</div>
        <div class="sp-art"><Figure caption={b.caption} note={b.note ?? (b.t === "scene" ? "3D · PLAYS WHEN IN VIEW" : "SAMPLE DATA")}>{#if b.t === "screen"}<Screen kind={b.kind} />{:else}<Scene3D kind={b.kind} />{/if}</Figure></div>
      </div>
    </Sec>
  {:else if b.t === "story"}
    <Story {b} />
  {:else if b.t === "console"}
    <Sec id={b.id} eyebrow={b.eyebrow} title={b.h2} sub={b.sub} tight>
      <div class="d-split" class:rev={b.rev}><div>{#if b.notes}<dl class="nts">{#each b.notes as [h, p]}{@const x = feat(p)}<div data-feature={x.ids}><dt>{h}</dt><dd>{x.text}</dd></div>{/each}</dl>{/if}</div><Console lines={b.lines} title={b.title ?? "terminal"} /></div>
    </Sec>
  {:else if b.t === "strip"}
    <Sec id={b.id} eyebrow={b.eyebrow} title={b.h2} sub={b.sub ? feat(b.sub).text : ""} tight>
      <ul class="strip">{#each b.items as [big, label, sub]}{@const x = feat(sub ?? "")}<li data-feature={x.ids}><b>{big}</b><span>{label}</span>{#if sub}<small>{x.text}</small>{/if}</li>{/each}</ul>
    </Sec>
  {/if}
{/each}
<style>
  .rev .sp-art { order: -1; } @media (max-width: 900px) { .rev .sp-art { order: 0; } }
  .nts { margin: 22px 0 0; display: grid; gap: 0; } .nts > div { display: grid; grid-template-columns: 130px 1fr; gap: 14px; padding: 12px 0; border-top: 1px solid #222224; } .nts dt { font: 600 14px/1.45 var(--font-sans); color: #f4f2ec; } .nts dd { margin: 0; color: #a8a39a; line-height: 1.55; font-size: 15px; }
  .strip { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); border: 1px solid #2a2a2c; border-radius: 6px; } .strip li { padding: 22px 22px 20px; display: grid; gap: 4px; border-left: 1px solid #2a2a2c; } .strip li:first-child { border-left: 0; } .strip b { font: 600 clamp(28px, 4vw, 40px)/1.05 var(--font-sans); letter-spacing: -.03em; } .strip span { color: #c9c5bb; font-size: 14.5px; } .strip small { color: #8f8a80; font-size: 12.5px; line-height: 1.45; }
  @media (max-width: 700px) { .nts > div { grid-template-columns: 1fr; gap: 4px; } .strip li { border-left: 0; border-top: 1px solid #2a2a2c; } .strip li:first-child { border-top: 0; } }
</style>
