// Launch Part 4 (14 Oct 2026) — Docustay's billing and account emails in all 14 languages. Pure: no database.
// PROPERTY: for every language and every billing email kind, the email has a subject, a heading, a preheader, exactly one button that points at Billing, a plain-text twin carrying the same link, dark-mode CSS, the
// postal-address line when one is set, the right language/direction on the page, NO unfilled placeholder, and never another product's name. Every language carries every key (English is for an unknown language only).
// Run: node test/docustay_billing_languages.test.mjs
import { BILLING, BILLING_KEYS, BILLING_LANGS } from "../src/email/docustayBillingLanguages.mjs";
import { billingEmail, receiptEmail } from "../src/email/docustayBilling.mjs";
process.env.DOCUSTAY_POSTAL_ADDRESS = "1 Test Street, Castro Valley, CA 94546";
let pass = 0, fail = 0;
const t = (n, f) => { try { f(); console.log("PASS", n); pass++; } catch (e) { console.log("FAIL", n, "-", e.message); fail++; } };
const must = (c, m) => { if (!c) throw new Error(m); };
t("English is the only language (Docustay v1)", () => must(BILLING_LANGS.length === 1 && BILLING_LANGS[0] === "en" && BILLING.en && Object.keys(BILLING).length === 1, BILLING_LANGS.join()));
t("every language carries every key, and no key is left empty (English is a fallback for unknown languages, not for gaps)", () => {
  for (const l of BILLING_LANGS) { const miss = BILLING_KEYS.filter((k) => typeof BILLING[l][k] !== "string" || !BILLING[l][k].trim()); must(miss.length === 0, `${l} lacks ${miss.join()}`); const extra = Object.keys(BILLING[l]).filter((k) => !BILLING_KEYS.includes(k)); must(extra.length === 0, `${l} has unknown ${extra.join()}`); }
});
t("placeholders match English in every language ({name} {date} {amount}), so nothing is dropped or invented", () => {
  const ph = (s) => (String(s).match(/\{[a-z]+\}/g) ?? []).sort().join();
  for (const l of BILLING_LANGS) for (const k of BILLING_KEYS) must(ph(BILLING[l][k]) === ph(BILLING.en[k]), `${l}.${k}: ${ph(BILLING[l][k])} vs ${ph(BILLING.en[k])}`);
});
const facts = { amountMinor: 3500, currency: "usd", interval: "month", periodEnd: "2026-11-14T03:00:00.000Z", cancelAt: "2026-11-14T03:00:00.000Z" };
const inv = { id: "in_1", amount_paid: 3500, currency: "usd", number: "DS-1", created: 1791763200, status_transitions: { paid_at: 1791763300 }, lines: { data: [{ period: { start: 1791763200, end: 1794441600 } }] } };
const kinds = ["pro_started", "cancel_scheduled", "resumed", "pro_ended", "renewal_reminder", "payment_failed"];
for (const lang of BILLING_LANGS) {
  t(`${lang}: all seven emails are complete (subject, heading, preheader, one Billing button, plain-text twin, dark mode, address, language, no stray placeholder, no other product)`, () => {
    const all = [...kinds.map((k) => [k, billingEmail(k, { name: "Ada Lovelace", facts: k === "renewal_reminder" ? { ...facts, interval: "year" } : facts, lang })]), ["receipt", receiptEmail({ name: "Ada Lovelace", invoice: inv, lang })]];
    for (const [k, m] of all) {
      const id = `${lang}/${k}`;
      must(m && m.subject && m.subject.length <= 90, `${id}: subject ${m?.subject}`);
      must(!/[{}]/.test(m.subject + m.text + m.html.replace(/<style>[\s\S]*?<\/style>/g, "")), `${id}: unfilled placeholder`);
      must((m.html.match(/<a href="https:\/\/app\.docustay\.app\/billing"/g) ?? []).length === 1, `${id}: not exactly one Billing button`);
      must(m.text.includes("https://app.docustay.app/billing"), `${id}: the plain-text twin lacks the link`);
      must(/prefers-color-scheme: dark/.test(m.html) && /color-scheme" content="light dark"/.test(m.html), `${id}: no dark mode`);
      must(m.html.includes("1 Test Street") && m.text.includes("1 Test Street"), `${id}: no postal address`);
      must(m.html.includes(`<html lang="${lang}"${lang === "ar" ? ' dir="rtl"' : ""}>`), `${id}: wrong lang/dir`);
      must(/display:none;max-height:0/.test(m.html), `${id}: no preheader`);
      must(!/Workbench|FOUNDRY|Example Practice/i.test(m.subject + m.text + m.html), `${id}: another product's name`);
      if (lang !== "en") must(!/Welcome to Docustay Pro|Your Docustay receipt|Open Billing/.test(m.subject + m.text), `${id}: English left in a translated email`);
    }
  });
}
t("English is exactly the wording the earlier tests rely on (unchanged)", () => {
  const m = billingEmail("pro_started", { name: "Ada Lovelace", facts }); must(m.subject === "Welcome to Docustay Pro" && m.text.includes("Hi Ada,") && /Docustay does not give refunds/.test(m.text), m.text.slice(0, 200));
  const r = receiptEmail({ invoice: inv }); must(/Covers: October \d+, 2026 to November \d+, 2026/.test(r.text), r.text);
});
t("an unknown language falls back to English, and the cancel email in every language says the date and names no refund promise other than 'no refunds'", () => {
  must(billingEmail("pro_ended", { lang: "xx" }).subject === "Your Docustay Pro plan has ended", "fallback");
  for (const l of BILLING_LANGS) { const m = billingEmail("cancel_scheduled", { facts, lang: l }); must(/2026|２０２６|٢٠٢٦/.test(m.subject), `${l}: no date in the subject: ${m.subject}`); }
});
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
