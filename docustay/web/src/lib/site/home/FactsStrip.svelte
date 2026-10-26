<script>
  import Counter from "$lib/fx/Counter.svelte";
  import { shown } from "$lib/fx/index.js";
  let { facts } = $props();
</script>
<div class="wrap">
  <ul class="facts">{#each facts as f, i}<li class="fact reveal" style="--i:{i}" {@attach shown(0.3)}><Counter class="t-xxl" to={f.to} suffix={f.suffix ?? ""} /><p>{f.label}</p></li>{/each}</ul>
</div>
<style>
  .facts { display: grid; grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr)); list-style: none; margin: 0; padding: 0; }
  .fact { padding: 1rem 1.75rem 1.5rem; border-left: 1px solid var(--black-line); } .fact:first-child { border-left: 0; padding-left: 0; }
  .fact p { margin-top: .5rem; color: var(--black-mute); font-size: 1.05rem; max-width: 16rem; }
  @media (max-width: 640px) { .fact { border-left: 0; border-top: 1px solid var(--black-line); padding-left: 0; } .fact:first-child { border-top: 0; } }
</style>
