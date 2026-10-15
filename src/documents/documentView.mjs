// src/documents/documentView.mjs — THE ONE DOCUMENT VIEW (QUEUE §23.2.1 / research §3). A pure function that turns a document (or a package of several) into a neutral tree of nodes.
// BOTH renderers read ONLY this tree: the React screen (preview, signing) and the pdfkit PDF (preview, signed copy). There is no second copy of the document's logic anywhere,
// so the screen and the PDF cannot drift.
//
// ★ ISOMORPHIC. No imports from Node or from the host (only the settings schema, itself import-free), no clock, no randomness: the same input is the same output, in the server and in the browser.
// ★ THREE MODES.  template_preview — an unsigned draft, signature slots are empty labelled lines.  signing — the signer's live view, slots are "pending" markers the screen turns into controls.
//   signed — frozen: each slot shows the recorded signature (the drawn mark, or the typed name in a signature font) with printed name, date, time and zone, and a Certificate of Completion follows.
// ★ A PACKAGE. `documents` is a LIST (QUEUE 23.4.15): today's one-document send is a package of one; N documents share one set of signatures and one certificate.
// ★ SIGNATURES ARE DRAWN IN PLACE. A template's signature slot is matched to its recorded signature by `owner === role` (the two use one closed vocabulary). A matched slot shows the signature;
//   an unmatched slot on a SIGNED copy is left out (the party was not required); a signature no slot claims is appended once, under a single "Signatures" heading. The words
//   "[signature slot …]" are never produced.

import { withSettingDefaults } from "./settingsSchema.mjs";

import { certWords } from "./certificateLanguages.mjs";

const VIEW_MODES = Object.freeze(["template_preview", "signing", "signed"]);

// ★★★ CLAUDE.md §2.7 — NAME THE PARTY THE ROW NAMES. A `pir` signature is printed as PIR and a `client` one as CLIENT; one is never borrowed as the other's label (a tech client was once badged "PIR").
//     Printed in capitals, as the old signature block did and as db/gates/p18_pdf.mjs still requires.
const ROLE_LABELS = Object.freeze({
  pir: "PIR", client: "CLIENT", parent: "PARENT OR GUARDIAN", coach: "COACH", consultant: "CONSULTANT", familyMember: "FAMILY MEMBER", recipient: "RECIPIENT",
});
const roleLabel = (r) => ROLE_LABELS[r] ?? String(r ?? "").replace(/^signer_(\d+)$/, "Signer $1");
/** A seat key as a person reads it: the named label if it has one, otherwise "Signer 2" for `signer_2` (never the raw key). */
const seatName = roleLabel;


/** "October 3, 2026 at 4:07 PM PDT" — an instant shown in a named zone; an unknown zone falls back to UTC (never throws). */
// D-007: the draft-stage events that have no translated label in certificateLanguages (created in the editor, or uploaded)
const DRAFT_KINDS = Object.freeze({ created: "Document created", uploaded: "Document uploaded" });
export function formatInstant(iso, zone = "UTC") {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const make = (tz) => new Intl.DateTimeFormat("en-US", { year: "numeric", month: "long", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: tz, timeZoneName: "short" }).format(d);
  try { return make(zone || "UTC"); } catch { return make("UTC"); }
}
const formatUtc = (iso) => (iso ? formatInstant(iso, "UTC") : "—");

/** A short, honest description of a browser: "Safari on iPhone". Unknown stays unknown. */
export function deviceFromUserAgent(ua) {
  if (!ua) return null;
  const os = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android" : /Windows/.test(ua) ? "Windows" : /Mac OS X|Macintosh/.test(ua) ? "Mac" : /CrOS/.test(ua) ? "ChromeOS" : /Linux/.test(ua) ? "Linux" : null;
  const browser = /Edg\//.test(ua) ? "Edge" : /OPR\/|Opera/.test(ua) ? "Opera" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\/|CriOS/.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : null;
  if (browser && os) return `${browser} on ${os}`;
  return browser ?? os ?? "an unrecognised device";
}

