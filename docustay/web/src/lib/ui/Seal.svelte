<script>
  // The seal: the mark of a document everybody has signed. An outer ring, an inner dashed ring and a solid disc with a check, in seal ink; a mono date line under it when `date` is given.
  // `stamp` rotates it -9 degrees and plays the stamping motion once (reduced motion: it is simply there).
  import { t } from "$lib/i18n/index.svelte.js";
  let { size = 64, date = "", stamp = false, class: cls = "" } = $props();
</script>
<span class="inline-grid justify-items-center gap-1 {cls}" data-testid="seal">
  <svg viewBox="0 0 64 64" width={size} height={size} role="img" aria-label={t("Sealed")} class="{stamp ? 'seal-stamp' : ''}" style={stamp ? "transform: rotate(-9deg); animation: seal-stamp 520ms cubic-bezier(.2,.8,.2,1) both" : ""}>
    <circle cx="32" cy="32" r="29" fill="none" stroke="var(--seal)" stroke-width="2.2" />
    <circle cx="32" cy="32" r="24" fill="none" stroke="var(--seal)" stroke-width="1" stroke-dasharray="2 2.4" opacity=".7" />
    <circle cx="32" cy="32" r="16" fill="var(--seal)" />
    <path d="M24.5 32.5l5.2 5.4 9.8-10.6" fill="none" stroke="#fff" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" />
  </svg>
  {#if date}<span class="font-mono text-[11px] text-mute" data-testid="seal-date">{date}</span>{/if}
</span>
