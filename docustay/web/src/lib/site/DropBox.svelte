<script>
  // The hero's drop box. The file is kept in this browser (IndexedDB), never sent anywhere until the person makes an account; the new workspace then picks it up and uploads it (see handoff.js).
  import { goto } from "$app/navigation";
  import { keep, LIMIT_MB } from "./handoff.js";
  let { variant = "paper" } = $props();
  let over = $state(false), problem = $state(null), input = $state(null), busy = $state(false);
  async function take(file) {
    problem = null; if (!file) return;
    if (file.size > LIMIT_MB * 1048576) { problem = `That file is ${(file.size / 1048576).toFixed(1)} MB. The Free plan takes up to ${LIMIT_MB} MB.`; return; }
    if (!(await file.slice(0, 1024).text()).includes("%PDF-")) { problem = "Docustay only accepts PDF files."; return; }
    busy = true;
    try { await keep(file); await goto("/signup?from=drop"); } catch { problem = "This browser would not keep the file. Create an account first and upload it there."; busy = false; }
  }
</script>
<div class="rounded-lg border-2 border-dashed p-6 text-center {variant === 'film' ? 'dropfilm !rounded-3xl backdrop-blur-md' : ''} {over ? 'border-brand bg-brand-soft' : 'border-line-strong bg-card'}" role="group" aria-label="Try it with your own file"
  ondragover={(e) => { e.preventDefault(); over = true; }} ondragleave={() => (over = false)} ondrop={(e) => { e.preventDefault(); over = false; take(e.dataTransfer.files?.[0]); }}>
  <p class="serif text-lg font-semibold">Drop a document to start</p>
  <p class="mt-1 text-sm text-mute">PDF files only, up to {LIMIT_MB} MB. It stays in your browser until you create a free account, then it is ready to place fields on.</p>
  <button class="btn primary mt-4" onclick={() => input.click()} disabled={busy}>{busy ? "Getting ready…" : "Choose a file"}</button>
  <input bind:this={input} type="file" class="sr-only" accept=".pdf,application/pdf" onchange={(e) => take(e.currentTarget.files?.[0])} data-testid="drop-input" aria-label="Choose a document" />
  {#if problem}<p class="notice bad mt-3 text-left" role="alert">{problem}</p>{/if}
</div>