function inlineRuns(blocks, resolve) {
  const runs = [];
  for (const b of blocks ?? []) {
    if (b.type === "prose") {
      const marks = b.marks ?? [];
      runs.push({ text: b.text ?? "", bold: marks.includes("bold"), italic: marks.includes("italic"), ...(b.href ? { href: b.href } : {}) });
    } else if (b.type === "variable") {
      const v = resolve(b.name);
      runs.push(v ? { text: String(v), bold: false, italic: false } : { text: `[${b.label} — not provided]`, bold: false, italic: false, missing: true });
    } else if (b.type === "lineBreak") runs.push({ text: "\n", bold: false, italic: false });
  }
  return runs;
}

/** A block array → paragraph and list nodes, in order (signature blocks are the caller's business). The one place the "which blocks make a paragraph" rule lives; the React reader and the view builder both use it. */
export function blocksToNodes(blocks, variables = {}) {
  const resolve = (name) => variables?.[name];
  const nodes = [];
  let run = [];
  const flush = () => { if (run.length) nodes.push({ type: "paragraph", runs: inlineRuns(run, resolve) }); run = []; };
  for (const b of blocks ?? []) {
    if (b.type === "prose" || b.type === "variable" || b.type === "lineBreak") run.push(b);
    else if (b.type === "paragraphBreak") flush();
    else if (b.type === "list") { flush(); nodes.push({ type: "list", ordered: Boolean(b.ordered), items: (b.items ?? []).map((item) => inlineRuns(item, resolve)) }); }
  }
  flush();
  return nodes;
}

function signatureView(sig, s, fallbackZone, executedAt) {
  const zone = sig.signerTimezone || fallbackZone || "UTC";
  const signedAt = sig.signedAt ?? executedAt ?? null;
  const style = s["signed_copy.signature_style"];
  const drawn = Boolean(sig.markImage);
  const markKind = style === "typed" ? "typed" : style === "drawn" ? (drawn ? "drawn" : "name") : (drawn ? "drawn" : "typed");
  return {
    role: sig.role, roleLabel: roleLabel(sig.role), printedName: sig.signerName ?? "",
    markKind, markImage: markKind === "drawn" ? sig.markImage : null, typedText: sig.signerName ?? "",
    signedAt, zone, localDate: sig.signedLocalDate ?? null,
    // date, time, the zone's short name AND its full name: "PST" alone is ambiguous across the world, the IANA name is not
    signedText: signedAt ? `${formatInstant(signedAt, zone)}${zone !== "UTC" ? ` (${zone})` : ""}` : (sig.signedLocalDate ? `${sig.signedLocalDate} (${zone})` : "—"),
    email: s["signed_copy.show_signer_email"] ? (sig.signerEmail ?? null) : null,
    ip: s["signed_copy.show_signer_ip"] ? (sig.signerIp ?? null) : null,
  };
}

function contractNodes(body, { values, mode, sigByRole, consumed, s, zone, executedAt }) {
  const nodes = [];
  const resolve = (section, name) => section.values?.[name] ?? values?.[name] ?? body.values?.[name];
  let slots = 0;
  for (const section of body.sections ?? []) {
    nodes.push({ type: "heading", text: section.title ?? "" });
    let run = [];
    const flush = () => { if (run.length) nodes.push({ type: "paragraph", runs: inlineRuns(run, (n) => resolve(section, n)) }); run = []; };
    for (const b of section.blocks ?? []) {
      if (b.type === "prose" || b.type === "variable" || b.type === "lineBreak") run.push(b);
      else if (b.type === "paragraphBreak") flush();
      else if (b.type === "list") {
        flush();
        nodes.push({ type: "list", ordered: Boolean(b.ordered), items: (b.items ?? []).map((item) => inlineRuns(item, (n) => resolve(section, n))) });
      } else if (b.type === "signature") {
        flush();
        const owner = b.owner ?? section.owner;
        if (mode === "signed") {
          const sig = sigByRole.get(owner);
          if (sig) { consumed.add(owner); slots += 1; nodes.push({ type: "signature", state: "signed", label: b.label, owner, signature: signatureView(sig, s, zone, executedAt) }); }
        } else { slots += 1; nodes.push({ type: "signature", state: mode === "signing" ? "pending" : "slot", label: b.label, owner }); }
      }
    }
    flush();
  }
  return { nodes, slots };
}

