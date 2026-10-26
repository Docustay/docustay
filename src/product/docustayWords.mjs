// src/product/docustayWords.mjs — THE ONE SET OF PRICING WORDS (21 Oct 2026, PRICING-WORDS-SPEC.md). Pure: it imports only the price list. The Billing table, the upgrade sheet, the plan prompts,
// the website, the calculator, the docs and the copy-lint gate all read the glossary, the compare table and the cost example from here (the site gets a generated copy in prices.json).
// ONE SET OF WORDS: a TEAM MEMBER has a Docustay login (Owner, Admin or Member) and is the only person who ever costs money (Pay as you go, per month). A SIGNER is anyone you send a document to; free on every plan.
// Never "seat" (that word is for nothing now), never "user", and never "people" in a price. CONTACTS is the saved list of everyone you have sent to.
import { PRICES } from "./docustayPrices.mjs";

const usd = (minor) => (Number(minor) % 100 === 0 ? `$${Number(minor) / 100}` : `$${(Number(minor) / 100).toFixed(2)}`);

export const GLOSSARY = Object.freeze({
  teamMember: "A team member has a Docustay login (Owner, Admin or Member). Team members are the only people who ever cost money, and only on Pay as you go.",
  signer: "A signer is anyone you send a document to. They never need an account, and they are free on every plan.",
  contacts: "Contacts is the saved list of everyone you have sent to.",
  signingSpot: "A signing group lets several people share one signing spot: whoever signs first signs for everyone.",
  documentCounts: "A document counts when it is sent. Reminders and resends are free.",
});
export const PER_TEAM_MEMBER = "per team member a month";   // never the old per-person wording
export const FOOTNOTE = "A document counts when it is sent. Reminders and resends are free. Fair use applies to Unlimited.";

/** Pro's monthly price: one price for everyone. */
export const proMonthly = () => PRICES.pro.monthlyMinor;

/** What each plan costs a month for a team of `members` sending `docs` documents (drafts left out), from the price list. */
export function monthlyCost({ plan, members = 1, docs = 0 }) {
  if (plan === "free") return 0;
  if (plan === "payg") return members * PRICES.payg.personMonthlyMinor + Math.max(0, docs - PRICES.payg.docsIncluded) * PRICES.payg.docOverMinor;
  if (plan === "pro") return proMonthly();
  return null;
}

/** The cost-example line under the compare table, computed from the price list. Pro is the cheaper or equal choice from `members` team members (no documents beyond the included ones), or for one team member from `docs` documents. */
export function costExample({ members = 3, docs = 40 } = {}) {
  const pro = proMonthly();
  const payg = monthlyCost({ plan: "payg", members, docs });
  const fromMembers = Math.ceil(pro / PRICES.payg.personMonthlyMinor);
  const fromDocs = PRICES.payg.docsIncluded + Math.ceil(Math.max(0, pro - PRICES.payg.personMonthlyMinor) / PRICES.payg.docOverMinor);
  return {
    members, docs, paygMinor: payg, proMinor: pro, fromMembers, fromDocs,
    text: `A team of ${members} sending ${docs} documents a month: Pay as you go ${usd(payg)}, Pro ${usd(pro)}. Pro costs no more than Pay as you go from ${fromMembers} team members, or for one team member sending ${fromDocs} or more documents.`,
  };
}

/** The compare table, row by row, in the words of the spec. Every number comes from the price list. */
export function compareTable() {
  const F = PRICES.free, P = PRICES.payg, R = PRICES.pro, L = PRICES.lifetime;
  const proNow = proMonthly();
  const row = (key, label, free, payg, pro, lifetime, hint) => ({ key, label, hint: hint ?? null, cells: { free, payg, pro, lifetime } });
  return [
    row("price", "Price", "$0 always", `${usd(P.personMonthlyMinor)} ${PER_TEAM_MEMBER}`,
      `${usd(proNow)} a month`, `${usd(L.oneTimeMinor)} once, for any workspace`),
    row("team", "Team members", "1", `${usd(P.personMonthlyMinor)} each a month, no limit`, "Unlimited, included", "Unlimited, included", "People who sign in to send or manage"),
    row("signers", "Signers", `${F.signersPerMonth} a month`, "Unlimited, free", "Unlimited, free", "Unlimited, free", "People you send to"),
    row("documents", "Documents sent each month", String(F.docsIncluded), `${P.docsIncluded} included, then ${usd(P.docOverMinor)} each`, "Unlimited", "Unlimited"),
    row("ai", "AI drafts each month", String(F.draftsIncluded), `${P.draftsIncluded} included, then ${usd(P.draftOverMinor)} each`, `${R.draftsIncluded} included, then ${usd(R.draftOverMinor)} each`, `${L.draftsIncluded} included, then ${usd(L.draftOverMinor)} each`),
    row("templates", "New templates each month", String(F.templatesPerMonth), String(P.templatesPerMonth), "Unlimited", "Unlimited"),
    row("fee", "Docustay fee on payments you collect (Stripe's own fees apply)", `${F.feeBps / 100}%`, `${P.feeBps / 100}%`, `${R.feeBps / 100}%`, `${L.feeBps / 100}%`),
    row("plays", "Your own plays and playbooks", "No", "No", "Yes", "Yes"),
  ];
}

/** Sentences about the two meters, shared by the prompts, the emails and the docs. */
export const signerLimitText = (used = PRICES.free.signersPerMonth, limit = PRICES.free.signersPerMonth, resets = "") =>
  `Your Free plan lets you send to ${limit} different signers a month and you have sent to ${used}. Sending again to someone you already sent to this month is always allowed.${resets ? ` New signers open again on ${resets}, or choose Pay as you go or Pro for unlimited signers.` : " Choose Pay as you go or Pro for unlimited signers."}`;
export const templateLimitText = (planName, limit, used, resets = "") =>
  `Your ${planName} plan includes ${limit} new templates a month and you have made ${used}. You can still use and edit every template you have.${resets ? ` New templates open again on ${resets}, or upgrade to Pro for unlimited templates.` : " Upgrade to Pro for unlimited templates."}`;
export const GRANDFATHER_NOTICE = "New this month: Free now covers 15 different signers a month and Pay as you go 25 new templates a month. Both start on 1 November 2026, so nothing changes for your current month.";
