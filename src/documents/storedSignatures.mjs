// P15C.0 — PORTED FROM `functions/shared/esign/storedSignatures.cjs` (ADD6-1).
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ THE ONE ANSWER TO "WHAT DOES THIS SIGNATURE BLOCK CONTAIN", FOR THE SCREEN **AND** THE PDF.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★ THE DEFECT THIS FILE EXISTS TO PREVENT, MEASURED IN THE SOURCE SYSTEM ON A REAL EXECUTED
//    INSTRUMENT (a Parent Coaching Agreement):
//      · the record held SIXTEEN inline signature marks — 8 parent, 8 staff;
//      · `pdfimages -list` on the generated PDF found **TWO**, both on an appendix page.
//    Every clause of an executed legal instrument printed a name and no signature, while the screen
//    showed all sixteen. **Two readers of one record, disagreeing.**
//   ★ The cause was not a rendering bug. The screen resolved marks BY FIELD from the stored values;
//     the PDF resolved them BY ROLE from one-record-per-signer and skipped signature fields outright.
//     **Two records cannot represent sixteen blocks.** There is no version of that which agrees.
//
// ★★★ SO THERE IS EXACTLY ONE COPY OF THIS LOGIC IN KEYSTONE AND BOTH SURFACES IMPORT IT:
//     · the signing surface / the record shell (`web/src/esign/**`) — imports this module directly;
//     · the PDF renderer (P18.4, server) — will import this module directly.
//   ★★ NOT re-implemented, NOT duplicated-and-parity-tested. A parity test is the right posture while
//      two copies exist; it is not a substitute for there being one. The source system learned that
//      the expensive way and its own comment says so.
//   ★ This file therefore uses NOTHING node-only at module scope. `dataUriToBuffer` touches `Buffer`
//     INSIDE the function, so the browser can import the module and simply never call that one —
//     which is true today (only the PDF path decodes marks to bytes).
//
// ★★ WHY THE MARK COMES FROM THE STORED VALUES AND NOT FROM THE SIGNATURE RECORDS. A signature
//    record is written ONCE PER PARTY. The per-section model means one signer applies their mark to
//    every block they own, each an individual acknowledgment of the clause it sits under. Only the
//    values hold the per-block marks. The records remain the authority for WHEN and BY WHOM — so
//    this JOINS the two: the mark from the values, the stamp from the record.

/**
 * A stored timestamp → ISO string.
 *
 * ★★★ TWO BRANCHES OF THE SOURCE VERSION ARE DELIBERATELY NOT PORTED, and saying so is the point:
 *     the original accepted Firestore `Timestamp` objects (`.toDate()`) and `{ _seconds }` /
 *     `{ seconds }` bags. **Keystone has no Firestore.** A timestamp here arrives either as a JS
 *     `Date` (from `pg`) or as an ISO string (from jsonb), and nothing else can occur.
 *   ★ Carrying the dead branches forward would tell the next reader that Firestore shapes are
 *     supported and safe to write — so an importer would produce them, and they would then be
 *     silently accepted by this one function and rejected by every constraint around it. Narrower is
 *     correct here; anything unrecognised returns null rather than a plausible guess.
 */
export function toIso(v) {
  if (!v) return null;
  if (typeof v === "string") return v;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString();
  return null;
}

/**
 * Flatten a section's fields across BOTH stored dialects, including nested rows.
 *
 * ★★★ BOTH DIALECTS, ALWAYS, IN BOTH DIRECTIONS — this is CLAUDE.md §2.8a's measured rule and it is
 *     not a guarantee about which object carries which: a live schema kept `fieldsJson` (a STRING)
 *     and a frozen snapshot kept `fields` (an ARRAY), and then snapshots were measured carrying
 *     `fieldsJson` too. A helper that assumes one returns NOTHING for the other and fails SILENTLY,
 *     which reads exactly like "this document has no fields".
 * ★★ AND IT RECURSES. Measured in the source system: a flat walk over three screenings found 155
 *    questions; recursing found 198. A mapper that does not recurse loses 43 of them and still looks
 *    complete.
 */
export function flattenFields(section) {
  let fields = Array.isArray(section?.fields) ? section.fields : [];
  if (!fields.length && typeof section?.fieldsJson === "string") {
    try { fields = JSON.parse(section.fieldsJson); } catch { fields = []; }
  }
  const out = [];
  const walk = (arr) => {
    for (const f of arr || []) {
      if (!f || typeof f !== "object") continue;
      // ★ A container is anything with its own `fields`; only leaves are collected. `columns[]` +
      //   `components[]` nesting from the source system is handled by the same recursion because
      //   both appear as arrays under a field-like object.
      if (Array.isArray(f.fields)) walk(f.fields);
      else if (Array.isArray(f.columns)) walk(f.columns.flatMap((c) => c?.components ?? []));
      else out.push(f);
    }
  };
  walk(fields);
  return out;
}