function formNodes(body, values) {
  const nodes = [];
  const walk = (field, depth) => {
    if (Array.isArray(field.children) && field.children.length) {
      nodes.push({ type: "panel", label: field.label ?? "", depth });
      for (const c of field.children) walk(c, depth + 1);
      return;
    }
    const raw = values?.[field.key];
    const chosen = Array.isArray(field.options) ? field.options.find((o) => o.value === String(raw))?.label : null;
    const shown = chosen ?? (raw == null || raw === "" ? null : String(raw));
    nodes.push({ type: "field", label: field.label ?? field.key ?? "", value: shown, depth });
  };
  for (const f of body.fields ?? []) walk(f, 0);
  return nodes;
}

// Run 9: "Left out by a rule: Parking bay, page 2" — the sender's own labels and the page numbers a rule took out
const leftOutText = (lo, L) => { const parts = [...(lo?.labels ?? []), ...(lo?.pages ?? []).map((n) => String(L.pageNo ?? "page {0}").replace("{0}", n))]; return parts.length ? `: ${parts.join(", ")}` : ""; };
function certificateView(cert, s, { title, documentId, zone, verifyUrl, language = "en" }) {
  const L = certWords(language);
  const includes = new Set(s["certificate.includes"] ?? []);
  const at = (iso) => (iso ? `${formatInstant(iso, zone)}${zone !== "UTC" ? ` · ${formatUtc(iso)}` : ""}` : "—");
  const parties = (cert.parties ?? []).map((p) => {
    const lines = [[L.sent, p.sentAt ? at(p.sentAt) : "—"], [L.viewed, p.viewedAt ? at(p.viewedAt) : "—"]];
    if (includes.has("consent")) lines.push([L.agreed, p.consentedAt ? `${at(p.consentedAt)}${p.consentVersion ? ` · ${L.wording} ${p.consentVersion}` : ""}` : "—"]);
    lines.push([L.signed, p.signedAt ? at(p.signedAt) : "—"]);
    if (p.reason) lines.push([L.reason ?? "Reason for signing", p.reason]);
    if (p.delegatedFrom) lines.push([L.passedOn ?? "Passed on from", [p.delegatedFrom.name, p.delegatedFrom.email].filter(Boolean).join(" · ")]);
    if (p.group) lines.push([L.signedForGroup ?? "Signed for the group", p.group]);
    if (p.witness) lines.push([L.witnessedBy ?? "Witnessed by", `${[p.witness.name, p.witness.email].filter(Boolean).join(" · ")}${p.witness.at ? ` · ${at(p.witness.at)}` : ""}`]);
    for (const x of p.payments ?? []) lines.push([L.payment ?? "Payment", `${x.label}${x.reference ? ` · Stripe ${x.reference}` : ""}${x.at ? ` · ${at(x.at)}` : ""}`]);
    if (s["signing.show_signature_id"] && p.signatureId) lines.push([L.signatureId ?? "Signature ID", p.signatureId]);
    if (includes.has("ip")) lines.push([L.ip, [p.signedIp, p.viewedIp].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(" · ") || "—"]);
    if (includes.has("device")) lines.push([L.device, deviceFromUserAgent(p.signedUserAgent ?? p.viewedUserAgent) ?? "—"]);
    return { heading: `${p.name || "—"} — ${roleLabel(p.role)}`, email: p.email ?? null, lines };
  });
  return {
    title: L.title,
    summary: [
      [L.document, title], [L.documentId, documentId ?? "—"], [L.status, L.completedState],
      [L.completed, cert.completedAt ? at(cert.completedAt) : "—"],
      [L.sentBy, cert.sender ? [cert.sender.name, cert.sender.email].filter(Boolean).join(" · ") : "—"],
      ...(cert.documents && cert.documents.length > 1 ? [[L.package, cert.documents.map((d, i) => `${i + 1}. ${d}`).join("\n")]] : []),
    ],
    parties,
    fingerprint: includes.has("hashes") ? [[L.contentFp, cert.contentSha256 ?? "—"], ...(cert.originalSha256 ? [[L.originalFp, cert.originalSha256]] : [])] : null,
    timeline: includes.has("timeline") ? (cert.timeline ?? []).filter((e) => e.kind !== "saved").map((e) => [at(e.at), (L.kinds[e.kind] ?? DRAFT_KINDS[e.kind] ?? e.kind) + leftOutText(e.leftOut, L), e.role ? ((cert.parties ?? []).find((p) => p.role === e.role)?.name || seatName(e.role)) : ""]) : null,
    seal: L.seal,
    language, rtl: language === "ar",
    labels: { fingerprint: L.fingerprint, fingerprintNote: L.fingerprintNote, timeline: L.timeline, verify: L.verify },
    statement: s["certificate.statement"],
    verifyUrl: verifyUrl ?? null,
  };
}

