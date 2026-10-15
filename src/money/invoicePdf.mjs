// src/money/invoicePdf.mjs — Part 3 rebuild (the maintainer's ruling: full rebuild), 1 Oct 2026.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ ONE COMPONENT, BOTH SIDES. This file is pure — React + @react-pdf/renderer primitives only,
//     no Node-only imports (no fs/pg/stripe) — so it is imported UNCHANGED by the browser preview
//     (webreact, via the `@keystone` alias → this same file) and by the server attachment
//     (invoicePdfServer.mjs, same directory). The brief's own "the preview is exactly what gets
//     sent" rule depends on this being literally one component, not two copies kept in sync by
//     hand — see invoicePdfServer.mjs's own header for the byte-parity gate this makes possible.
//
// ★ WHY `React.createElement`, NOT JSX: same reason as src/email/notificationEmail.mjs — `src/` is
//   plain Node ESM with no build/transform step. Vite bundles plain createElement calls into the
//   browser build just fine (no JSX syntax here for it to transform in the first place).
//
// ★ Design tokens below are the SAME values the screen and the email use (§7 of
//   specs/stage-20/INVOICE-REBUILD.md) — Inter, the 4/8px spacing grid, `--color-action-500`
//   (#7F7BF5) as the one accent. `db/gates/s8_branding_colour_removed.mjs` forbids a per-tenant
//   brand colour (the maintainer's own S8 ruling) — this is the ONE fixed product accent, not a setting.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

import { createElement as h } from "react";
import { Document, Page, View, Text, Image, Font, StyleSheet } from "@react-pdf/renderer";

const ACCENT = "#7F7BF5";
const INK = "#1a1f36";
const MUTED = "#6b7280";
const DIVIDER = "#e5e7eb";

// ★ Registered once, lazily — both the server (local file path, invoicePdfServer.mjs) and the
//   browser (served URL, same files at /fonts/pdf/*) call `registerInvoiceFonts` with their own
//   `resolve(filename)` before the first render. Re-registering is harmless (Font.register
//   overwrites), so no "already registered" guard is needed.
// ★ F860 — PLAIN WOFF, not WOFF2: @react-pdf/renderer's font embedder cannot subset a WOFF2 font
//   (MEASURED, reproduced with two independent Inter WOFF2 builds). These three files live at
//   `webreact/public/fonts/pdf/` (a SEPARATE, genuinely-distinct-per-weight set from the
//   website's own `fonts/` — see F860's SCOPE note on that set).
export function registerInvoiceFonts(resolve) {
  Font.register({
    family: "Inter",
    fonts: [
      { src: resolve("Inter-400-normal.woff"), fontWeight: 400 },
      { src: resolve("Inter-500-normal.woff"), fontWeight: 500 },
      { src: resolve("Inter-600-normal.woff"), fontWeight: 600 },
    ],
  });
}

