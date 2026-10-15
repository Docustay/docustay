// The signing page's words in English (this file, the source) and every other language (src/documents/lang/<l>.mjs, copied into i18n-gen.json by scripts/build-languages.mjs). The language is the one the sender chose for the send (view.language); the sender's own message is never translated.
// ★ MACHINE-WRITTEN: every language but English is a draft marked Beta — a native speaker has not read them. The ten added in Part 30 item 9 (pt it nl pl tr ru ar ja zh ko) come from src/lib/i18n-gen.json (built from the island's language files).
import GEN from "./i18n-gen.json";
const EN = {
  pad: { draw: "Draw", type: "Type", cancel: "Cancel", signature: "signature", initials: "initials", picture: "picture", use: (l) => `Use this ${l}`, drawFirst: (l) => `Draw your ${l} first.`, typeFirst: "Type your name first.", useSavedSignature: "Use my saved signature", useSavedInitials: "Use my saved initials", savedSignature: "Your saved signature", savedInitials: "Your saved initials", rememberSignature: "Remember my signature in this browser", rememberInitials: "Remember my initials in this browser", forget: "Remove it from this browser", tooBig: "That is too large — try a simpler one.", yourName: "Your name", drawHere: (l) => `Draw your ${l} here`, signHere: "Sign here" },
  fileOnFile: "File added",
  loading: "Loading…", refusedTitle: "This link isn't working", refused: "That link is not valid. It may have been used already, expired, or been cancelled — ask them for a new one.", trouble: "Something went wrong loading this. Try reloading the page.",
  signedTitle: "You've signed", signedBody: "Everyone will get the sealed copy once the last person has signed. You can close this page.", signedLastBody: "Everyone has now signed, so the document is complete. You can close this page.",
  declinedTitle: "Declined", declinedBody: "The sender has been told. You can close this page.",
  waitingTitle: "Not your turn yet", waitingBody: (who) => `${who} signs first. We'll email you when it's your turn.`, someoneElse: "Someone else",
  testNote: "This is a test. It shows what the signer sees; nothing you do here is recorded.", pagesFailed: "The pages could not be loaded.",
  more: "More", toFill: (n) => `${n} to fill in`, allFilled: "All filled in", nextField: "Next field", yourName: "Your full name", agree: "I agree to sign electronically", finish: "Finish and sign", later: "Save and finish later", decline: "Decline",
  declineWhyReq: "Why are you declining? (required)", declineWhy: "Why are you declining? (optional)", declineSend: "Decline this document", cancel: "Cancel",
  dateOnSigning: "Date (on signing)", saved: "Saved. Use this same link to carry on.", saveFailed: "That could not be saved. Try again.",
  needName: "Type your full name to sign.", needFields: (n) => (n === 1 ? "1 field still needs filling in." : `${n} fields still need filling in.`), needConsent: "Agree to sign electronically first.", testNoSign: "This is a test — nothing is recorded and you cannot sign.", testNoRec: "This is a test — nothing is recorded.", needReason: "Please tell them why you are declining.", signFailed: "Something went wrong sending your signature. Try again.",
  approveTitle: "Your approval is asked for", approve: "Approve", reject: "Reject", comment: "Add a comment (optional)", approvedDone: "Thank you — your answer was recorded.", approverNote: "Nothing is approved until you choose to approve it.",
  viewTitle: "Please confirm you have seen this", viewConfirm: "I have seen this document", viewDone: "Thank you — it is recorded that you have seen it.", viewNote: "You are only asked to confirm you have seen it — you are not signing anything.",
  assistTitle: (n) => `Fill in details${n ? ` for ${n}` : ""}`, assistSave: "Save", assistFinish: "Save and finish", assistDone: "Thank you — the details were saved.", assistNote: "You are filling in details only. The person you are helping will still check and sign.",
  upload: "Choose a file", uploading: "Uploading…", uploaded: "File added", uploadFailed: "That file could not be uploaded.", pay: (label) => `Pay ${label}`, paid: "Paid", payNote: "You pay on Stripe's own secure page. Docustay never sees your card.", payCancelled: "The payment was cancelled. You have not been charged.", payWaiting: "Stripe's secure payment page opened in a new tab. Finish there; this page will notice.", payCheck: "I have paid — check", payStripe: "Pay with Stripe", payUnavailable: "Payment is not available right now. Ask the sender.", payFailed: "The payment did not go through.",
  languageName: "English",
  languageLabel: "Language",
  sp: GEN.en.sp, err: GEN.en.err,   // the signing page's other sentences and the server's messages, kept in the island (src/documents/lang/en.mjs) so the languages and the gate see them
};
// ── every language but English: plain strings with {0} placeholders (src/documents/lang/<l>.mjs), turned into the same shapes as the English table above (kept identical to src/documents/languages.mjs hydrateWeb; a test compares them)
export const fmt = (str, ...a) => String(str).replace(/\{(\d)\}/g, (_, i) => a[Number(i)] ?? "");
function hydrate(w) {
  const { needFields1, needFieldsN, assistTitleFor, ...rest } = w;
  return {
    ...rest,
    pad: { ...w.pad, use: (l) => fmt(w.pad.use, l), drawFirst: (l) => fmt(w.pad.drawFirst, l), drawHere: (l) => fmt(w.pad.drawHere, l) },
    waitingBody: (who) => fmt(w.waitingBody, who), toFill: (n) => fmt(w.toFill, n), needFields: (n) => (n === 1 ? needFields1 : fmt(needFieldsN, n)),
    assistTitle: (n) => (n ? fmt(assistTitleFor, n) : w.assistTitle), pay: (label) => fmt(w.pay, label),
  };
}
export const LANGS = { en: EN, ...Object.fromEntries(Object.entries(GEN.web).map(([k, v]) => [k, hydrate(v)])) };
export const LANGUAGES = GEN.languages;
/** name in the language itself, direction, whether it is a machine-written draft (Beta) */
export const LANG_META = GEN.meta;
export const languageLabel = (lang) => { const m = LANG_META[lang]; return m ? (m.beta ? `${m.name} (Beta)` : m.name) : String(lang); };
export const dirOf = (lang) => (LANG_META[lang]?.dir === "rtl" ? "rtl" : "ltr");
export const wordsFor = (lang) => LANGS[lang] ?? EN;

/** The first of the person's browser languages that the signing page speaks (see src/documents/languages.mjs pickLanguage: this is the same rule, kept in step by test/p31_language_auto.test.mjs). pt-PT is Portuguese; Traditional Chinese is skipped, not shown in Simplified. */
export function pickLanguage(tags) {
  for (const raw of Array.isArray(tags) ? tags : []) {
    const tag = String(raw ?? "").trim();
    if (!/^[A-Za-z]{2,3}([-_][A-Za-z0-9]{2,8})*$/.test(tag) || /^zh[-_](hant|tw|hk|mo)/i.test(tag) || /^[A-Za-z]{3}/.test(tag)) continue;
    const base = tag.slice(0, 2).toLowerCase();
    if (LANGUAGES.includes(base)) return base;
  }
  return null;
}
/** A message the server sent (English text), in the person's language when we have words for it, English otherwise. */
export function serverMessage(lang, text) {
  const slug = Object.keys(EN.err).find((k) => EN.err[k] === text);
  return (slug && LANGS[lang]?.err?.[slug]) || text;
}
