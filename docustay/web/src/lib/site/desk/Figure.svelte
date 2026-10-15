<script>
  // A figure on the Desk: a panel on a fine grid, four corner ticks and a mono caption. `note` is the sample-data notice where data is illustrative.
  let { caption, note = "", id = undefined, class: cls = "", children } = $props();
</script>
<figure class="fig {cls}" {id} data-figure>
  <span class="tk a"></span><span class="tk b"></span><span class="tk c"></span><span class="tk d"></span>
  <div class="fig-body">{@render children()}</div>
  <figcaption>{caption}{#if note} · {note}{/if}</figcaption>
</figure>
