<script>
  // The top of an inner page on the Desk look: mono eyebrow, a Geist H1, the lede, the page's own buttons as children. Used by the pages that keep their own working parts (verify, status, contact, the tool).
  let { eyebrow = null, title, lede = null, icon = null, accent = "", art = null, tone = null, children } = $props();
</script>
<section class="d-wrap ph2">
  {#if eyebrow}<p class="d-eyebrow">{eyebrow}</p>{/if}
  <h1 class="d-h1 sm" style={eyebrow ? "" : "margin-top:0"}>{title}</h1>
  {#if lede}<p class="d-sub">{lede}</p>{/if}
  <div class="d-actions empty:hidden">{@render children?.()}</div>
</section>
<style> .ph2 { padding-top: 64px; padding-bottom: 28px; } .ph2 :global(.d-actions:empty) { display: none; } </style>
