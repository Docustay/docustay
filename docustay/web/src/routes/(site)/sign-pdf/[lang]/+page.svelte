<script>
  import DeskHead from "$lib/site/desk/DeskHead.svelte";
  import Sec from "$lib/site/desk/Sec.svelte";
  import CodeWin from "$lib/site/desk/CodeWin.svelte";
  import Closing from "$lib/site/desk/Closing.svelte";
  import Faq from "$lib/site/desk/Faq.svelte";
  import Blocks from "$lib/site/desk/Blocks.svelte";
  import { langExtra } from "$lib/site/pages/pass3-lang.js";
  // "Sign a PDF with <language>" (T8, voice V2): the snippet is the one signpdf-proof.mjs runs against the API with a test key before it ships.
  let { data } = $props(); const l = $derived(data.l);
  const faq = $derived([["Does a test key send anything real?", "No. A document sent with a dsk_test_ key is emailed only to you, carries a TEST watermark and is never counted. {{F-TESTMODE}}"], ["Where do the key and template id come from?", "From the environment: DOCUSTAY_API_KEY and DOCUSTAY_TEMPLATE_ID. The key never sits in the file. {{F-API}}"], ["How do I know it was signed?", "Subscribe to documents.document.executed, or fetch the document by id. {{F-WEBHOOKS}}"]]);
</script>
<DeskHead title="Send a document for signature from {l.name}" description="Send a document for signature from {l.name} with a program that was run against the Docustay API with a test key before it was published here." crumbs={[["Docustay", "/"], ["Sign documents from your code", "/sign-pdf"], [l.name, "/sign-pdf/" + l.slug]]} />
<section class="d-wrap sp" data-page="/sign-pdf/{l.slug}" data-voice="V2" data-template="T8">
  <nav class="d-crumbs" aria-label="Breadcrumb"><a href="/">Docustay</a><span>/</span><a href="/sign-pdf">Sign documents from your code</a><span>/</span><span>{l.name}</span></nav>
  <p class="d-eyebrow" style="margin-top:22px">SIGN A PDF WITH {l.name.toUpperCase()}</p>
  <h1 class="d-h1 sm">Send a document for signature from {l.name}</h1>
  <p class="d-sub">Make a test key and a template, then run this. A test key sends nothing real and bills nothing.</p>
</section>
<Sec eyebrow="1 · Install" title="Add the client." tight><p class="note" data-feature="F-SDK"><code>{l.install}</code></p><p class="note">{l.notes}</p></Sec>
<Sec eyebrow="2 · Send" title="send.{l.ext}" tight><CodeWin tabs={[{ label: l.name, code: l.code }]} /><p class="note">This sends the template to one person. It reads the key and the template id from the environment.</p></Sec>
<Sec eyebrow="3 · Then" title="Read the answer." tight><p class="note">The answer holds the document's id and its state. Ask for it later with the same key, or get a signed <a href="/docs/webhooks">webhook</a> when it is signed. The <a href="/docs/quickstart">quickstart</a> shows the rest.</p></Sec>
<Blocks blocks={langExtra(l)} />
<Sec eyebrow="Questions" title="Quick answers." tight><Faq items={faq} /></Sec>
<Closing title="Make a test key." label="Create an API key" href="/signup" keep={[["All languages", "/sign-pdf"], ["Test mode", "/developers/test-mode"], ["REST API", "/developers/api"]]} />
<style> .sp { padding-top: 56px; } .note { max-width: 70ch; color: #a8a39a; line-height: 1.6; margin: 14px 0 0; } .note :global(code) { color: #f4f2ec; font-family: var(--font-mono); } .note :global(a) { color: #f4f2ec; text-decoration: underline; } </style>
