<script>
  // A real product capture in a white frame (cream site): a window frame (desktop) or a phone frame. `src` is a capture from the sandbox demo workspace; never a drawn stand-in. width/height are required so nothing shifts.
  let { src = "", alt = "", width, height, kind = "window", title = "", caption = "", tilt = 0, eager = false, class: cls = "", children } = $props();
</script>
<figure class="fr {kind} {cls}" style="--tilt:{tilt}deg">
  <div class="shell">{#if kind === "window"}<div class="bar"><span class="dots" aria-hidden="true"><i></i><i></i><i></i></span>{#if title}<span class="ttl">{title}</span>{/if}</div>{:else}<span class="notch" aria-hidden="true"></span>{/if}
    <div class="scr">{#if src}<img {src} {alt} {width} {height} loading={eager ? "eager" : "lazy"} decoding="async" />{:else}{@render children?.()}{/if}</div></div>
  {#if caption}<figcaption>{caption}</figcaption>{/if}
</figure>
<style>
  .fr { margin: 0; min-width: 0; width: 100%; } .shell { border-radius: var(--r-4); border: 1px solid var(--ln-2); background: #fff; overflow: hidden; box-shadow: var(--sh-2); transform: perspective(1600px) rotateY(var(--tilt)); }
  .bar { display: flex; align-items: center; gap: 12px; padding: 11px 16px; border-bottom: 1px solid var(--ln-1); background: #faf9fe; } .dots { display: inline-flex; gap: 6px; } .dots i { width: 9px; height: 9px; border-radius: 50%; background: #dcd8ea; } .ttl { font: 12px var(--f-mono); color: var(--tx-3); }
  .scr { background: var(--doc-paper); } .scr img { display: block; width: 100%; height: auto; }
  .phone .shell { border-radius: 34px; max-width: 280px; margin: 0 auto; border-width: 6px; border-color: #16161d; position: relative; } .notch { position: absolute; z-index: 1; left: 50%; top: 8px; width: 70px; height: 18px; border-radius: 12px; background: #16161d; transform: translateX(-50%); }
  figcaption { margin-top: 12px; font: 12.5px var(--f-mono); color: var(--tx-3); text-align: center; }
  @media (max-width: 800px) { .shell { transform: none; } }
</style>
