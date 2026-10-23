<script>
  // A document thumbnail (the ONLY box in the combined style). Draws a white page with a folded corner, a heading bar, text bars and a dashed field box (draft: grey heading; sealed: a small seal
  // instead of the field box). With `src` (the first page of the real document) it shows that, and falls back to the drawn page if the picture is not there (a draft with no file, a slow link).
  // Sizes: 28x35 in rows, 22x28 stacked under people, 70 to 112 wide in galleries on a backplate.
  let { width = 28, kind = "", src = "", alt = "", backplate = false, class: cls = "", testid = "" } = $props();
  const h = $derived(Math.round(width * 76 / 60));
  let broken = $state(false);
  const draft = $derived(kind === "draft"), sealed = $derived(kind === "sealed" || kind === "executed" || kind === "completed");
</script>
<span class="thumb {backplate ? 'thumb-plate' : ''} {cls}" style="--tw:{width}px; --th:{h}px" data-testid={testid || undefined}>
  {#if src && !broken}
    <img {src} alt={alt} width={width} height={h} loading="lazy" decoding="async" onerror={() => (broken = true)} class="thumb-img" />
  {:else}
    <svg viewBox="0 0 60 76" width={width} height={h} role="img" aria-label={alt || undefined} aria-hidden={alt ? undefined : "true"} class="thumb-svg">
      <path d="M2.5 2.5H45L57.5 15V73.5H2.5Z" fill="#fff" stroke="#cdcdd9" stroke-width="1.2" />
      <path d="M45 2.5V15H57.5" fill="#f1f1f6" stroke="#cdcdd9" stroke-width="1.2" />
      <rect x="9" y="10" width="26" height="5" rx="2" fill={draft ? "#cdcdd9" : "#5a3ac1"} />
      {#each [25, 32, 39, 46] as y, i}<rect x="9" y={y} width={[42, 38, 42, 28][i]} height="3" rx="1.5" fill="#e4e4ec" />{/each}
      {#if sealed}
        <circle cx="46" cy="62" r="8.5" fill="none" stroke="#2a1a6b" stroke-width="1.6" /><circle cx="46" cy="62" r="5.4" fill="#2a1a6b" /><path d="M43.4 62.2l1.9 1.9 3.5-3.8" fill="none" stroke="#fff" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" />
      {:else}
        <rect x="9" y="56" width="30" height="11" rx="2" fill="none" stroke={draft ? "#cdcdd9" : "#a99bde"} stroke-width="1.2" stroke-dasharray="3 2.5" />
      {/if}
    </svg>
  {/if}
</span>
<style>
  .thumb { display: inline-block; flex: none; line-height: 0; width: var(--tw); height: var(--th); border-radius: 2px; overflow: hidden; }
  .thumb-plate { width: auto; height: auto; padding: 14px 0; display: grid; place-items: center; background: var(--plate); border-radius: 4px; }
  .thumb-img { display: block; width: var(--tw); height: var(--th); object-fit: cover; object-position: top; background: #fff; border: 1px solid var(--line-strong); border-radius: 2px; }
  .thumb-svg { display: block; }
</style>
