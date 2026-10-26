<script>
  // The document seal: a white D on a violet seal (the new D; the old italic serif D is retired). Used on documents, certificates, e-mails and the hero object.
  let { size = 78, class: cls = "" } = $props();
</script>
<span class="seal {cls}" style="--sz:{size}px" aria-hidden="true"><img src="/brand/docustay-favicon-D-white.svg" alt="" width={Math.round(size * 0.44)} height={Math.round(size * 0.44)} /></span>
<style>
  .seal { display: inline-flex; align-items: center; justify-content: center; width: var(--sz); height: var(--sz); border-radius: 50%; background: radial-gradient(circle at 32% 28%, #b9aeff, #6a49e0 60%, #4e30b2); box-shadow: 0 14px 30px rgb(74 48 178 / .7), inset 0 2px 3px rgb(255 255 255 / .55); flex: none; }
  .seal img { display: block; width: auto; height: 44%; }
</style>
