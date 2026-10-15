// Small PDFs a test makes for itself (pdfkit): a contract-like page with signature blanks, a blank page, an image-only (no text) page.
import PDFDocument from "pdfkit";

function render(draw, { size = "LETTER" } = {}) {
  return new Promise((resolve) => {
    const doc = new PDFDocument({ size }); const chunks = [];
    doc.on("data", (c) => chunks.push(c)); doc.on("end", () => resolve(Buffer.concat(chunks)));
    draw(doc); doc.end();
  });
}
export const contractPdf = () => render((d) => {
  d.fontSize(12).text("Service agreement between the parties.").moveDown(6);
  d.text("Signature: ____________________").moveDown().text("Date: ________").moveDown().text("Initials:").moveDown().text("Printed name: ______________");
  d.addPage().text("Second page of terms.");
});
export const textPdf = (pages = 1) => render((d) => { for (let i = 0; i < pages; i += 1) { if (i) d.addPage(); d.fontSize(12).text(`Page ${i + 1} of a plain document with some words on it.`); } });
export const imageOnlyPdf = () => render((d) => { d.rect(50, 50, 300, 300).fill("#cccccc"); });
/** A letter with text tags written in it (Part 30 item 7). `lines` are drawn one per line on page 1; page 2 repeats the last one. */
export const taggedPdf = (lines = [
  "Rental agreement",
  "Tenant: {{Tenant name;type=text;role=Tenant}}",
  "Plan: {{Plan;type=dropdown;options=Monthly,Yearly;role=Tenant}}",
  "Tenant signs: {{Tenant signature;type=signature;role=Tenant}}   Date: {{Signed on;type=date_signed;role=Tenant}}",
  "Landlord signs: {{Landlord signature;type=signature;role=Landlord;width=200;height=50}}",
]) => render((d) => { d.fontSize(12); lines.forEach((l, i) => { d.text(l); d.moveDown(i === 0 ? 2 : 1.5); }); d.addPage().text(lines[lines.length - 1]); });
