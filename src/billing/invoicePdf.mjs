// DOCUSTAY'S OWN INVOICE (13 Oct 2026, the $1 live test): the invoice a Docustay customer downloads is built here from Stripe's data, on white paper with the Docustay wordmark, never Stripe's hosted PDF (which carries the
// Stripe ACCOUNT's business name, address and a "Pay online" link). Pure: bytes in, bytes out. The number is Docustay's own, derived from the Stripe invoice id so it is stable and never repeats.
import PDFDocument from "pdfkit";
import { WORDMARK_PNG_B64 } from "./invoiceLogo.mjs";

const money = (minor, cur) => { try { return new Intl.NumberFormat("en-US", { style: "currency", currency: String(cur || "usd").toUpperCase() }).format(Number(minor) / 100); } catch { return `${(Number(minor) / 100).toFixed(2)}`; } };
const date = (sec) => (sec ? new Date(Number(sec) * 1000).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" }) : "");
/** DS-YYYYMM-XXXXXX: month of the invoice, then the last six characters of Stripe's invoice id. Stable (same invoice, same number) and unique. */
export const invoiceNumber = (inv) => { const d = new Date(Number(inv.created) * 1000); return `DS-${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(inv.id).slice(-6).toUpperCase()}`; };

/** invoice: Stripe's invoice (customer expanded); card: { brand, last4 } or null; seller: the optional "billed by" line (a setting; empty = no line). → Promise<Buffer> */
export function renderInvoicePdf({ invoice, card = null, seller = "" }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "LETTER", margin: 56, info: { Title: `Docustay invoice ${invoiceNumber(invoice)}`, Author: "Docustay" } });
    const chunks = []; doc.on("data", (c) => chunks.push(c)); doc.on("end", () => resolve(Buffer.concat(chunks))); doc.on("error", reject);
    const ink = "#1b1b1b", mute = "#5b5873", line = "#e6e4ef", violet = "#5a3ac1", L = 56, R = doc.page.width - 56, W = R - L;
    doc.image(Buffer.from(WORDMARK_PNG_B64, "base64"), L, 56, { height: 30 });
    doc.font("Helvetica-Bold").fontSize(20).fillColor(ink).text("Invoice", L, 56, { width: W, align: "right" });
    doc.font("Helvetica").fontSize(10).fillColor(mute).text(invoiceNumber(invoice), L, 82, { width: W, align: "right" });
    let y = 128;
    const cust = invoice.customer && typeof invoice.customer === "object" ? invoice.customer : {};
    const col = (x, title, lines) => { doc.font("Helvetica-Bold").fontSize(9).fillColor(mute).text(title.toUpperCase(), x, y, { characterSpacing: 0.6 }); doc.font("Helvetica").fontSize(11).fillColor(ink); let yy = y + 16; for (const t of lines.filter(Boolean)) { doc.text(t, x, yy, { width: 230 }); yy += 15; } };
    col(L, "Billed to", [invoice.customer_name ?? cust.name, invoice.customer_email ?? cust.email]);
    col(L + 250, "Details", [`Date: ${date(invoice.status_transitions?.paid_at ?? invoice.created)}`, `Status: ${invoice.status === "paid" ? "Paid" : invoice.status}`, card ? `Paid with: ${String(card.brand ?? "card").replace(/^./, (c) => c.toUpperCase())} ending ${card.last4}` : null]);
    y += 92;
    doc.moveTo(L, y).lineTo(R, y).strokeColor(line).lineWidth(1).stroke(); y += 10;
    doc.font("Helvetica-Bold").fontSize(9).fillColor(mute); doc.text("DESCRIPTION", L, y, { characterSpacing: 0.6 }); doc.text("AMOUNT", L, y, { width: W, align: "right", characterSpacing: 0.6 }); y += 20;
    for (const l of invoice.lines?.data ?? []) {
      const per = l.period && l.period.start && l.period.end && l.period.end !== l.period.start ? `${date(l.period.start)} to ${date(l.period.end)}` : null;
      doc.font("Helvetica").fontSize(11).fillColor(ink).text(String(l.description ?? "Docustay Pro").replace(/^\d+ × /, ""), L, y, { width: W - 110 });
      doc.text(money(l.amount, invoice.currency), L, y, { width: W, align: "right" }); y = doc.y + 2;
      if (per) { doc.fontSize(9.5).fillColor(mute).text(per, L, y, { width: W - 110 }); y = doc.y + 6; } else y += 6;
    }
    y += 6; doc.moveTo(L + W * 0.55, y).lineTo(R, y).strokeColor(line).stroke(); y += 10;
    const tax = (invoice.total_taxes ?? []).reduce((a, t) => a + (t.amount ?? 0), 0);
    const row = (label, v, bold) => { doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(bold ? 12 : 10.5).fillColor(bold ? ink : mute).text(label, L + W * 0.55, y, { width: W * 0.25 }); doc.fillColor(ink).text(v, L + W * 0.55, y, { width: W * 0.45, align: "right" }); y += bold ? 22 : 18; };
    row("Subtotal", money(invoice.subtotal ?? invoice.total, invoice.currency)); row("Tax", money(tax, invoice.currency)); row("Total", money(invoice.total, invoice.currency), true); row("Amount paid", money(invoice.amount_paid ?? 0, invoice.currency), true);
    y += 24; doc.font("Helvetica").fontSize(10).fillColor(mute).text("Thank you for using Docustay. Your plan and invoices are always in Billing at app.docustay.app.", L, y, { width: W });
    if (seller) doc.fontSize(9).fillColor(mute).text(seller, L, doc.page.height - 100, { width: W });
    doc.fontSize(9).fillColor(violet).text("docustay.app", L, doc.page.height - 78, { width: W });
    doc.end();
  });
}
