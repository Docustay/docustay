<script>
  // The sign-a-PDF and fill-a-PDF tools (one component, `mode` = "sign" | "fill"). The file is read, drawn and written in this page by pdf.js and pdf-lib: it is never uploaded and no request carries it.
  // Items are described in pdfModel.js. Detected suggestions (a future pre-placing step) arrive through runDetectors() and are shown dashed until the visitor accepts them.
  import { onMount, tick } from "svelte";
  // pdf.js is loaded only when a file is opened, so the page itself stays light
  let pdfLib = null; const engine = async () => (pdfLib ??= await import("$lib/pdf.js"));
  import SignatureCapture from "./SignatureCapture.svelte";
  import { newId, defaultSize, pageGeometry, todayText, clamp, initialsOf, runDetectors, MAX_BYTES } from "./pdfModel.js";
  import { writePdf, readFields } from "./pdfWrite.js";
  let { mode = "sign" } = $props();
  const sign = mode === "sign";
  let bytes = $state(null), fileName = $state(""), pdf = $state(null), geoms = $state([]), cur = $state(1), items = $state([]), sel = $state(null), tool = $state(null), busy = $state(""), err = $state(""), notes = $state([]), done = $state(null);
  let sigImg = $state(null), iniImg = $state(null), ink = $state("black"), sigName = $state(""), flatten = $state(true), over = $state(false), stageW = $state(640), canvas = $state(null), pageEl = $state(null), hadFields = $state(null), suggestions = $state(0);
  const ZOOM = [0.6, 0.8, 1, 1.25, 1.5]; let zoom = $state(2);
  const geom = $derived(geoms[cur - 1] ?? { w: 612, h: 792 });
  const width = $derived(Math.max(240, Math.min(stageW - 2, 900)) * ZOOM[zoom] / ZOOM[2]);
  const k = $derived(width / geom.w);
  const here = $derived(items.filter((i) => i.page === cur));
  const canExport = $derived(items.some((i) => (i.type === "field" ? (i.value !== "" && i.value !== false && i.value != null) : (i.type === "signature" || i.type === "initials" ? !!i.image : i.type === "check" ? true : !!i.value))));
  let rendering = 0;
  async function paint() { if (!pdf || !canvas) return; const my = ++rendering; try { await (await engine()).drawPage(pdf, cur, canvas, width); } catch (e) { if (my === rendering) err = "This page could not be drawn."; } }
  $effect(() => { pdf; cur; width; canvas; paint(); });
  async function open(file) {
    err = ""; notes = []; done = null; if (!file) return;
    if (!/pdf$/i.test(file.type) && !/\.pdf$/i.test(file.name)) { err = "That is not a PDF. Choose a file that ends in .pdf."; return; }
    if (file.size > MAX_BYTES) { err = "That file is over 150 MB. Try a smaller copy."; return; }
    busy = "Opening…";
    try {
      const buf = new Uint8Array(await file.arrayBuffer()); const copy = buf.slice(); const doc = await (await engine()).loadPdf(buf);
      const g = []; for (let i = 1; i <= doc.numPages; i++) g.push(pageGeometry(await doc.getPage(i)));
      bytes = copy; pdf = doc; geoms = g; fileName = file.name; cur = 1; items = []; sel = null; tool = null; hadFields = null; suggestions = 0;
      if (!sign) { try { const fs = await readFields(copy, g); hadFields = fs.length > 0; items = fs.map((f) => ({ id: newId(), type: "field", page: f.page, x: f.x, y: f.y, w: f.w, h: f.h, value: f.value, source: "pdf", field: { kind: f.kind, name: f.name, option: f.option, options: f.options } })); } catch { hadFields = false; } }
      const found = await runDetectors({ bytes: copy, pdf: doc, pages: g }); if (found.length) { items = [...items, ...found]; suggestions = found.length; }
    } catch (e) {
      const m = String(e?.message ?? e); err = /password|encrypt/i.test(m) ? "This PDF is locked with a password, so it cannot be opened here. Remove the password first." : "This file could not be opened as a PDF. It may be damaged.";
      bytes = null; pdf = null;
    } finally { busy = ""; }
  }
  const pick = (e) => open(e.currentTarget.files?.[0]);
  function drop(e) { e.preventDefault(); over = false; open(e.dataTransfer?.files?.[0]); }
  function reset() { bytes = null; pdf = null; items = []; fileName = ""; sel = null; tool = null; err = ""; done = null; notes = []; hadFields = null; }
  // --- placing ---
  function stagePoint(e) { const r = pageEl.getBoundingClientRect(); return [((e.clientX - r.left) / r.width) * geom.w, ((e.clientY - r.top) / r.height) * geom.h]; }
  function place(e) {
    if (!tool || e.target !== e.currentTarget && !e.target.classList?.contains("cv")) return;
    const [px, py] = stagePoint(e); add(tool, px, py); if (tool !== "text" || !sign) { /* keep the tool armed for repeated marks */ }
  }
  let kbd = false;
  function add(type, px, py) {
    let [w, h] = defaultSize(type); const it = { id: newId(), type, page: cur, x: 0, y: 0, w, h, source: "user", size: 12 };
    if (type === "signature") { if (!sigImg) return; it.image = sigImg.dataUrl; h = Math.round(w * sigImg.h / sigImg.w); it.h = h; }
    if (type === "initials") { if (!iniImg) return; it.image = iniImg.dataUrl; it.h = Math.round(w * iniImg.h / iniImg.w); }
    if (type === "date") it.value = todayText(); if (type === "text") it.value = "";
    it.x = clamp(px - it.w / 2, 0, geom.w - it.w); it.y = clamp(py - it.h / 2, 0, geom.h - it.h);
    items = [...items, it]; sel = it.id; if (type === "text" || type === "date") tick().then(() => document.getElementById(`ed-${it.id}`)?.focus()); else if (kbd) tick().then(() => document.getElementById(`it-${it.id}`)?.focus());
  }
  function addCentre(type) { tool = type; add(type, geom.w / 2, geom.h / 2.4); }
  // keyboard and switch users: a button places the armed mark near the bottom right of the page, then focus moves to it and the arrow keys move it (Shift for bigger steps)
  function placeHere() { if (!tool) return; kbd = true; try { add(tool, geom.w * 0.68, geom.h * 0.86); } finally { kbd = false; } }
  function remove(id) { items = items.filter((i) => i.id !== id); if (sel === id) sel = null; }
  function accept(id) { items = items.map((i) => (i.id === id ? { ...i, source: "user" } : i)); }
  // --- drag and resize (pointer events; arrow keys do the same) ---
  let drag = null;
  function startDrag(e, it, how) { if (e.button > 0) return; e.stopPropagation(); sel = it.id; drag = { id: it.id, how, sx: e.clientX, sy: e.clientY, ox: it.x, oy: it.y, ow: it.w, oh: it.h }; e.currentTarget.setPointerCapture(e.pointerId); }
  function moveDrag(e) {
    if (!drag) return; const dx = (e.clientX - drag.sx) / k, dy = (e.clientY - drag.sy) / k;
    items = items.map((i) => { if (i.id !== drag.id) return i; if (drag.how === "move") return { ...i, x: clamp(drag.ox + dx, 0, geom.w - i.w), y: clamp(drag.oy + dy, 0, geom.h - i.h) };
      const ratio = drag.ow / drag.oh, w = clamp(drag.ow + dx, 12, geom.w - drag.ox), keep = i.type === "signature" || i.type === "initials" || i.type === "check"; return { ...i, w, h: keep ? w / ratio : clamp(drag.oh + dy, 10, geom.h - drag.oy) }; });
  }
  const endDrag = () => { drag = null; };
  function keys(e, it) {
    const step = e.shiftKey ? 10 : 2; const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (d && e.target === e.currentTarget) { e.preventDefault(); items = items.map((i) => (i.id === it.id ? { ...i, x: clamp(i.x + d[0], 0, geom.w - i.w), y: clamp(i.y + d[1], 0, geom.h - i.h) } : i)); }
    else if ((e.key === "Delete" || e.key === "Backspace") && e.target === e.currentTarget) { e.preventDefault(); remove(it.id); }
  }
  // --- signature ---
  let sigOpen = $state(sign), draftSig = $state(null);
  function useSig() { if (!draftSig) return; sigImg = draftSig; iniImg = null; sigOpen = false; tool = "signature"; }
  async function makeInitials() {
    const c = document.createElement("canvas"); c.width = 400; c.height = 200; const g = c.getContext("2d"), t = initialsOf(sigName) || "AB";
    await document.fonts?.load?.('700 120px "Caveat"'); g.fillStyle = ink === "blue" ? "#1f3fbf" : "#1b1b1b"; g.font = '700 130px "Caveat", cursive'; g.textBaseline = "middle"; g.fillText(t, 20, 100);
    iniImg = { dataUrl: c.toDataURL("image/png"), w: 400, h: 200 }; tool = "initials";
  }
  // --- download ---
  async function download() {
    err = ""; busy = "Writing your copy…"; done = null;
    try { const r = await writePdf(bytes, items.filter((i) => i.source !== "detected"), { flatten }); notes = r.notes; const blob = new Blob([r.bytes], { type: "application/pdf" }), url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = fileName.replace(/\.pdf$/i, "") + (sign ? "-signed.pdf" : "-filled.pdf"); document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000); done = { size: r.bytes.length }; }
    catch (e) { err = "Your copy could not be written. " + String(e?.message ?? e).slice(0, 120); } finally { busy = ""; }
  }
  const toolList = $derived(sign ? [["signature", "Signature"], ["initials", "Initials"], ["date", "Date"], ["text", "Text"], ["check", "Check"]] : [["text", "Text"], ["check", "Check"], ["date", "Date"]]);
  const kb = (n) => (n > 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.round(n / 1024) + " KB");
