<script>
  // LAUNCH · THE SIX-DIGIT CODE FIELD. ONE real text input (so paste, the phone's "from Messages/Mail" suggestion, a password manager and a screen reader all work) laid over six drawn boxes that
  // show the digits; the current box has a blinking caret. Completes itself when the sixth digit arrives (`oncomplete`). `invalid` shakes the row once and clears it; `busy` locks it with a scan line.
  import { t } from "$lib/i18n/index.svelte.js";
  let { value = $bindable(""), length = 6, invalid = false, busy = false, label = "", oncomplete = () => {}, id = "entry-code" } = $props();
  let input = $state(null), focused = $state(false), shaking = $state(false);
  const digits = $derived(value.replace(/\D/g, "").slice(0, length).split(""));
  const at = $derived(Math.min(digits.length, length - 1));
  function clean(e) { const v = e.currentTarget.value.replace(/\D/g, "").slice(0, length); value = v; e.currentTarget.value = v; if (v.length === length) oncomplete(v); }
  $effect(() => { if (invalid) shaking = true; });
  export function focus() { input?.focus(); }
  export function clear() { value = ""; input?.focus(); }
</script>
<div class="cb" class:focused class:busy class:shaking onanimationend={() => (shaking = false)} data-testid="code-boxes" role="group" aria-label={label || t("Six-digit code")}>
  {#each Array.from({ length }) as _, i}
    <span class="box" class:on={focused && i === at && digits.length < length} class:filled={digits[i] !== undefined} class:bad={invalid} aria-hidden="true">{digits[i] ?? ""}</span>
  {/each}
  <input {id} bind:this={input} class="real" type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="one-time-code" autocapitalize="off" spellcheck="false" maxlength={length * 2} value={value} oninput={clean} onfocus={() => (focused = true)} onblur={() => (focused = false)} disabled={busy} aria-label={label || t("Six-digit code")} aria-invalid={invalid || undefined} data-testid="signup-code" />
  {#if busy}<span class="scan" aria-hidden="true"></span>{/if}
</div>
<style>
  .cb { position: relative; display: grid; grid-template-columns: repeat(6, 1fr); gap: 8px; max-width: 360px; }
  .box { display: grid; place-items: center; height: 54px; border-radius: 12px; background: var(--card, #fff); border: 1px solid var(--line, #dcd9f2); font: 600 24px/1 var(--font-mono, ui-monospace, monospace); color: var(--ink, #14112b); transition: border-color 140ms, box-shadow 140ms, transform 140ms; }
  .box.filled { border-color: #8f8af8; transform: translateY(-1px); }
  .box.on { border-color: #5a3ac1; box-shadow: 0 0 0 3px rgb(90 58 193 / .22); }
  .box.on::after { content: ""; width: 2px; height: 26px; background: #5a3ac1; animation: cb-blink 1s steps(1) infinite; }
  .box.bad { border-color: var(--bad, #b3261e); }
  .real { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; font-size: 16px; cursor: text; }
  .cb.shaking { animation: cb-shake 360ms cubic-bezier(.36,.07,.19,.97) both; }
  .busy .box { opacity: .7; } .scan { position: absolute; inset: 0; border-radius: 12px; overflow: hidden; pointer-events: none; } .scan::before { content: ""; position: absolute; top: 0; bottom: 0; width: 28%; background: linear-gradient(90deg, transparent, rgb(143 138 248 / .45), transparent); animation: cb-scan 1.1s ease-in-out infinite; }
  @keyframes cb-blink { 50% { opacity: 0; } } @keyframes cb-scan { from { left: -30%; } to { left: 102%; } }
  @keyframes cb-shake { 10%, 90% { transform: translateX(-2px); } 20%, 80% { transform: translateX(4px); } 30%, 50%, 70% { transform: translateX(-6px); } 40%, 60% { transform: translateX(6px); } }
  @media (max-width: 420px) { .box { height: 48px; font-size: 21px; } .cb { gap: 6px; } }
  @media (prefers-reduced-motion: reduce) { .cb, .box, .scan::before, .box.on::after { animation: none !important; transition: none; } .scan::before { left: 0; width: 100%; opacity: .3; } .box.on::after { opacity: 1; } }
</style>
