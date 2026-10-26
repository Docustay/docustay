<script>
  // Draw, type or upload a signature on a paper canvas. Everything happens in this page: nothing is uploaded, nothing is stored. `onchange(result)` gets { dataUrl, w, h } (a trimmed transparent PNG) or null when the canvas is empty.
  // Used by the signature generator and by the two PDF tools, so a signature made on one page looks the same on the others.
  import { onMount } from "svelte";
  let { onchange = () => {}, ink = $bindable("black"), showIntro = false, initialName = "", id = "sig" } = $props();
  const W = 1000, H = 300;
  const FACES = [["Caveat", "Caveat"], ["Dancing Script", "Dancing Script"], ["Reenie Beanie", "Reenie Beanie"]];
  const COLORS = { black: "#1b1b1b", blue: "#1f3fbf" };
  let canvas = $state(null), mode = $state("draw"), weight = $state(4), name = $state(initialName), face = $state(0), drawing = false, last = null, empty = $state(true), intro = $state(showIntro), keepWhite = $state(false), uploadName = $state("");
  let reduced = false;
  onMount(() => { reduced = matchMedia("(prefers-reduced-motion: reduce)").matches; if (reduced) intro = false; clearCanvas(); });
  const ctx = () => canvas.getContext("2d");
  function clearCanvas() { if (!canvas) return; ctx().clearRect(0, 0, W, H); empty = true; onchange(null); }
  const pos = (e) => { const r = canvas.getBoundingClientRect(); return [((e.clientX - r.left) * W) / r.width, ((e.clientY - r.top) * H) / r.height]; };
  function down(e) { if (mode !== "draw") return; intro = false; drawing = true; canvas.setPointerCapture(e.pointerId); last = pos(e); const g = ctx(); g.fillStyle = COLORS[ink]; g.beginPath(); g.arc(last[0], last[1], weight * 1.1, 0, 7); g.fill(); empty = false; }
  function move(e) { if (!drawing) return; const g = ctx(), p = pos(e); g.strokeStyle = COLORS[ink]; g.lineWidth = weight * 2.2; g.lineCap = "round"; g.lineJoin = "round"; g.beginPath(); g.moveTo(last[0], last[1]); g.quadraticCurveTo(last[0], last[1], (last[0] + p[0]) / 2, (last[1] + p[1]) / 2); g.stroke(); last = p; }
  function up() { if (!drawing) return; drawing = false; emit(); }
  function renderTyped() {
    if (!canvas) return; const g = ctx(); g.clearRect(0, 0, W, H); const t = name.trim(); empty = !t; if (!t) { onchange(null); return; }
    const fam = FACES[face][1]; let size = 170; g.textBaseline = "alphabetic"; g.fillStyle = COLORS[ink];
    do { g.font = `${face === 2 ? 400 : 700} ${size}px "${fam}", cursive`; size -= 6; } while (g.measureText(t).width > W - 80 && size > 40);
    g.fillText(t, 40, H * 0.68); emit();
  }
  $effect(() => { if (mode === "type") { name; face; ink; document.fonts?.load?.(`700 60px "${FACES[face][1]}"`).finally(renderTyped); } });
  $effect(() => { ink; if (mode === "draw") recolour(); });
  function recolour() { if (!canvas || empty) return; const g = ctx(), d = g.getImageData(0, 0, W, H), c = COLORS[ink], r = parseInt(c.slice(1, 3), 16), gr = parseInt(c.slice(3, 5), 16), b = parseInt(c.slice(5, 7), 16); for (let i = 0; i < d.data.length; i += 4) { if (d.data[i + 3]) { d.data[i] = r; d.data[i + 1] = gr; d.data[i + 2] = b; } } g.putImageData(d, 0, 0); emit(); }
  async function fromFile(e) {
    const f = e.currentTarget.files?.[0]; if (!f) return; uploadName = f.name;
    const url = URL.createObjectURL(f); const img = new Image();
    img.onload = () => {
      const g = ctx(); g.clearRect(0, 0, W, H); const s = Math.min((W - 40) / img.width, (H - 40) / img.height), w = img.width * s, h = img.height * s; g.drawImage(img, (W - w) / 2, (H - h) / 2, w, h); URL.revokeObjectURL(url);
      if (!keepWhite) { const d = g.getImageData(0, 0, W, H); for (let i = 0; i < d.data.length; i += 4) { const lum = (d.data[i] + d.data[i + 1] + d.data[i + 2]) / 3; if (lum > 225) d.data[i + 3] = 0; else if (lum > 170) d.data[i + 3] = Math.round(((225 - lum) / 55) * d.data[i + 3]); } g.putImageData(d, 0, 0); }
      empty = false; emit();
    };
    img.onerror = () => { URL.revokeObjectURL(url); uploadName = "That file could not be read as an image."; };
    img.src = url;
  }
  /** Trim to the ink and hand back a transparent PNG. */
  export function result() {
    if (!canvas || empty) return null; const g = ctx(), d = g.getImageData(0, 0, W, H).data; let x0 = W, y0 = H, x1 = 0, y1 = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (d[(y * W + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (x1 <= x0 || y1 <= y0) return null; const pad = 10, w = x1 - x0 + 1 + pad * 2, h = y1 - y0 + 1 + pad * 2, c = document.createElement("canvas"); c.width = w; c.height = h; c.getContext("2d").drawImage(canvas, x0 - pad, y0 - pad, w, h, 0, 0, w, h);
    return { dataUrl: c.toDataURL("image/png"), w, h };
  }
  function emit() { onchange(result()); }
  export function clear() { name = ""; uploadName = ""; clearCanvas(); }
  function setMode(m) { mode = m; clearCanvas(); if (m === "type") renderTyped(); }
</script>
<div class="cap" data-testid="signature-capture" id={id}>
  <div class="tabs" role="tablist" aria-label="How to make a signature">{#each [["draw", "Draw"], ["type", "Type"], ["upload", "Upload"]] as [k, l]}<button type="button" role="tab" aria-selected={mode === k} onclick={() => setMode(k)}>{l}</button>{/each}</div>
  <div class="paper"><canvas bind:this={canvas} width={W} height={H} class:drawable={mode === "draw"} onpointerdown={down} onpointermove={move} onpointerup={up} onpointercancel={up} aria-label={mode === "draw" ? "Signature area: draw with a finger, pen or mouse" : "Signature preview"} data-testid="sigcanvas"></canvas>
    {#if mode === "draw"}<span class="base" aria-hidden="true">×</span>{/if}
    {#if intro && mode === "draw" && empty}<svg class="intro" viewBox="0 0 1000 300" aria-hidden="true"><path d="M70 205 C 120 80, 170 80, 190 190 S 250 120, 290 170 S 340 230, 390 150 C 420 100, 450 110, 440 160 C 435 200, 500 190, 540 140 S 600 150, 585 195 S 700 120, 760 150 S 860 190, 930 130" /></svg>{/if}
  </div>
  <div class="row">
    {#if mode === "type"}<label class="f"><span>Your name</span><input bind:value={name} placeholder="Ada Lovelace" autocomplete="name" maxlength="60" data-testid="sigtext" /></label><div class="faces" role="group" aria-label="Handwriting style">{#each FACES as f, i}<button type="button" aria-pressed={face === i} onclick={() => (face = i)} style="font-family: '{f[1]}', cursive">{name.trim() || "Signature"}</button>{/each}</div>{/if}
    {#if mode === "upload"}<label class="f"><span>A picture of your signature</span><input type="file" accept="image/png,image/jpeg,image/webp" onchange={fromFile} data-testid="sigfile" /></label><label class="chk"><input type="checkbox" bind:checked={keepWhite} /> Keep the white background</label>{#if uploadName}<p class="note">{uploadName}</p>{/if}{/if}
    <div class="ctl"><fieldset class="ink"><legend>Ink</legend>{#each Object.keys(COLORS) as c}<label><input type="radio" name="ink-{id}" value={c} bind:group={ink} /><span class="dot" style="background:{COLORS[c]}"></span>{c === "black" ? "Black" : "Blue"}</label>{/each}</fieldset>
      {#if mode === "draw"}<label class="wt"><span>Weight</span><input type="range" min="1.5" max="8" step="0.5" bind:value={weight} aria-label="Pen weight" /></label>{/if}
      <button type="button" class="clear" onclick={clear}>Clear</button></div>
  </div>
</div>
<style>
  .cap { display: grid; gap: 14px; } .tabs { display: inline-flex; gap: 2px; border: 1px solid var(--hairline); border-radius: 8px; padding: 3px; width: fit-content; } .tabs button { background: none; border: 0; color: var(--tx-3); font: 500 14px/1 var(--font-sans); padding: 9px 18px; border-radius: 6px; cursor: pointer; } .tabs button[aria-selected="true"] { background: #faf8f3; color: #1b1b1b; font-weight: 600; }
  .paper { position: relative; background: #faf8f3; border-radius: 4px; box-shadow: 0 30px 60px rgb(60 40 140 / 0.248); aspect-ratio: 1000 / 300; overflow: hidden; } canvas { position: absolute; inset: 0; width: 100%; height: 100%; touch-action: none; } canvas.drawable { cursor: crosshair; }
  .base { position: absolute; left: 4%; bottom: 20%; color: var(--tx-2); font: 500 22px/1 var(--font-mono); pointer-events: none; } .paper::after { content: ""; position: absolute; left: 4%; right: 4%; bottom: 18%; border-top: 1.5px solid #cfc9bb; pointer-events: none; }
  .intro { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; } .intro path { fill: none; stroke: #1b1b1b; stroke-width: 5; stroke-linecap: round; stroke-linejoin: round; stroke-dasharray: 2200; stroke-dashoffset: 2200; animation: sigdraw 2.6s ease-in-out .3s infinite alternate; } @keyframes sigdraw { to { stroke-dashoffset: 0; } } @media (prefers-reduced-motion: reduce) { .intro { display: none; } }
  .row { display: grid; gap: 12px; } .f { display: grid; gap: 6px; font: 500 11px/1 var(--font-mono); letter-spacing: .1em; text-transform: uppercase; color: var(--tx-3); } .f input:not([type]) { background: #ffffff; border: 1px solid var(--hairline); border-radius: 6px; padding: 12px 14px; color: var(--tx-1); font: 500 16px/1 var(--font-sans); text-transform: none; letter-spacing: 0; max-width: 420px; } .f input[type="file"] { color: var(--tx-2); font: 500 14px/1 var(--font-sans); text-transform: none; letter-spacing: 0; }
  .faces { display: flex; gap: 10px; flex-wrap: wrap; } .faces button { background: #ffffff; border: 1px solid var(--hairline); color: var(--tx-1); border-radius: 6px; padding: 8px 16px; font-size: 26px; line-height: 1.2; cursor: pointer; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } .faces button[aria-pressed="true"] { border-color: rgb(90 58 193 / 0.5); }
  .chk { display: flex; gap: 8px; align-items: center; color: var(--tx-2); font-size: 14px; } .note { margin: 0; color: var(--tx-3); font-size: 13.5px; }
  .ctl { display: flex; gap: 22px; align-items: center; flex-wrap: wrap; } .ink { border: 0; padding: 0; margin: 0; display: flex; gap: 14px; align-items: center; } .ink legend { float: left; margin-right: 12px; font: 500 11px/1 var(--font-mono); letter-spacing: .1em; text-transform: uppercase; color: var(--tx-3); } .ink label { display: inline-flex; gap: 7px; align-items: center; color: var(--tx-1); font-size: 14px; cursor: pointer; } .ink input { position: absolute; opacity: 0; width: 1px; height: 1px; } .ink label { position: relative; } .ink input:checked + .dot { box-shadow: 0 0 0 2px #ffffff, 0 0 0 4px rgb(90 58 193 / 0.22); } .ink input:focus-visible + .dot { box-shadow: 0 0 0 2px #ffffff, 0 0 0 4px #f4f2ec; } .dot { width: 14px; height: 14px; border-radius: 50%; border: 1px solid #5a5a5e; }
  .wt { display: inline-flex; gap: 10px; align-items: center; font: 500 11px/1 var(--font-mono); letter-spacing: .1em; text-transform: uppercase; color: var(--tx-3); } .wt input { accent-color: #5a3ac1; width: 130px; } .clear { background: none; border: 1px solid var(--hairline); color: var(--tx-1); border-radius: 8px; font: 500 14px/1 var(--font-sans); padding: 10px 16px; cursor: pointer; }
</style>
