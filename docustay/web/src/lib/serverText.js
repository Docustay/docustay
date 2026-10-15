// Run 8 R8-52 (F980): the refusals a person meets most — the monthly limits, the Pro locks, email not set up — come from the server in English.
// A refusal with a known code is rebuilt here from the numbers the server sends; a known fixed sentence is looked up by its English. Everything else is shown as the server wrote it.
// Every sentence is a literal t() call so scripts/i18n-extract.mjs puts it in the catalogue; test/r8_server_text.test.mjs fails when the server's wording and this list drift apart.
// Pure: the caller passes its translator and language (api.js passes t and i18n.lang), so the node tests can run it.

/** The fixed sentences, exactly as src/product/docustay.mjs writes them. */
export const FIXED = (t) => [
  t("This is part of Docustay Pro."),
  t("Automatic reminders are part of Docustay Pro. You can still send a reminder yourself at any time."),
  t("Sending to a list is part of Docustay Pro."),
  t("Adding people and roles is part of Docustay Pro. This workspace has one user, the owner."),
  t("Removing the Docustay footer is part of Docustay Pro."),
  t("Signing links on your own address are part of Docustay Pro."),
  t("Automations (what runs on its own when a document is signed) are part of Docustay Pro."),
  t("Signing groups (several people sharing one seat, the first to sign fills it) are part of Docustay Pro. Put one person in the seat to send it on Free."),
  t("Reminders before a contract's renewal notice date are part of Docustay Pro. The dates still show on the contract and the person."),
  t("Asking Scribe to do things for you is part of Docustay Pro. Scribe still answers questions on Free."),
  t("More documents is part of Docustay Pro."),
  t("Making your own plays and playbooks is part of Docustay Pro. The built-in plays are free to use."),
  t("Sending to a list from the chat is part of Docustay Pro."),
  t("The plays and drafts API is part of Docustay Pro."),
  t("Installments and subscriptions are part of Docustay Pro. A one-time payment, a deposit and an amount the signer chooses are open on every plan."),
  t("Email isn't set up yet, so signers cannot be invited. Open Settings → Email, connect your email, send yourself a test, then try again."),
  // R8-72: the two sign-in refusals, exactly as src/http/app.mjs writes them
  t("You are signed out. Sign in again to continue."),
  t("Your session has ended. Sign in again to continue."),
];
let known = null;

const day = (iso, lang) => { try { return new Date(iso).toLocaleDateString(!lang || lang === "en" ? "en-US" : lang, { month: "long", day: "numeric", timeZone: "UTC" }); } catch { return ""; } };

/** The refusal in the reader's language, or the server's own words when this list does not know it. */
export function serverText(error, t, lang = "en") {
  const raw = error?.message ?? null, d = error?.detail ?? {};
  if (!raw) return raw;
  if (d.code === "plan_document_limit" && Number.isFinite(d.limit) && Number.isFinite(d.used)) {
    const plan = /^Your (.+?) plan allows/.exec(raw)?.[1] ?? "Free";
    return raw.includes("Upgrade to Pro")
      ? t("Your {plan} plan allows {limit} documents a month and you have sent {used}. Upgrade to Pro to send more.", { plan, limit: d.limit, used: d.used })
      : t("Your {plan} plan allows {limit} documents a month and you have sent {used}. The count resets next month.", { plan, limit: d.limit, used: d.used });
  }
  if (d.code === "plan_template_limit" && Number.isFinite(d.limit) && Number.isFinite(d.used) && d.resetsAt)
    return t("Your Free plan includes {limit} new templates a month and you have made {used}. You can still use and edit every template you have. New templates open again on {date}, or upgrade to Pro for unlimited templates.", { limit: d.limit, used: d.used, date: day(d.resetsAt, lang) });
  known ??= new Set(FIXED((s) => s));
  const lookUp = t;   // a sentence already in the catalogue (listed above), looked up by its English
  return known.has(raw) ? lookUp(raw) : raw;
}
