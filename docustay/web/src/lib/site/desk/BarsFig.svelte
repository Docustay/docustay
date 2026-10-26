<script>
  import { whenVisible } from "./reveal.js";
  // Horizontal bars in warm white; the key bar (the last by default) is red. rows: [[label, value 0..100]]
  let { rows } = $props();
  let on = $state(false);
</script>
<div class="grid gap-4" {@attach whenVisible((v) => v && (on = true))}>
  {#each rows as [label, v], i}
    <div><div class="mb-1.5 flex justify-between font-mono text-[11px] uppercase tracking-[.1em] text-[#a8a39a]"><span>{label}</span><span>{v}%</span></div>
      <div class="h-3 bg-[rgb(244_242_236/.07)]"><div class="h-full" style="width:{on ? v : 0}%;background:{i === rows.length - 1 ? '#8585fd' : 'rgb(244 242 236 / .8)'};transition:width .9s {i * 90}ms ease-out"></div></div></div>
  {/each}
</div>
