<script>
  import { onMount } from "svelte";
  import SignaturePadLib from "signature_pad";
  let { label = "signature", defaultName = "", words, allowTyped = true, remember = false, onDone, onCancel } = $props();
  const P = $derived(words.pad), nm = $derived(P[label] ?? label);
  const MAX = 204800, W = 600, H = 200;
  // D-046: a remembered signature belongs to a NAME on this browser, so a different signer on the same browser is not offered someone else's
  const KEY = `docustay.saved.${label}.${String(defaultName ?? "").trim().toLowerCase().replace(/\s+/g, " ").slice(0, 80)}`;
  const stored = () => { try { return remember ? localStorage.getItem(KEY) : null; } catch { return null; } };
  let saved = $state(stored()), keep = $state(remember);
  let tab = $state("draw"), typed = $state(defaultName), problem = $state(null), canvas = $state(null), pad = null;
  function fit(c) { let url = c.toDataURL("image/png"), cur = c; while (url.length > MAX && cur.width > 120) { const n = document.createElement("canvas"); n.width = Math.round(cur.width * 0.75); n.height = Math.round(cur.height * 0.75); n.getContext("2d").drawImage(cur, 0, 0, n.width, n.height); cur = n; url = cur.toDataURL("image/png"); } return url.length <= MAX ? url : null; }
  $effect(() => {
    if (tab !== "draw" || !canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2), r = canvas.getBoundingClientRect();
    canvas.width = Math.round(r.width * dpr); canvas.height = Math.round(r.height * dpr); canvas.getContext("2d").scale(dpr, dpr);
    pad = new SignaturePadLib(canvas, { penColor: "#111", minWidth: 1, maxWidth: 2.8 });
    return () => pad?.off();
  });
  function done() {
    problem = null; let url = null;
    if (!allowTyped && tab !== "draw") tab = "draw";   // D-002: typed signatures are off for this organisation
    if (tab === "draw") { if (!pad || pad.isEmpty()) { problem = P.drawFirst(nm); return; } url = fit(canvas); }
    else { if (!typed.trim()) { problem = P.typeFirst; return; }
      const c = document.createElement("canvas"); c.width = W; c.height = H; const g = c.getContext("2d"); g.fillStyle = "#111"; g.textBaseline = "middle"; let size = 90;
      do { g.font = `${size}px "Snell Roundhand","Segoe Script","Brush Script MT",cursive`; size -= 4; } while (g.measureText(typed).width > W - 40 && size > 20);
      g.fillText(typed.trim(), 20, H / 2); url = fit(c); }
    if (!url) { problem = P.tooBig; return; }
    if (remember && keep && tab === "draw") { try { localStorage.setItem(KEY, url); } catch { /* private window: the signature simply is not remembered */ } }
    onDone(url, tab === "draw" ? "drawn" : "typed");
  }
  const useSaved = () => onDone(saved, "drawn");
  const forget = () => { try { localStorage.removeItem(KEY); } catch { /* nothing to forget */ } saved = null; };
</script>
<div class="space-y-3">
  {#if allowTyped}<div class="flex gap-2"><button type="button" class="btn !py-1.5 {tab === 'draw' ? 'primary' : ''}" onclick={() => (tab = "draw")}>{P.draw}</button><button type="button" class="btn !py-1.5 {tab === 'type' ? 'primary' : ''}" onclick={() => (tab = "type")}>{P.type}</button></div>{/if}
  {#if saved}<div class="flex items-center gap-2 rounded-lg border border-line bg-tint p-2"><img src={saved} alt={label === "initials" ? P.savedInitials : P.savedSignature} class="h-10" /><button type="button" class="btn primary !py-1.5" onclick={useSaved}>{label === "initials" ? P.useSavedInitials : P.useSavedSignature}</button><button type="button" class="text-xs underline" onclick={forget}>{P.forget}</button></div>{/if}
  {#if tab === "draw"}<canvas bind:this={canvas} class="h-40 w-full touch-none rounded-lg border border-line bg-card" aria-label={P.drawHere(nm)}></canvas>
  {:else}<input class="field" bind:value={typed} placeholder={P.yourName} aria-label={P.yourName} />{/if}
  {#if problem}<p class="text-sm text-bad" role="alert">{problem}</p>{/if}
  {#if remember && tab === "draw"}<label class="flex items-center gap-2 text-xs text-mute"><input type="checkbox" bind:checked={keep} />{label === "initials" ? P.rememberInitials : P.rememberSignature}</label>{/if}
  <div class="flex justify-end gap-2"><button type="button" class="btn" onclick={onCancel}>{P.cancel}</button><button type="button" class="btn primary" onclick={done}>{P.use(nm)}</button></div>
</div>