</script>
<div class="pt" data-mode={mode}>
  {#if !pdf}
    <div class="drop" class:over role="group" aria-label="Choose a PDF" ondragover={(e) => { e.preventDefault(); over = true; }} ondragleave={() => (over = false)} ondrop={drop}>
      <p class="d-eyebrow" style="margin:0">{sign ? "STEP 1 OF 3" : "STEP 1 OF 2"}</p>
      <h2>Choose a PDF.</h2>
      <p class="hint">Drop a file here or choose one. It opens in this page. It is not uploaded.</p>
      <label class="d-btn main pick">Choose a PDF<input type="file" accept="application/pdf,.pdf" onchange={pick} data-testid="pdf-input" /></label>
      {#if busy}<p class="hint" role="status">{busy}</p>{/if}
      {#if err}<p class="err" role="alert">{err}</p>{/if}
    </div>
  {:else}
    <div class="bar">
      <div class="file"><b title={fileName}>{fileName}</b><span>{geoms.length} {geoms.length === 1 ? "page" : "pages"} · {kb(bytes.length)}</span></div>
      <div class="tools" role="toolbar" aria-label="Add to the page">
        {#each toolList as [t, label]}<button type="button" class="tb" class:on={tool === t} aria-pressed={tool === t} onclick={() => { if (t === "signature" && !sigImg) { sigOpen = true; return; } if (t === "initials" && !iniImg) { if (!sigImg && !sigName) { sigOpen = true; return; } makeInitials(); return; } tool = tool === t ? null : t; }} data-testid={`tool-${t}`}>{label}</button>{/each}
        <span class="sp"></span>
        <button type="button" class="tb" onclick={() => (zoom = Math.max(0, zoom - 1))} aria-label="Zoom out" disabled={zoom === 0}>−</button>
        <button type="button" class="tb" onclick={() => (zoom = Math.min(ZOOM.length - 1, zoom + 1))} aria-label="Zoom in" disabled={zoom === ZOOM.length - 1}>+</button>
        <button type="button" class="tb ghost" onclick={reset}>Other file</button>
      </div>
    </div>
    {#if tool}<p class="armed" role="status">{tool === "signature" ? "Click the page where the signature goes." : tool === "initials" ? "Click the page where the initials go." : tool === "date" ? "Click the page where the date goes." : tool === "check" ? "Click the page to add a check mark." : "Click the page to add text."} Press the tool again to stop. <button type="button" class="tb" onclick={placeHere} data-testid="place-here">Place it here</button> <span class="kh">Then move it with the arrow keys; hold Shift for bigger steps.</span></p>{/if}
    {#if sigOpen}
      <div class="sigp" role="region" aria-label="Make your signature">
        <SignatureCapture bind:ink onchange={(r) => (draftSig = r)} id="pdf-sig" />
        <div class="row"><label class="nm">Your name, for initials<input type="text" bind:value={sigName} autocomplete="name" placeholder="Full name" /></label>
          <button type="button" class="d-btn main" onclick={useSig} disabled={!draftSig} data-testid="use-signature">Use this signature</button>
          {#if sigImg}<button type="button" class="d-btn alt" onclick={() => (sigOpen = false)}>Close</button>{/if}</div>
      </div>
    {:else if sign}
      <p class="mini"><button type="button" class="lnk" onclick={() => (sigOpen = true)}>{sigImg ? "Change signature" : "Make a signature"}</button>{#if sigImg}<img alt="Your signature" src={sigImg.dataUrl} class="thumb" />{/if}</p>
    {/if}
    {#if !sign && hadFields === false}<p class="note" role="status">This PDF has no fillable fields. Choose Text, Check or Date, then click the page where it goes.</p>{/if}
    {#if !sign && hadFields}<p class="note" role="status">Fillable fields found. Click a field and type.</p>{/if}
    {#if suggestions}<p class="note" role="status">{suggestions} suggested {suggestions === 1 ? "place" : "places"} (dashed). Click one to accept it.</p>{/if}
    <div class="layout">
      <ol class="thumbs" aria-label="Pages">{#each geoms as g, i}<li><button type="button" class:on={cur === i + 1} onclick={() => (cur = i + 1)} aria-label={`Page ${i + 1}`} aria-current={cur === i + 1 ? "page" : undefined}><span class="tpg" style={`aspect-ratio:${g.w}/${g.h}`}>{i + 1}</span>{#if items.some((x) => x.page === i + 1 && x.source !== "detected")}<i class="dot" aria-hidden="true"></i>{/if}</button></li>{/each}</ol>
      <div class="stage" bind:clientWidth={stageW}>
        <div class="sheet" bind:this={pageEl} style={`width:${width}px;height:${geom.h * k}px`} class:placing={!!tool} onclick={place} role="presentation" data-testid="page">
          <canvas class="cv" bind:this={canvas}></canvas>
          {#each here as it (it.id)}
            {@const st = `left:${it.x * k}px;top:${it.y * k}px;width:${it.w * k}px;height:${it.h * k}px`}
            {#if it.type === "field"}
              <div class="fld" style={st} class:sel={sel === it.id}>
                {#if it.field.kind === "text"}<input id={`ed-${it.id}`} type="text" aria-label={it.field.name} bind:value={it.value} style={`font-size:${Math.max(9, Math.min(it.h * k * 0.62, 16))}px`} onfocus={() => (sel = it.id)} />
                {:else if it.field.kind === "check"}<input id={`ed-${it.id}`} type="checkbox" aria-label={it.field.name} bind:checked={it.value} />
                {:else if it.field.kind === "radio"}<input id={`ed-${it.id}`} type="radio" aria-label={`${it.field.name}: ${it.field.option ?? ""}`} checked={it.value === it.field.option} onclick={() => { items = items.map((x) => (x.field?.name === it.field.name && x.field.kind === "radio" ? { ...x, value: x.id === it.id ? it.field.option : "" } : x)); }} />
                {:else}<select id={`ed-${it.id}`} aria-label={it.field.name} bind:value={it.value}><option value=""></option>{#each it.field.options ?? [] as o}<option value={o}>{o}</option>{/each}</select>{/if}
              </div>
            {:else}
              <div class="it" id={`it-${it.id}`} class:sel={sel === it.id} class:det={it.source === "detected"} style={st} tabindex="0" role="group" aria-label={`${it.type} on page ${it.page}`}
                onpointerdown={(e) => startDrag(e, it, "move")} onpointermove={moveDrag} onpointerup={endDrag} onkeydown={(e) => keys(e, it)} onfocus={() => (sel = it.id)}>
                {#if it.type === "signature" || it.type === "initials"}{#if it.image}<img alt="" src={it.image} draggable="false" />{:else}<span class="ph">{it.label || it.type}</span>{/if}
                {:else if it.type === "check"}<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 11l5 5 9-12" fill="none" stroke="#1b1b1b" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" /></svg>
                {:else}<input id={`ed-${it.id}`} type="text" class="tx" aria-label={it.type === "date" ? "Date" : "Text"} bind:value={it.value} style={`font-size:${(it.size ?? 12) * k}px`} placeholder={it.type === "date" ? "Date" : "Type here"} onpointerdown={(e) => e.stopPropagation()} />{/if}
                {#if sel === it.id}<button type="button" class="x" aria-label="Remove" onpointerdown={(e) => e.stopPropagation()} onclick={() => remove(it.id)}>×</button>
                  {#if it.type !== "text" && it.type !== "date"}<span class="rz" aria-hidden="true" onpointerdown={(e) => startDrag(e, it, "size")} onpointermove={moveDrag} onpointerup={endDrag}></span>{/if}
                  {#if it.source === "detected"}<button type="button" class="ok" onpointerdown={(e) => e.stopPropagation()} onclick={() => accept(it.id)}>Accept</button>{/if}{/if}
              </div>
            {/if}
          {/each}
        </div>
        <div class="pager"><button type="button" class="tb" onclick={() => (cur = Math.max(1, cur - 1))} disabled={cur === 1} aria-label="Previous page">‹</button><span aria-live="polite">Page {cur} of {geoms.length}</span><button type="button" class="tb" onclick={() => (cur = Math.min(geoms.length, cur + 1))} disabled={cur === geoms.length} aria-label="Next page">›</button></div>
      </div>
    </div>
    <div class="out">
      <div>
        <p class="d-eyebrow" style="margin:0">{sign ? "STEP 3 OF 3" : "STEP 2 OF 2"}</p>
        {#if !sign}<label class="chk"><input type="checkbox" bind:checked={flatten} /> Make the fields non-editable in the copy</label>{/if}
        <p class="hint">{sign ? "This is a simple picture of your signature placed on a copy of the PDF. It is not sealed and not recorded, and it is not a signed record." : "This writes your answers into a copy of the PDF. The original file is not changed."}</p>
      </div>
      <button type="button" class="d-btn main" onclick={download} disabled={!canExport || !!busy} data-testid="download">{busy || (sign ? "Download signed copy" : "Download filled copy")}</button>
    </div>
    {#if err}<p class="err" role="alert">{err}</p>{/if}
    {#if done}<p class="okmsg" role="status">Your copy ({kb(done.size)}) was made in this page and downloaded. Nothing was sent anywhere.</p>{/if}
    {#each notes as n}<p class="note">{n}</p>{/each}
  {/if}
</div>
<style>
  .pt { margin-top: 32px; display: grid; gap: 16px; color: var(--tx-1); } .hint { color: var(--tx-3); font-size: 14px; line-height: 1.55; margin: 6px 0 0; max-width: 64ch; }
  .drop { border: 1.5px dashed var(--hairline); border-radius: 8px; padding: 56px 24px; text-align: center; background: #ffffff; display: grid; gap: 10px; justify-items: center; } .drop.over { border-color: #5a3ac1; background: #ffffff; } .drop h2 { margin: 0; font: 600 28px/1.15 var(--font-sans); letter-spacing: -.02em; }
  .pick { position: relative; cursor: pointer; } .pick input { position: absolute; inset: 0; opacity: 0; cursor: pointer; width: 100%; }
  .err { color: #b4233c; margin: 4px 0 0; font-size: 14px; } .okmsg { color: #1c7448; margin: 0; font-size: 14px; } .note { color: var(--tx-2); font-size: 14px; margin: 0; }
  .bar { display: flex; flex-wrap: wrap; gap: 12px 18px; align-items: center; justify-content: space-between; } .file { display: grid; min-width: 0; } .file b { font: 600 15px/1.3 var(--font-sans); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 36ch; } .file span { color: var(--tx-3); font: 12px/1.4 var(--font-mono); }
  .tools { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; } .sp { width: 8px; }
  .tb { background: #ece9f6; color: var(--tx-1); border: 1px solid var(--hairline); border-radius: 6px; padding: 9px 14px; font: 500 14px/1 var(--font-sans); cursor: pointer; min-height: 40px; min-width: 40px; } .tb:hover:not(:disabled) { border-color: #777; } .tb.on { background: #f4f2ec; color: #111; border-color: #f4f2ec; } .tb:disabled { opacity: .4; cursor: default; } .tb.ghost { background: transparent; } .tb:focus-visible, .lnk:focus-visible, .it:focus-visible { outline: 2px solid var(--v-700); outline-offset: 2px; }
  .kh { color: var(--tx-3); font-size: 13px; margin-left: 6px; } .armed .tb { margin-left: 8px; min-height: 36px; padding: 7px 12px; }
  .armed { margin: 0; padding: 10px 14px; border-left: 3px solid #5a3ac1; background: #ffffff; font-size: 14px; color: var(--tx-1); }
  .sigp { background: #ffffff; border: 1px solid var(--hairline); border-radius: 8px; padding: 18px; display: grid; gap: 14px; } .row { display: flex; flex-wrap: wrap; gap: 12px; align-items: end; } .nm { display: grid; gap: 4px; font-size: 13px; color: var(--tx-3); } .nm input { background: #ffffff; color: var(--tx-1); border: 1px solid var(--hairline); border-radius: 6px; padding: 10px; font: 15px var(--font-sans); min-height: 40px; }
  .mini { margin: 0; display: flex; gap: 12px; align-items: center; } .lnk { background: none; border: 0; color: var(--tx-1); text-decoration: underline; text-underline-offset: 3px; cursor: pointer; font: inherit; padding: 4px 0; } .thumb { height: 30px; background: #faf8f3; border-radius: 3px; padding: 2px 6px; }
  .layout { display: grid; grid-template-columns: 76px minmax(0, 1fr); gap: 16px; align-items: start; }
  .thumbs { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; max-height: 80vh; overflow: auto; } .thumbs button { position: relative; width: 100%; padding: 4px; background: #ece9f6; border: 1px solid var(--hairline); border-radius: 4px; cursor: pointer; } .thumbs button.on { border-color: #f4f2ec; } .tpg { display: grid; place-items: center; background: #faf8f3; color: #555; font: 600 14px var(--font-mono); } .dot { position: absolute; right: 6px; top: 6px; width: 8px; height: 8px; border-radius: 50%; background: #5a3ac1; }
  .stage { min-width: 0; display: grid; gap: 12px; justify-items: center; overflow-x: auto; }
  .sheet { position: relative; background: #faf8f3; box-shadow: 0 30px 60px rgb(60 40 140 / 0.248); touch-action: pan-y; } .sheet.placing { cursor: crosshair; } .cv { display: block; }
  .it { position: absolute; cursor: move; touch-action: none; outline: 1px dashed transparent; } .it:hover, .it.sel { outline-color: #5a3ac1; } .it.det { outline: 1.5px dashed #5a3ac1; background: rgb(198 58 45 / .08); } .it img { width: 100%; height: 100%; object-fit: contain; pointer-events: none; display: block; } .it svg { width: 100%; height: 100%; pointer-events: none; }
  .tx { width: 100%; height: 100%; border: 0; background: rgb(255 255 255 / .55); color: #1b1b1b; font-family: Helvetica, Arial, sans-serif; padding: 0 2px; } .ph { font: 11px var(--font-mono); color: #5a3ac1; padding: 2px; }
  .x { position: absolute; right: -12px; top: -12px; width: 24px; height: 24px; border-radius: 50%; border: 0; background: #5a3ac1; color: #fff; font: 700 15px/1 var(--font-sans); cursor: pointer; } .ok { position: absolute; left: 0; bottom: -28px; background: #f4f2ec; color: #111; border: 0; border-radius: 4px; padding: 4px 10px; font: 600 12px var(--font-sans); cursor: pointer; } .rz { position: absolute; right: -7px; bottom: -7px; width: 14px; height: 14px; background: #5a3ac1; border-radius: 3px; cursor: nwse-resize; touch-action: none; }
  .fld { position: absolute; } .fld input[type="text"], .fld select { width: 100%; height: 100%; box-sizing: border-box; border: 1px solid #5a3ac166; background: rgb(255 238 200 / .55); color: #1b1b1b; padding: 0 3px; font-family: Helvetica, Arial, sans-serif; } .fld input:focus, .fld select:focus { outline: 2px solid #5a3ac1; background: #fff7de; } .fld input[type="checkbox"], .fld input[type="radio"] { width: 100%; height: 100%; margin: 0; accent-color: #5a3ac1; }
  .pager { display: flex; align-items: center; gap: 14px; color: var(--tx-3); font: 13px var(--font-mono); }
  .out { display: flex; flex-wrap: wrap; gap: 16px; align-items: center; justify-content: space-between; border-top: 1px solid var(--hairline); padding-top: 18px; } .chk { display: flex; gap: 8px; align-items: center; font-size: 14px; margin-top: 8px; } .d-btn:disabled { opacity: .45; cursor: not-allowed; }
  @media (max-width: 700px) { .layout { grid-template-columns: minmax(0, 1fr); } .thumbs { grid-auto-flow: column; grid-auto-columns: 56px; overflow-x: auto; max-height: none; } .drop { padding: 40px 16px; } }
  @media (prefers-reduced-motion: reduce) { * { transition: none !important; animation: none !important; } }
</style>
