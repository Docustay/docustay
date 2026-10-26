<script>
  import { drawPage } from "./pdf.js";
  let { pdf, pageNumber, width, children } = $props();
  let canvas = $state(null), height = $state(Math.round(width * 1.294));
  $effect(() => { if (pdf && canvas) drawPage(pdf, pageNumber, canvas, width).then((h) => (height = h)).catch(() => {}); });
</script>
<div class="on-paper relative mx-auto overflow-hidden rounded-sm shadow-md ring-1 ring-black/5" style="width:{width}px;height:{height}px">
  <canvas bind:this={canvas}></canvas>
  {@render children?.()}
</div>
