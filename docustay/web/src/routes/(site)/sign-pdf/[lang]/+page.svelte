<script>
  import DeskHead from "$lib/site/desk/DeskHead.svelte";
  import Sec from "$lib/site/desk/Sec.svelte";
  import CodeWin from "$lib/site/desk/CodeWin.svelte";
  import Closing from "$lib/site/desk/Closing.svelte";
  import Faq from "$lib/site/desk/Faq.svelte";
  import Blocks from "$lib/site/desk/Blocks.svelte";
  import Console from "$lib/site/desk/Console.svelte";
  import SceneHero from "$lib/site/desk/SceneHero.svelte";
  import { langExtra } from "$lib/site/pages/pass3-lang.js";
  import { langMore } from "$lib/site/pages/pass4-lang.js";
  // "Sign a PDF with <language>" (T8, voice V2): the snippet is the one signpdf-proof.mjs runs against the API with a test key before it ships.
  let { data } = $props(); const l = $derived(data.l);
  const term = $derived([{ k: "dim", t: "# 1 · the client" }, { k: "cmd", t: l.install }, { k: "dim", t: "# 2 · send a test document" }, { k: "cmd", t: l.runText ?? (l.run ?? []).join(" ").replace("{file}", "send." + l.ext) }]);
  const faq = $derived([["Does a test key send anything real?", "No. A document sent with a dsk_test_ key is emailed only to you, carries a TEST watermark and is never counted. {{F-TESTMODE}}"], ["Where do the key and template id come from?", "From the environment: DOCUSTAY_API_KEY and DOCUSTAY_TEMPLATE_ID. The key never sits in the file. {{F-API}}"], ["How do I know it was signed?", "Subscribe to documents.document.executed, or fetch the document by id. {{F-WEBHOOKS}}"]]);
</script>
<DeskHead title="Sign PDF API in {l.name}" description="Sign PDF API in {l.name}: a short program that sends a template for signature, run against Docustay with a test key before it was published." crumbs={[["Docustay", "/"], ["Sign documents from your code", "/sign-pdf"], [l.name, "/sign-pdf/" + l.slug]]} />
<SceneHero scene="lattice" id={"lang-" + l.slug} cls="sp">
  <nav class="d-crumbs" aria-label="Breadcrumb"><a href="/">Docustay</a><span>/</span><a href="/sign-pdf">Sign documents from your code</a><span>/</span><span>{l.name}</span></nav>
  <p class="d-eyebrow" style="margin-top:22px">SIGN PDF API · {l.name.toUpperCase()}</p>
  <h1 class="d-h1 sm">Sign a PDF in <em>{l.name}.</em></h1>
  <p class="d-sub">This sign PDF API in {l.name} example sends a template to one person, who signs on any device. Make a test key and a template, then run it. A test key sends nothing real and bills nothing. <span data-feature="F-TESTMODE"></span></p>
</SceneHero>
<Sec eyebrow="Send, listen, download" title="Three steps, one program." tight><div class="term"><Console lines={term} title={l.slug} /></div></Sec>
<Sec eyebrow="1 · Install" title="Add the client." tight><p class="note" data-feature="F-SDK">{#if l.soon}{l.soon}&nbsp;{/if}<code>{l.install}</code></p><p class="note">{l.notes}</p></Sec>
<Sec eyebrow="2 · Send" title="send.{l.ext}" tight><CodeWin tabs={[{ label: l.name, code: l.code }]} /><p class="note">This sends the template to one person. It reads the key and the template id from the environment.</p></Sec>
<Sec eyebrow="3 · Then" title="Read the answer." tight><p class="note">The {l.name} program's answer holds the document's id and its state. Ask for it later with the same key, or get a signed <a href="/docs/webhooks">webhook</a> when it is signed. The <a href="/docs/quickstart">quickstart</a> shows the rest.</p></Sec>
<Blocks blocks={[...langExtra(l), ...langMore(l)]} />
<Sec eyebrow="Questions" title="Quick answers." tight><Faq items={faq} /></Sec>
<Closing title="Make a test key." label="Create an API key" href="/signup" keep={[["All languages", "/sign-pdf"], ["Test mode", "/developers/test-mode"], ["REST API", "/developers/api"]]} />
<style> .term { min-width: 0; } .note { max-width: 70ch; color: var(--tx-3); line-height: 1.6; margin: 14px 0 0; } .note :global(code) { color: var(--tx-1); font-family: var(--font-mono); } .note :global(a) { color: var(--tx-1); text-decoration: underline; } </style>