const styles = StyleSheet.create({
  page: { paddingTop: 48, paddingBottom: 56, paddingHorizontal: 48, fontFamily: "Inter", fontSize: 10, color: INK },
  row: { flexDirection: "row" },
  spaceBetween: { flexDirection: "row", justifyContent: "space-between" },
  logo: { height: 32, marginBottom: 8, objectFit: "contain" },
  practiceName: { fontSize: 14, fontWeight: 600, marginBottom: 8 },
  invoiceLabel: { fontSize: 20, fontWeight: 600, marginBottom: 4 },
  metaLabel: { fontSize: 9, color: MUTED },
  metaValue: { fontSize: 10, fontWeight: 500, marginBottom: 6 },
  section: { marginTop: 32 },
  billToLabel: { fontSize: 9, color: MUTED, marginBottom: 4 },
  billToName: { fontSize: 11, fontWeight: 500 },
  billToLine: { fontSize: 10, color: MUTED, marginTop: 2 },
  amountDueBlock: { marginTop: 32, marginBottom: 24 },
  amountDueLabel: { fontSize: 10, color: MUTED, marginBottom: 4 },
  amountDueValue: { fontSize: 28, fontWeight: 600 },
  table: { marginTop: 8, borderTopWidth: 1, borderTopColor: DIVIDER },
  tableHeaderRow: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: DIVIDER, paddingVertical: 8 },
  tableRow: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: DIVIDER, paddingVertical: 8 },
  tableHeaderCell: { fontSize: 9, color: MUTED, fontWeight: 500 },
  colDescription: { flex: 3 },
  colQty: { flex: 1, textAlign: "right" },
  colUnit: { flex: 1, textAlign: "right" },
  colAmount: { flex: 1, textAlign: "right" },
  totalsBlock: { marginTop: 16, alignItems: "flex-end" },
  totalsRow: { flexDirection: "row", justifyContent: "space-between", width: 200, marginBottom: 4 },
  totalsLabel: { fontSize: 10, color: MUTED },
  totalsValue: { fontSize: 10 },
  totalsFinalRow: { flexDirection: "row", justifyContent: "space-between", width: 200, marginTop: 4, paddingTop: 8, borderTopWidth: 1, borderTopColor: DIVIDER },
  totalsFinalLabel: { fontSize: 11, fontWeight: 600 },
  totalsFinalValue: { fontSize: 11, fontWeight: 600 },
  customFieldsBlock: { marginTop: 24 },
  customFieldRow: { flexDirection: "row", marginBottom: 2 },
  customFieldName: { fontSize: 9, color: MUTED, width: 100 },
  customFieldValue: { fontSize: 9 },
  memoBlock: { marginTop: 24 },
  memoText: { fontSize: 9, color: MUTED },
  footerBlock: { position: "absolute", bottom: 32, left: 48, right: 48, borderTopWidth: 1, borderTopColor: DIVIDER, paddingTop: 8 },
  footerText: { fontSize: 8, color: MUTED },
  pageNumber: { position: "absolute", bottom: 32, right: 48, fontSize: 8, color: MUTED },
  accentBar: { height: 3, backgroundColor: ACCENT, marginBottom: 24 },
});

// ★ formatMoney: minor units → "$1,234.56". USD-only today (Docustay is USD; no zero-decimal-currency
//   handling — SPEC-GAP, matches the rest of this rebuild's "not invented, not built yet" posture
//   for anything the brief didn't ask for).
function formatMoney(minorUnits, currency) {
  const amount = minorUnits / 100;
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() }).format(amount);
  } catch {
    return `$${amount.toFixed(2)}`;
  }
}