/**
 * @param {object} input
 * @param {'template_preview'|'signing'|'signed'} input.mode
 * @param {Array<{key?:string,title?:string,builder:'contract'|'form',body:object,values?:object}>} input.documents  one entry per document in the send (a package of one today)
 * @param {string} input.title                      the send's title
 * @param {string|null} [input.documentId]          shown in the footer; null in a preview
 * @param {Array} [input.signatures]                {role, signerName, signedAt, signedLocalDate, signerTimezone, markImage, signerEmail, signerIp}
 * @param {object} [input.settings]                 the island settings (defaults are filled in here)
 * @param {{practiceName?:string, logoUrl?:string}} [input.brand]
 * @param {string} [input.zone]                     the practice's timezone (used when a signature carries none)
 * @param {object} [input.frozen]                   {terms, price, disclosure} for a signed copy
 * @param {object|null} [input.certificate]         facts for the certificate (see certificateView)
 * @param {boolean} [input.sample]                  a "preview a signed copy" with made-up data: adds a SAMPLE banner
 */
export function buildDocumentView(input) {
  const { mode, documents = [], title = "", documentId = null, signatures = [], brand = {}, zone = "UTC", frozen = null, certificate = null, executedAt = null, sentAt = null, verifyUrl = null, sample = false, language = "en" } = input;
  if (!VIEW_MODES.includes(mode)) throw new Error(`buildDocumentView: mode must be one of ${VIEW_MODES.join(", ")}`);
  const s = withSettingDefaults(input.settings);
  const sigByRole = new Map(signatures.map((x) => [x.role, x]));
  const consumed = new Set();
  let slotsTotal = 0;

  const docs = documents.map((d, i) => {
    let nodes = [];
    if (d.builder === "form") nodes = formNodes(d.body ?? {}, d.values ?? {});
    else if (d.builder === "pdf_pages") nodes = [{ type: "pages", pageCount: d.pageCount ?? null, fieldCount: d.fields?.length ?? 0 }];
    else {
      const r = contractNodes(d.body ?? {}, { values: d.values ?? {}, mode, sigByRole, consumed, s, zone, executedAt });
      nodes = r.nodes; slotsTotal += r.slots;
    }
    return { key: d.key ?? `doc${i + 1}`, title: d.title ?? title, kind: d.builder, nodes };
  });

  // signatures no slot claimed: appended ONCE
  if (mode === "signed") {
    const left = signatures.filter((x) => !consumed.has(x.role));
    if (left.length && docs.length) {
      const last = docs[docs.length - 1];
      last.nodes.push({ type: "heading", text: slotsTotal === 0 ? "Signatures" : "Other signatures" });
      for (const sig of left) last.nodes.push({ type: "signature", state: "signed", label: `${roleLabel(sig.role)} signature`, owner: sig.role, signature: signatureView(sig, s, zone, executedAt) });
    }
  }

  const fmtZone = zone || "UTC";
  return {
    mode, title, documentId, sample, executedAt, sentAt,
    theme: { font: s["signed_copy.font"], bodySize: s["signed_copy.body_size"], margin: s["signed_copy.margin"], accent: s["signed_copy.accent"] },
    chrome: {
      letterhead: s["signed_copy.letterhead"] && (brand.practiceName || brand.logoUrl) ? { logoUrl: brand.logoUrl ?? null, name: brand.practiceName ?? "", address: s["signed_copy.address_line"] || null } : null,
      headerText: s["signed_copy.header_text"] || title,
      footerText: s["signed_copy.footer_text"] || null,
      poweredBy: brand.poweredBy ?? null,   // the product's own line on the free Docustay plan (Part 29, D5); null everywhere else
      showDocumentId: s["signed_copy.show_document_id"],
      documentIdText: documentId ?? "PREVIEW",
      pageNumbers: s["signed_copy.page_numbers"],
      banner: mode === "template_preview" ? "PREVIEW — NOT SIGNED, NOT AN INSTRUMENT" : sample ? "SAMPLE — NOT A REAL DOCUMENT" : null,
      executedLine: mode === "signed" && executedAt ? `Executed ${formatUtc(executedAt)}` : null,
      note: mode === "template_preview" ? "This shows the current draft as a signer would see it. It is not signed and settles nothing." : null,
    },
    frozen: mode === "signed" ? frozen : null,
    documents: docs,
    closingLine: s["signed_copy.closing_line"] || null,
    certificate: mode === "signed" && s["certificate.enabled"] && certificate ? certificateView(certificate, s, { title, documentId, zone: fmtZone, verifyUrl, language }) : null,
  };
}

