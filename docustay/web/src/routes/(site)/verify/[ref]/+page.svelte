<script>
  // R13-D285: what the certificate's verification address shows — the signed document's facts as the service recorded them, and how to check a copy of the file against them.
  import Hero from "$lib/site/Hero.svelte";
  import Cta from "$lib/site/Cta.svelte";
  let { data } = $props();
  const f = $derived(data.facts);
  const when = (iso) => iso ? new Date(iso).toLocaleString("en-US", { dateStyle: "long", timeStyle: "short", timeZone: "UTC" }) + " UTC" : "not recorded";
</script>
<svelte:head><title>Verify a signed document | Docustay</title><meta name="robots" content="noindex" /><meta name="description" content="The facts Docustay recorded when this document was signed, and how to check a copy of the file against them." /></svelte:head>
<Hero eyebrow="Trust" title="Verify a signed *document.*" scene="seal" lede="The facts recorded when this document was signed. Compare them with the copy you hold." />
<div class="d-wrap"><div class="max-w-3xl" data-testid="verify-ref">
  {#if f}
    <p class="notice ok" role="status" data-testid="verify-ref-found">This is a real document, signed through Docustay{#if f.organisation} for <strong>{f.organisation}</strong>{/if}.</p>
    <dl class="card mt-4 grid gap-x-6 gap-y-2 p-4 text-sm sm:grid-cols-[11rem_1fr]">
      <dt class="text-mute">Document</dt><dd>{f.title}</dd>
      <dt class="text-mute">Completed</dt><dd>{when(f.executedAt)}</dd>
      {#if f.pageCount}<dt class="text-mute">Pages</dt><dd>{f.pageCount}</dd>{/if}
      <dt class="text-mute">Signed by</dt><dd><ol class="list-decimal pl-5">{#each f.signers ?? [] as s}<li>{s.name} <span class="text-mute">· {when(s.signedAt)}</span></li>{/each}</ol></dd>
      {#if f.finalSha256}<dt class="text-mute">Signed file fingerprint</dt><dd class="break-all font-mono text-xs" data-testid="verify-ref-sha">SHA-256 {f.finalSha256}</dd>{/if}
      {#if f.originalSha256}<dt class="text-mute">Original file fingerprint</dt><dd class="break-all font-mono text-xs">SHA-256 {f.originalSha256}</dd>{/if}
    </dl>
    <section class="mt-6 space-y-2 text-[15px] text-ink/85"><h2 class="serif text-xl font-semibold text-ink">Check your copy</h2>
      <p>A copy is the signed document only if its SHA-256 fingerprint is the one above. On a Mac or Linux, run <code>shasum -a 256 file.pdf</code>; on Windows, <code>certutil -hashfile file.pdf SHA256</code>. Or drop the file on the <a href="/verify">PDF check</a>: it reads the digital seal inside the file, in your browser, without uploading it.</p>
    </section>
  {:else if data.problem === "notfound"}
    <p class="notice bad" role="status" data-testid="verify-ref-missing">That verification address does not match a signed document. Check that it was copied in full, or drop the PDF on the <a href="/verify">PDF check</a> to read the seal inside the file.</p>
  {:else}
    <p class="notice warn" role="status" data-testid="verify-ref-trouble">We could not check that address just now. Try again in a minute, or drop the PDF on the <a href="/verify">PDF check</a>, which works without our service.</p>
  {/if}
</div></div>
<Cta title="Send your own." text="" href="/signup" label="Get started free" keep={[["How the proof works", "/features/proof"], ["Legal validity", "/trust/legal-validity"]]} />
