// Which language a signer meets Docustay in. The sender's explicit choice for the document wins; otherwise the signer's own (their browser, remembered on their party row, or the language the same address used before in this workspace); otherwise English.
import { isExplicitLanguage, LANGUAGES } from "./languages.mjs";

const valid = (l) => (typeof l === "string" && LANGUAGES.includes(l) ? l : null);

/** → { language, auto } for a person on a send. `auto` is true when the sender did not force a language, so the signing page may still choose from the browser. */
export async function languageFor(tx, { sendOptions, party }) {
  const forced = sendOptions?.language;
  if (isExplicitLanguage(forced)) return { language: forced, auto: false };
  let known = valid(party?.signer_language);
  if (!known && party?.email) {
    const { rows: [r] } = await tx.query(`SELECT signer_language FROM keystone.document_party WHERE lower(email) = lower($1) AND signer_language IS NOT NULL ORDER BY coalesce(completed_at, consented_at, invited_at, created_at) DESC LIMIT 1`, [party.email]);
    known = valid(r?.signer_language);
  }
  return { language: known ?? "en", auto: true };
}

/** The signer chose, or their browser says, this language: remember it (only when the send leaves the choice open). */
export async function rememberSignerLanguage(tx, { sendOptions, partyId, language }) {
  if (isExplicitLanguage(sendOptions?.language) || !valid(language)) return;
  await tx.query(`UPDATE keystone.document_party SET signer_language = $2 WHERE id = $1 AND signer_language IS DISTINCT FROM $2`, [partyId, language]);
}

/** The Certificate of Completion speaks the sender's language, or, on a send that matches each signer, the language of the first person who signed. */
export async function certificateLanguage(tx, { leadId, sendOptions }) {
  if (isExplicitLanguage(sendOptions?.language)) return sendOptions.language;
  const { rows: [r] } = await tx.query(`SELECT signer_language FROM keystone.document_party WHERE instance_id = $1 AND signer_language IS NOT NULL ORDER BY coalesce(completed_at, consented_at, created_at), position LIMIT 1`, [leadId]);
  return valid(r?.signer_language) ?? "en";
}
