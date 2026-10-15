// "Suggest a better translation" (Part 31 follow-up). Pure checks first (so the same rules run in the tests, with no database), then the few queries.
// Spam protection without a CAPTCHA: a hidden field a person never fills, a minimum time on the form, a cap per address per day (one-way hash, the address itself is never stored), a cap on links, a refusal of text that is identical to what is already there, and one row per distinct suggestion.
import { createHash } from "node:crypto";
import { invalid, rateLimited } from "../http/errors.mjs";

const SURFACES = Object.freeze(["app", "signing", "language_menu", "other"]);
const LANG_CODES = Object.freeze(["es", "fr", "de", "pt", "it", "nl", "pl", "tr", "ru", "ar", "ja", "zh", "ko"]);
const MAX_PER_ADDRESS_PER_DAY = 10;
const MIN_SECONDS_ON_FORM = 3;
const placeholders = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
const tags = (s) => [...String(s).matchAll(/<\/?([a-z][\w-]*)>/gi)].map((m) => m[0].toLowerCase()).sort().join(",");
const clean = (v, max) => String(v ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f‪-‮⁦-⁩]/g, "").replace(/\r\n?/g, "\n").trim().slice(0, max);

/** Validates and normalises one suggestion. Throws a plain-words `invalid` error; returns the row to store. `openedAt` is the time the form was opened (ms), sent by the page. */
export function cleanSuggestion(b, { now = Date.now() } = {}) {
  if (!b || typeof b !== "object") throw invalid("the request body is not an object");
  if (b.website) throw invalid("That did not look like a person.", { code: "spam" });                                   // the hidden field
  if (Number.isFinite(Number(b.openedAt)) && now - Number(b.openedAt) < MIN_SECONDS_ON_FORM * 1000) throw invalid("That was sent too quickly. Please check the suggestion and send it again.", { code: "too_fast" });
  const lang = clean(b.lang, 8).toLowerCase(); if (!LANG_CODES.includes(lang)) throw invalid("Pick the language the suggestion is for.", { field: "lang" });
  const surface = SURFACES.includes(b.surface) ? b.surface : "other";
  const sourceKey = clean(b.sourceKey, 1000); if (!sourceKey) throw invalid("Say which sentence this is about.", { field: "sourceKey" });
  const current = clean(b.currentText, 2000), suggested = clean(b.suggestedText, 2000);
  if (!suggested) throw invalid("Write the translation you suggest.", { field: "suggestedText" });
  if (suggested === current) throw invalid("That is the same as the text already shown.", { code: "same_text" });
  if ((suggested.match(/https?:\/\//gi) ?? []).length > 0 && !/https?:\/\//i.test(sourceKey)) throw invalid("A translation does not need a link.", { code: "links" });
  if (/<\/?(script|style|iframe|img|a)\b/i.test(suggested)) throw invalid("A translation is plain text.", { code: "markup" });
  if (surface === "app" || surface === "signing") { if (placeholders(sourceKey) !== placeholders(suggested)) throw invalid("Keep the words in {braces} exactly as they are: they are filled in by the page.", { code: "placeholders" }); if (tags(sourceKey) !== tags(suggested)) throw invalid("Keep the tags such as <b></b> exactly as they are.", { code: "tags" }); }
  const note = clean(b.note, 1000) || null; const email = clean(b.email, 254).toLowerCase() || null;
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw invalid("That email address does not look right (it is optional).", { field: "email" });
  const fingerprint = createHash("sha256").update(`${lang}\u0001${sourceKey}\u0001${suggested}`).digest("hex");
  return { lang, surface, sourceKey, current, suggested, note, email, fingerprint };
}
export const abuseKey = (ip, now = Date.now()) => createHash("sha256").update(`${ip ?? "unresolved"}\u0001${new Date(now).toISOString().slice(0, 10)}\u0001docustay-translation`).digest("hex").slice(0, 32);

export async function addSuggestion(tx, { tenantId, row, abuse }) {
  const used = await tx.query(`SELECT count(*)::int AS n FROM keystone.docustay_translation_suggestion WHERE abuse_key = $1 AND created_at > now() - interval '1 day'`, [abuse]);
  if ((used.rows[0]?.n ?? 0) >= MAX_PER_ADDRESS_PER_DAY) throw rateLimited("You have sent a lot of suggestions today. Thank you; please try again tomorrow.", { retryAfterSeconds: 3600 });
  const r = await tx.query(
    `INSERT INTO keystone.docustay_translation_suggestion (tenant_id, lang, surface, source_key, current_text, suggested_text, note, email, fingerprint, abuse_key)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (tenant_id, fingerprint) DO NOTHING RETURNING id`,
    [tenantId, row.lang, row.surface, row.sourceKey, row.current, row.suggested, row.note, row.email, row.fingerprint, abuse]);
  return { received: true, duplicate: r.rowCount === 0 };
}
export async function listSuggestions(tx, { status = "new", limit = 200 } = {}) {
  const { rows } = await tx.query(`SELECT id, lang, surface, source_key, current_text, suggested_text, note, email, status, review_note, reviewed_at, created_at FROM keystone.docustay_translation_suggestion WHERE ($1::text = 'all' OR status = $1) ORDER BY created_at DESC LIMIT $2`, [status, Math.min(500, limit)]);
  return rows;
}
export async function reviewSuggestion(tx, { id, userId, decision, note }) {
  if (!["approve", "reject"].includes(decision)) throw invalid("decision must be approve or reject");
  const { rows } = await tx.query(`UPDATE keystone.docustay_translation_suggestion SET status = $2, review_note = $3, reviewed_by = $4, reviewed_at = now() WHERE id = $1 AND status IN ('new','approved','rejected') RETURNING id, status`, [id, decision === "approve" ? "approved" : "rejected", clean(note, 1000) || null, userId ?? null]);
  if (!rows[0]) throw invalid("That suggestion was not found.", { code: "not_found" });
  return rows[0];
}
/** The reviewable catalogue patch: every approved suggestion as { lang, surface, key, from, to }. Applied by scripts/i18n/apply-suggestions.mjs, which runs the same gates as any other change, then marks them applied. */
export async function approvedPatch(tx) {
  const { rows } = await tx.query(`SELECT id, lang, surface, source_key, current_text, suggested_text FROM keystone.docustay_translation_suggestion WHERE status = 'approved' ORDER BY created_at`);
  return { version: 1, generatedAt: new Date().toISOString(), changes: rows.map((r) => ({ id: r.id, lang: r.lang, surface: r.surface, key: r.source_key, from: r.current_text, to: r.suggested_text })) };
}
export async function markApplied(tx, ids) { await tx.query(`UPDATE keystone.docustay_translation_suggestion SET status = 'applied', applied_at = now() WHERE id = ANY($1::uuid[]) AND status = 'approved'`, [ids]); }
