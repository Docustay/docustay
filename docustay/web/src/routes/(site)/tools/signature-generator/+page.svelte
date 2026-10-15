<script>
  import Blocks from "$lib/site/desk/Blocks.svelte"; import { TOOLS_ADD } from "$lib/site/pages/pass3-tools.js";
  import DeskHead from "$lib/site/desk/DeskHead.svelte";
  import Sec from "$lib/site/desk/Sec.svelte";
  import Faq from "$lib/site/desk/Faq.svelte";
  import Closing from "$lib/site/desk/Closing.svelte";
  import SignatureCapture from "$lib/site/tools/SignatureCapture.svelte";
  // Free tool (board Tool_Signature, voice V1): a signature on a paper canvas, made in the browser, downloaded as a PNG. Nothing is uploaded or stored.
  let result = $state(null), ink = $state("black");
  function save() { if (!result) return; const a = document.createElement("a"); a.href = result.dataUrl; a.download = "signature.png"; a.click(); }
  const faq = [
    ["Is my signature uploaded anywhere?", "No. It is drawn and saved in your browser. Nothing is sent to us and nothing is stored."],
    ["Is a picture of my signature a signed document?", "No. It is only a picture. To collect real signatures with a record of who agreed to what, send the document with Docustay. {{F-SEND}}"],
    ["Can I put it on a PDF?", "Yes. Use the free sign a PDF tool, which also runs in your browser. {{F-SIGNTOOL}}"],
  ];
</script>
<!-- claim-until-proven: the sign a PDF tool line (F-SIGNTOOL) stays marked until the privacy proof has been driven by hand -->
<DeskHead title="Signature generator" description="Draw, type or upload a signature and download it as a transparent image. It is made in your browser and never uploaded." crumbs={[["Docustay", "/"], ["Free tools", "/tools/signature-generator"], ["Signature generator", "/tools/signature-generator"]]} />
<section class="d-wrap tl" data-page="/tools/signature-generator" data-voice="V1" data-template="Tool">
  <p class="d-eyebrow">FREE TOOL</p>
  <h1 class="d-h1">Signature generator.</h1>
  <p class="d-sub">Draw, type or upload a signature, and download it as an image. It stays in your browser.</p>
  <div class="work"><SignatureCapture bind:ink onchange={(r) => (result = r)} showIntro id="gen" />
    <div class="d-actions"><button type="button" class="d-btn main" onclick={save} disabled={!result} data-testid="sig-download">Download PNG</button><a class="d-btn alt" href="/tools/sign-pdf">Put it on a PDF</a></div></div>
</section>
<Sec eyebrow="Three steps" title="Make it, adjust it, download it." tight><ol class="steps"><li><b>1 / 3</b><h3>Make it</h3><p>Draw with a finger, a pen or a mouse, type your name in a handwriting style, or upload a picture.</p></li><li><b>2 / 3</b><h3>Adjust it</h3><p>Pick black or blue ink and the weight of the pen. Clear it and start again as often as you like.</p></li><li><b>3 / 3</b><h3>Download it</h3><p>Save a transparent PNG, trimmed to the ink, ready to place on any document.</p></li></ol></Sec>
<Sec tight><div class="band"><p class="d-eyebrow" style="margin:0">NEED IT SIGNED BY OTHER PEOPLE?</p><p>A picture of a signature is not a signed document. Docustay sends a document to each person, records who signed and when, and seals the finished copy. <a href="/signup">Start free</a> or <a href="/product/signing">see how signing works</a>.</p></div></Sec>
<Blocks blocks={TOOLS_ADD["/tools/signature-generator"]} />
<Sec eyebrow="Questions" title="Quick answers." tight><Faq items={faq} /></Sec>
<Closing title="Make your signature." label="Get started free" href="/signup" keep={[["Sign a PDF", "/tools/sign-pdf"], ["How to sign a PDF", "/guides/how-to-sign-a-pdf"], ["Verify a signed PDF", "/verify"]]} />
<style>
  .tl { padding-top: 56px; } .work { margin-top: 36px; max-width: 880px; display: grid; gap: 22px; } .d-btn:disabled { opacity: .45; cursor: not-allowed; }
  .steps { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; } .steps li { background: #faf8f3; color: #1b1b1b; border-radius: 4px; padding: 22px; box-shadow: 0 30px 60px rgb(0 0 0 / .55); } .steps li:nth-child(1) { transform: rotate(-1deg); } .steps li:nth-child(2) { transform: rotate(.7deg); } .steps li:nth-child(3) { transform: rotate(-.5deg); }
  .steps b { font: 500 11px/1 var(--font-mono); letter-spacing: .12em; color: #6f6b63; } .steps h3 { margin: 10px 0 8px; font: 600 22px/1.2 var(--font-sans); letter-spacing: -.02em; } .steps p { margin: 0; color: #4a4740; line-height: 1.55; font-size: 15px; }
  .band { border: 1px solid #2a2a2c; background: #131315; border-radius: 6px; padding: 24px 28px; } .band p:last-child { margin: 12px 0 0; color: #c9c5bb; line-height: 1.6; max-width: 70ch; } .band a { color: #f4f2ec; text-decoration: underline; text-underline-offset: 3px; }
  @media (max-width: 800px) { .steps { grid-template-columns: 1fr; } }
</style>