/**
 * Build `fieldKey → { value, signedLocalDate, signerTimeZone, signedAtUtc, signerName, role }`.
 *
 * ★ OWNERSHIP IS READ PER FIELD, FALLING BACK TO THE SECTION — which is what lets one section hold a
 *   client block AND a staff block and still stamp each with the right party's date. Note that this
 *   is a fallback WITHIN one field's own ownership chain (field → its section), NOT a fallback from
 *   one PARTY to another: CLAUDE.md §2.7's rule is never to borrow another party's name, and the
 *   live defect it records is exactly that.
 */
export function buildStoredSignatureIndex({ sections, data, signatureRecords }) {
  const index = {};
  const values = data || {};
  const records = Array.isArray(signatureRecords) ? signatureRecords : [];

  // ★ Newest record per party — a re-sign SUPERSEDES, it does not accumulate. (Same law as §Z4 for
  //   prices, one domain over: the latest row wins and the old one stays as evidence.)
  const byRole = new Map();
  for (const r of records) {
    const role = (r && r.role) || "";
    if (!role) continue;
    const prev = byRole.get(role);
    if (!prev) { byRole.set(role, r); continue; }
    if ((toIso(r.signedAt) || "") > (toIso(prev.signedAt) || "")) byRole.set(role, r);
  }

  // ★★ ONE RECORD AND NO OWNER INFORMATION is the ordinary single-signer case, and it covers every
  //    block. A LAST RESORT ONLY — never allowed to override an owner match, because guessing which
  //    party signed a block is invention, and on an executed instrument it is invention that prints.
  const soleRecord = records.length === 1 ? records[0] : null;

  for (const section of sections || []) {
    if (!section || typeof section !== "object") continue;
    for (const field of flattenFields(section)) {
      if (!field || field.type !== "signature" || !field.key) continue;

      const owner = field.owner || section.owner || null;
      const raw = values[field.key];
      const value = typeof raw === "string" && raw.length > 0 ? raw : null;

      // ★★★ A BLOCK NOBODY SIGNED HAS NO SIGNING TIME. No mark, no stamp — unconditionally, and
      //     BEFORE any record is consulted. Otherwise the sole-record fallback hands an unsigned
      //     coach block the client's date, and the PDF — which has no "applied" guard to hide it —
      //     PRINTS that. This ordering is the guard; it is not an optimisation.
      const rec = value ? (owner && byRole.get(owner)) || soleRecord || null : null;

      index[field.key] = {
        value,
        signedLocalDate: (rec && rec.signedLocalDate) || null,
        signerTimeZone: (rec && rec.signerTimeZone) || null,
        signedAtUtc: rec ? toIso(rec.signedAt) : null,
        signerName: (rec && rec.signerName) || null,
        role: (rec && rec.role) || owner || null,
      };
    }
  }

  return index;
}

/** Format an instant IN THE SIGNER'S ZONE. §B4 STEP 3's discipline: the zone is part of the fact. */
function formatInstantInZone(iso, timeZone) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const opts = {
    year: "numeric", month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit", timeZoneName: "short",
  };
  if (timeZone) {
    try { return d.toLocaleString("en-US", { ...opts, timeZone }); } catch { /* fall through */ }
  }
  return d.toLocaleString("en-US", opts);
}

/**
 * The stamp to display AND WHAT IT MEANS, returned together.
 * ★★ The label is not decoration. "Date signed" and "Audit timestamp" are different claims: the
 *    first is what the signer's own device reported, the second is when the server recorded it. A
 *    surface that prints one while labelling it the other is making a false statement on an executed
 *    instrument, so the two travel as one object and no caller gets to pair them itself.
 */
export function describeStoredStamp(s) {
  if (!s) return null;
  if (s.signedAtUtc) {
    const formatted = formatInstantInZone(s.signedAtUtc, s.signerTimeZone);
    if (formatted) {
      return {
        label: s.signedLocalDate ? "Date and time signed" : "Audit timestamp",
        value: formatted,
      };
    }
  }
  if (s.signedLocalDate) {
    return {
      label: "Date signed",
      value: s.signedLocalDate + (s.signerTimeZone ? ` (${s.signerTimeZone})` : ""),
    };
  }
  return null;
}

/**
 * `data:image/png;base64,…` → bytes. Null for anything else.
 * ★ SERVER-SIDE CALLERS ONLY (the PDF renderer, P18.4). `Buffer` is referenced inside the function
 *   so a browser can import this module and never touch it — which is what keeps ONE copy of the
 *   resolver above serving both surfaces.
 */
export function dataUriToBuffer(dataUri) {
  if (typeof dataUri !== "string") return null;
  const m = /^data:image\/(png|jpe?g);base64,([A-Za-z0-9+/=\s]+)$/i.exec(dataUri.trim());
  if (!m) return null;
  try {
    const buf = Buffer.from(m[2].replace(/\s+/g, ""), "base64");
    return buf.length > 0 ? { buffer: buf, format: m[1].toLowerCase() === "png" ? "png" : "jpg" } : null;
  } catch {
    return null;
  }
}