/**
 * The view as plain reading-order text pieces — what the parity gate compares the PDF's text against (and what a screen reader would hear). One piece per heading, paragraph, list item, field,
 * signature and certificate line; no styling, no layout.
 */
export function viewTextPieces(view) {
  const flat = (runs) => runs.map((r) => r.text).join("").replace(/\s+/g, " ").trim();
  const out = [];
  if (view.chrome.letterhead?.name) out.push(view.chrome.letterhead.name);
  out.push(view.title);
  for (const d of view.documents) {
    for (const n of d.nodes) {
      if (n.type === "heading") out.push(n.text);
      else if (n.type === "paragraph") out.push(flat(n.runs));
      else if (n.type === "list") n.items.forEach((it) => out.push(flat(it)));
      else if (n.type === "panel") out.push(n.label);
      else if (n.type === "field") { out.push(n.label); out.push(n.value === null ? "— not answered —" : n.value); }
      else if (n.type === "signature") { out.push(n.label); if (n.state === "signed") { out.push(n.signature.printedName); out.push(`${n.signature.roleLabel} · Signed ${n.signature.signedText}`); } }
    }
  }
  if (view.closingLine) out.push(view.closingLine);
  if (view.certificate) {
    out.push(view.certificate.title);
    for (const [l, v] of view.certificate.summary) { out.push(l); out.push(String(v)); }
    for (const p of view.certificate.parties) { out.push(p.heading); for (const [l, v] of p.lines) { out.push(l); out.push(String(v)); } }
    out.push(view.certificate.statement);
  }
  return out.filter((x) => x !== "");
}
