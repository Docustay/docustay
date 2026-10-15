<script>
  import { reveal } from "./reveal.js";
  // One section: eyebrow, H2, sub, then the content. `tight` shortens the top space.
  let { eyebrow = "", title = "", sub = "", tight = false, id = undefined, children } = $props();
</script>
<section class="d-sec {tight ? 'tight' : ''}" {id} data-reveal {@attach reveal}>
  {#if eyebrow}<p class="d-eyebrow">{eyebrow}</p>{/if}
  {#if title}<h2 class="d-h2">{title}</h2>{/if}
  {#if sub}<p class="d-sub">{sub}</p>{/if}
  {#if children}<div class={title || sub ? "mt-9" : ""}>{@render children()}</div>{/if}
</section>
