<script>
  import Blocks from "$lib/site/desk/Blocks.svelte"; import { TOOLS_ADD } from "$lib/site/pages/pass3-tools.js";
  import Cta from "$lib/site/Cta.svelte";
  import Hero from "$lib/site/Hero.svelte"; import Seal from "$lib/site/anim/Seal.svelte";
  let result = $state(null), busy = $state(false), name = $state(""), over = $state(false), input = $state(null);
  async function check(file) {
    if (!file) return; busy = true; result = null; name = file.name;
    try { const { verifyPdfBytes } = await import("$lib/site/verify.js"); result = await verifyPdfBytes(await file.arrayBuffer()); } catch (e) { result = { signed: false, valid: false, reason: "That file could not be read.", timestamped: false }; }
    busy = false;
  }
</script>
<svelte:head><title>Verify a signed PDF | Docustay</title><meta name="description" content="Check the seal on a signed PDF in your browser. The file is not uploaded." /></svelte:head>
<Hero eyebrow="Trust" title="Verify a signed PDF" lede="Drop a signed PDF here. The check runs in this page; the file is not uploaded anywhere." />
<div class="mx-auto max-w-3xl">
  <div class="rounded-[var(--r-5)] border-2 border-dashed p-10 text-center {over ? 'border-brand bg-brand-soft' : 'border-line-strong bg-card'}" role="group" aria-label="Drop a signed PDF" ondragover={(e) => { e.preventDefault(); over = true; }} ondragleave={() => (over = false)} ondrop={(e) => { e.preventDefault(); over = false; check(e.dataTransfer.files?.[0]); }}>
    <div class="mx-auto mb-3 w-40"><Seal /></div><p class="serif text-2xl font-semibold">Drop a PDF</p>
    <button class="btn primary mt-4" onclick={() => input.click()} disabled={busy}>{busy ? "Checking…" : "Choose a file"}</button>
    <input bind:this={input} type="file" accept=".pdf,application/pdf" class="sr-only" onchange={(e) => check(e.currentTarget.files?.[0])} data-testid="verify-input" aria-label="Choose a signed PDF" />
  </div>
  {#if result}
    <section class="mt-6" role="status" aria-live="polite" data-testid="verify-result">
      {#if !result.signed}<p class="notice warn"><strong>{name}</strong>: {result.reason}</p>
      {:else if result.valid && result.coversWholeFile && result.sealer === "known"}<p class="notice ok"><strong>{name}</strong>: the seal is intact and was made with the Docustay hosted service's certificate. The file is exactly what was sealed.</p>
      {:else if result.valid && result.coversWholeFile}<p class="notice warn"><strong>{name}</strong>: the seal is intact and the file is exactly what was sealed, but the certificate that made it is not one this page recognises. A self-hosted Docustay uses its own certificate, which is normal; a file made by someone else and signed with a certificate named "Docustay" would look the same. Compare the fingerprint below with the one your service publishes before you rely on it.</p>
      {:else if result.valid}<p class="notice warn"><strong>{name}</strong>: the seal itself is intact, but the file has extra content after it. It is not exactly what was sealed, so do not rely on it.</p>
      {:else}<p class="notice bad"><strong>{name}</strong>: {result.reason}</p>{/if}
      {#if result.signed}<dl class="card mt-3 grid gap-x-6 gap-y-2 p-4 text-sm sm:grid-cols-[10rem_1fr]"><dt class="text-mute">Sealed by</dt><dd>{result.signer ?? "not stated"}{#if result.sealer === "known"} <span class="text-mute">(the Docustay hosted service's certificate)</span>{:else if result.valid} <span class="text-mute">(a certificate this page does not recognise)</span>{/if}</dd><dt class="text-mute">Certificate fingerprint (SHA-256)</dt><dd class="break-all font-mono text-xs">{result.certSha256 ?? "not available"}</dd><dt class="text-mute">Trusted timestamp</dt><dd>{result.timestamped ? "present" : "not present"}</dd><dt class="text-mute">Seal covers</dt><dd>{result.coversWholeFile ? "the whole file" : "part of the file; content was added after sealing"}</dd><dt class="text-mute">File fingerprint (SHA-256)</dt><dd class="break-all font-mono text-xs">{result.sha256}</dd></dl>{/if}
    </section>
  {/if}
  <section class="mt-10 space-y-3 text-[15px] text-ink/85"><h2 class="serif text-xl font-semibold text-ink">What this checks, and what it does not</h2>
    <p>It checks that the digital signature inside the file is a correct signature, made with the certificate it carries, over exactly the bytes of the file: change one byte after sealing, or damage the signature, and the check fails. It tells you whether that certificate is the Docustay hosted service's own (by its fingerprint). It does not tell you who the signer is in the real world, and it does not check any certificate authority: the seal is made with Docustay's own certificate. The Certificate of Completion page inside the document carries the signing record.</p></section>
</div>
<Blocks blocks={TOOLS_ADD["/verify"]} />
<Cta title="Send your own." text="" href="/signup" label="Get started free" keep={[["How the proof works", "/product/proof"], ["Signature standards", "/trust#proof"], ["Legal validity", "/trust/legal-validity"]]} />
