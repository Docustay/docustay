<script>
  import Paper from "./Paper.svelte";
  import Stamp from "./Stamp.svelte";
  // A paper sheet drawn from data: { title, meta, lines: n, fields: [{ label, red }], list: [[left, right]], stamp, button, tilt, float }.
  let { s } = $props();
</script>
<Paper tilt={s.tilt ?? 0} float={s.float ?? 0} class="sheet-x">
  {#if s.meta}<div class="pm">{s.meta}</div>{/if}
  {#if s.title}<div class="pt" style="margin-top:6px;font-size:{s.big ? 20 : 15}px">{s.title}</div>{/if}
  {#each Array(s.lines ?? 0) as _, i}<div class="pl" style="width:{[92, 100, 84, 70, 88, 60][i % 6]}%"></div>{/each}
  {#if s.list}<ul class="lst">{#each s.list as [a, b]}<li><span>{a}</span><em>{b}</em></li>{/each}</ul>{/if}
  {#if s.fields}<div class="frow">{#each s.fields as f}<div class="fld {f.red ? 'red' : ''}">{f.label}</div>{/each}</div>{/if}
  {#if s.button}<div class="sbtn">{s.button}</div>{/if}
  {#if s.hash}<div class="pm" style="margin-top:16px">{s.hash}</div>{/if}
  {#if s.stamp}<span class="sst"><Stamp text={s.stamp} /></span>{/if}
</Paper>
<style>
  :global(.sheet-x) { padding: 22px; } .frow { display: flex; gap: 10px; margin-top: 20px; } .frow .fld { flex: 1; }
  .lst { list-style: none; margin: 12px 0 0; padding: 0; display: grid; gap: 7px; } .lst li { display: flex; justify-content: space-between; gap: 10px; font: 500 12.5px/1.2 var(--font-sans); color: #1b1b1b; border-bottom: 1px solid #e6e2d8; padding-bottom: 7px; } .lst em { font: 500 10px/1.3 var(--font-mono); color: #6f6b63; font-style: normal; letter-spacing: .06em; text-transform: uppercase; align-self: center; }
  .sbtn { margin-top: 14px; display: inline-block; background: #1b1b1b; color: #f4f2ec; font: 600 12px/1 var(--font-sans); padding: 10px 14px; border-radius: 6px; } .sst { position: absolute; right: 16px; bottom: 18px; }
</style>