function formatDate(isoString) {
  if (!isoString) return "—";
  const d = new Date(isoString);
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

/**
 * ★ The one invoice PDF component. Takes the SAME `view` object InvoiceViewSchema validates
 *   (src/money/invoiceView.mjs) — never a second, independent set of props.
 *
 * @param {object} p
 * @param {object} p.view a parsed InvoiceViewSchema object
 * @param {"a4"|"letter"} p.pageSize
 */
export function InvoiceDocument({ view, pageSize = "a4" }) {
  const size = pageSize === "letter" ? "LETTER" : "A4";
  // ★ Byte-parity (INVOICE-REBUILD.md §3/§5): the browser preview and the server-rendered
  //   attachment must produce IDENTICAL bytes for the same snapshot. @react-pdf/renderer stamps a
  //   wall-clock `creationDate`/`modDate` into the PDF's Info dictionary by default, which would
  //   make every render differ even for the same `view` — pin both to the snapshot's OWN issueDate
  //   (deterministic, not "now") and a fixed `producer`/`creator` string.
  return h(Document, {
    title: `Invoice ${view.invoiceNumber}`,
    producer: "Workbench",
    creator: "Workbench",
    creationDate: new Date(view.issueDate),
    modificationDate: new Date(view.issueDate),
  },
    h(Page, { size, style: styles.page },
      h(View, { style: styles.accentBar }),
      h(View, { style: styles.spaceBetween },
        h(View, null,
          view.practice.logoUrl
            ? h(Image, { src: view.practice.logoUrl, style: styles.logo })
            : h(Text, { style: styles.practiceName }, view.practice.name),
          h(Text, { style: styles.invoiceLabel }, "Invoice"),
        ),
        h(View, { style: { alignItems: "flex-end" } },
          h(Text, { style: styles.metaLabel }, "Invoice number"),
          h(Text, { style: styles.metaValue }, view.invoiceNumber),
          h(Text, { style: styles.metaLabel }, "Date of issue"),
          h(Text, { style: styles.metaValue }, formatDate(view.issueDate)),
          view.dueDate ? h(Text, { style: styles.metaLabel }, "Date due") : null,
          view.dueDate ? h(Text, { style: styles.metaValue }, formatDate(view.dueDate)) : null,
        ),
      ),
      h(View, { style: [styles.section, styles.spaceBetween] },
        h(View, null,
          h(Text, { style: styles.billToLabel }, "From"),
          h(Text, { style: styles.billToName }, view.practice.name),
          view.practice.phone ? h(Text, { style: styles.billToLine }, view.practice.phone) : null,
        ),
        h(View, null,
          h(Text, { style: styles.billToLabel }, "Bill to"),
          h(Text, { style: styles.billToName }, view.customer.name || "—"),
          view.customer.email ? h(Text, { style: styles.billToLine }, view.customer.email) : null,
        ),
      ),
      h(View, { style: styles.amountDueBlock },
        h(Text, { style: styles.amountDueLabel }, view.dueDate ? `${formatMoney(view.amountDue, view.currency)} due ${formatDate(view.dueDate)}` : `${formatMoney(view.amountDue, view.currency)} due`),
        h(Text, { style: styles.amountDueValue }, formatMoney(view.amountDue, view.currency)),
      ),
      h(View, { style: styles.table },
        h(View, { style: styles.tableHeaderRow },
          h(Text, { style: [styles.tableHeaderCell, styles.colDescription] }, "Description"),
          h(Text, { style: [styles.tableHeaderCell, styles.colQty] }, "Qty"),
          h(Text, { style: [styles.tableHeaderCell, styles.colUnit] }, "Unit price"),
          h(Text, { style: [styles.tableHeaderCell, styles.colAmount] }, "Amount"),
        ),
        ...view.lines.map((line, i) =>
          h(View, { key: String(i), style: styles.tableRow },
            h(Text, { style: styles.colDescription }, line.description),
            h(Text, { style: styles.colQty }, String(line.quantity)),
            h(Text, { style: styles.colUnit }, formatMoney(line.unitAmount, view.currency)),
            h(Text, { style: styles.colAmount }, formatMoney(line.amount, view.currency)),
          )
        ),
      ),
      h(View, { style: styles.totalsBlock },
        h(View, { style: styles.totalsRow },
          h(Text, { style: styles.totalsLabel }, "Subtotal"),
          h(Text, { style: styles.totalsValue }, formatMoney(view.subtotal, view.currency)),
        ),
        view.discountTotal > 0 ? h(View, { style: styles.totalsRow },
          h(Text, { style: styles.totalsLabel }, "Discount"),
          h(Text, { style: styles.totalsValue }, `-${formatMoney(view.discountTotal, view.currency)}`),
        ) : null,
        view.taxTotal > 0 ? h(View, { style: styles.totalsRow },
          h(Text, { style: styles.totalsLabel }, "Tax"),
          h(Text, { style: styles.totalsValue }, formatMoney(view.taxTotal, view.currency)),
        ) : null,
        h(View, { style: styles.totalsRow },
          h(Text, { style: styles.totalsLabel }, "Total"),
          h(Text, { style: styles.totalsValue }, formatMoney(view.total, view.currency)),
        ),
        view.amountPaid > 0 ? h(View, { style: styles.totalsRow },
          h(Text, { style: styles.totalsLabel }, "Paid"),
          h(Text, { style: styles.totalsValue }, `-${formatMoney(view.amountPaid, view.currency)}`),
        ) : null,
        h(View, { style: styles.totalsFinalRow },
          h(Text, { style: styles.totalsFinalLabel }, "Amount due"),
          h(Text, { style: styles.totalsFinalValue }, formatMoney(view.amountDue, view.currency)),
        ),
      ),
      view.customFields.length > 0 ? h(View, { style: styles.customFieldsBlock },
        ...view.customFields.map((f, i) =>
          h(View, { key: String(i), style: styles.customFieldRow },
            h(Text, { style: styles.customFieldName }, f.name),
            h(Text, { style: styles.customFieldValue }, f.value),
          )
        ),
      ) : null,
      view.memo ? h(View, { style: styles.memoBlock }, h(Text, { style: styles.memoText }, view.memo)) : null,
      view.footer ? h(View, { style: styles.footerBlock }, h(Text, { style: styles.footerText }, view.footer)) : null,
      h(Text, { style: styles.pageNumber, render: ({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}` }),
    ),
  );
}
