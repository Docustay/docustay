<script>
  import Blocks from "$lib/site/desk/Blocks.svelte"; import { TOOLS_ADD } from "$lib/site/pages/pass3-tools.js";
  import DeskHead from "$lib/site/desk/DeskHead.svelte";
  import Sec from "$lib/site/desk/Sec.svelte";
  import Faq from "$lib/site/desk/Faq.svelte";
  import Closing from "$lib/site/desk/Closing.svelte";
  import PdfTool from "$lib/site/tools/PdfTool.svelte";
  // Free tool (voice V1): Fill a PDF. The file is opened, edited and written in the browser; no request carries it.
  const faq = [
    ["Is my PDF uploaded?", "No. The file is opened and written in your browser. No request carries it, and nothing is stored. {{F-FILLTOOL}}"],
    ["What if the PDF has no form fields?", "Choose Text, Check or Date and click the page where it goes. This works on any PDF, including a scan. {{F-FILLTOOL}}"],
    ["Can I make the filled fields non-editable?", "Yes. Keep the option on and the copy has your answers as plain page content. Turn it off to keep the fields editable. {{F-FILLTOOL}}"],
    ["Does this sign the document?", "No. It fills it in. To add a signature, use the sign a PDF tool. To collect signatures with a record, send the document with Docustay. {{F-SEND}}"],
  ];
</script>
<!-- claim-until-proven: F-SIGNTOOL and F-FILLTOOL stay PENDING PROOF until the tools have been driven by hand with real PDFs -->
<DeskHead title="Fill a PDF" description="Fill a PDF form in your browser: type into its fields, or add text, check marks and dates to any PDF. The file is never uploaded." crumbs={[["Docustay", "/"], ["Free tools", "/tools/signature-generator"], ["Fill a PDF", "/tools/fill-pdf"]]} />
<section class="d-wrap tl" data-page="/tools/fill-pdf" data-voice="V1" data-template="Tool">
  <p class="d-eyebrow">FREE TOOL</p>
  <h1 class="d-h1">Fill a PDF.</h1>
  <p class="d-sub">Type into the fields of a PDF form, or add text, check marks and dates to any PDF. It happens in your browser. The file is never uploaded.</p>
  <PdfTool mode="fill" />
</section>
<Sec eyebrow="Steps" title="Choose, fill, download." tight><ol class="steps"><li><b>1 / 3</b><h3>Choose the PDF</h3><p>Pick a file from your device. It opens in this page and is not uploaded.</p></li><li><b>2 / 3</b><h3>Fill it in</h3><p>Click a field and type. Where there is no field, add text, a check mark or a date anywhere on the page.</p></li><li><b>3 / 3</b><h3>Download the copy</h3><p>Save a new PDF with your answers in it. Your original is not changed.</p></li></ol></Sec>
<Sec tight><div class="band"><p class="d-eyebrow" style="margin:0">NEED OTHER PEOPLE TO FILL AND SIGN IT?</p><p>Docustay sends a form to each person, collects their answers and signatures, and keeps a record of who did what and when. <a href="/signup">Start free</a> or <a href="/product/sending">see how sending works</a>.</p></div></Sec>
<Blocks blocks={TOOLS_ADD["/tools/fill-pdf"]} />
<Sec eyebrow="Questions" title="Quick answers." tight><Faq items={faq} /></Sec>
<Closing title="Fill your PDF." label="Get started free" href="/signup" keep={[["Sign a PDF", "/tools/sign-pdf"], ["Signature generator", "/tools/signature-generator"], ["Document templates", "/document-templates"]]} />
<style>
  .tl { padding-top: 56px; }
  .steps { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; } .steps li { background: #faf8f3; color: #1b1b1b; border-radius: 4px; padding: 22px; box-shadow: 0 30px 60px rgb(0 0 0 / .55); } .steps li:nth-child(1) { transform: rotate(-1deg); } .steps li:nth-child(2) { transform: rotate(.7deg); } .steps li:nth-child(3) { transform: rotate(-.5deg); }
  .steps b { font: 500 11px/1 var(--font-mono); letter-spacing: .12em; color: #6f6b63; } .steps h3 { margin: 10px 0 8px; font: 600 22px/1.2 var(--font-sans); letter-spacing: -.02em; } .steps p { margin: 0; color: #4a4740; line-height: 1.55; font-size: 15px; }
  .band { border: 1px solid #2a2a2c; background: #131315; border-radius: 6px; padding: 24px 28px; } .band p:last-child { margin: 12px 0 0; color: #c9c5bb; line-height: 1.6; max-width: 70ch; } .band :global(a) { color: #f4f2ec; text-decoration: underline; text-underline-offset: 3px; }
  @media (max-width: 800px) { .steps { grid-template-columns: 1fr; } }
</style>
