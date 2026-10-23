<script>
  import Scene3D from "$lib/site/desk/Scene3D.svelte";
  // Scene sheet (builders only, 404 unless DOCUSTAY_DESIGN_PREVIEW=1): every scene with its poster. At most two run live at once.
  const NAMES = ["hero", "D", "cube", "papers", "lattice", "seal", "cards", "rings", "bg"];
</script>
<svelte:head><meta name="robots" content="noindex" /><title>Scene sheet</title></svelte:head>


  <section style="padding:120px 32px 60px;max-width:1280px;margin:0 auto">
    <h1 class="d-h1 sm">Scene sheet</h1>
    <p class="d-sub">Every Docustay 3D scene with its poster. At most two run live at once; the rest show the poster until a slot frees.</p>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(360px,1fr));gap:24px;margin-top:32px">
      {#each NAMES as n}<figure style="margin:0"><div style="border-radius:16px;overflow:hidden;border:1px solid var(--ln-2)"><Scene3D kind={n} /></div><figcaption class="d-fine">{n}</figcaption></figure>{/each}
    </div>
  </section>
