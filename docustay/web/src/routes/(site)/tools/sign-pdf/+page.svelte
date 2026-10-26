<script>
  import SceneStrip from "$lib/site/desk/SceneStrip.svelte";
  import Blocks from "$lib/site/desk/Blocks.svelte"; import { TOOLS_ADD } from "$lib/site/pages/pass3-tools.js"; import { ADD4_TOOLS } from "$lib/site/pages/pass4-tools.js";
  import DeskHead from "$lib/site/desk/DeskHead.svelte";
  import Sec from "$lib/site/desk/Sec.svelte";
  import Faq from "$lib/site/desk/Faq.svelte";
  import Closing from "$lib/site/desk/Closing.svelte";
  import PdfTool from "$lib/site/tools/PdfTool.svelte";
  // Free tool (voice V1): Sign a PDF. The file is opened, edited and written in the browser; no request carries it.
  const faq = [
    ["Is my PDF uploaded?", "No. The file is opened and written in your browser. No request carries it, and nothing is stored. {{F-SIGNTOOL}}"],
    ["Is this a legally signed document?", "No. It places a picture of your signature on a copy of the PDF. It is not sealed and not recorded. To collect signatures with a record of who agreed to what, send the document with Docustay. {{F-SEND}}"],
    ["Can I sign on my phone?", "Yes. Choose the PDF, make a signature with your finger, and tap the page where it goes. {{F-SIGNTOOL}}"],
    ["What about a scanned PDF?", "It works. A scan is a picture of a page, so you place your signature on top of it like any other page. {{F-SIGNTOOL}}"],
  ];
</script>
<!-- claim-until-proven: F-SIGNTOOL and F-FILLTOOL stay PENDING PROOF until the tools have been driven by hand with real PDFs -->
<DeskHead title="Sign a PDF" description="Sign a PDF in your browser: add your signature, initials, date or text and download a copy. The file is never uploaded." crumbs={[["Docustay", "/"], ["Free tools", "/tools/signature-generator"], ["Sign a PDF", "/tools/sign-pdf"]]} />
<section class="d-wrap tl" data-page="/tools/sign-pdf" data-voice="V1" data-template="Tool">
  <p class="d-eyebrow">FREE TOOL</p>
  <h1 class="d-h1">Sign a PDF.</h1>
  <p class="d-sub">Add your signature, initials, a date or text to a PDF. It happens in your browser. The file is never uploaded.</p>
  <PdfTool mode="sign" />
</section>
<SceneStrip scene="D" eyebrow="IN YOUR BROWSER">Your file <em>never</em> leaves this page.</SceneStrip>
<Sec eyebrow="Steps" title="Choose, place, download." tight><ol class="steps"><li><b>1 / 3</b><h3>Choose the PDF</h3><p>Pick a file from your device. It opens in this page and is not uploaded.</p></li><li><b>2 / 3</b><h3>Place your marks</h3><p>Make a signature, then click the page where it goes. Add initials, a date or text the same way, and drag to move.</p></li><li><b>3 / 3</b><h3>Download the copy</h3><p>Save a new PDF with your marks on it. Your original is not changed.</p></li></ol></Sec>
<Sec tight><div class="band"><p class="d-eyebrow" style="margin:0">NEED IT SIGNED BY OTHER PEOPLE?</p><p>This tool is for your own signature. Docustay sends a document to each person, records who signed and when, and seals the finished copy. <a href="/signup">Start free</a> or <a href="/features/how-it-works#sign">see how signing works</a>.</p></div></Sec>
<Blocks blocks={[...(TOOLS_ADD["/tools/sign-pdf"] ?? []), ...ADD4_TOOLS["/tools/sign-pdf"]]} />
<Sec eyebrow="Questions" title="Quick answers." tight><Faq items={faq} /></Sec>
<Closing title="Sign your PDF." label="Get started free" href="/signup" keep={[["Fill a PDF", "/tools/fill-pdf"], ["Signature generator", "/tools/signature-generator"], ["How to sign a PDF", "/guides/how-to-sign-a-pdf"]]} />
<style>
  .tl { padding-top: 110px; }
  .steps { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; } .steps li { background: #faf8f3; color: #1b1b1b; border-radius: 4px; padding: 22px; box-shadow: 0 30px 60px rgb(60 40 140 / 0.248); } .steps li:nth-child(1) { transform: rotate(-1deg); } .steps li:nth-child(2) { transform: rotate(.7deg); } .steps li:nth-child(3) { transform: rotate(-.5deg); }
  .steps b { font: 500 11px/1 var(--font-mono); letter-spacing: .12em; color: #6f6b63; } .steps h3 { margin: 10px 0 8px; font: 600 22px/1.2 var(--font-sans); letter-spacing: -.02em; } .steps p { margin: 0; color: #4a4740; line-height: 1.55; font-size: 15px; }
  .band { border: 1px solid var(--hairline); background: #ffffff; border-radius: 6px; padding: 24px 28px; } .band p:last-child { margin: 12px 0 0; color: var(--tx-2); line-height: 1.6; max-width: 70ch; } .band :global(a) { color: var(--tx-1); text-decoration: underline; text-underline-offset: 3px; }
  @media (max-width: 800px) { .steps { grid-template-columns: minmax(0, 1fr); } }
</style>
