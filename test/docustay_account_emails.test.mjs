// Part 4 (14 Oct 2026): the account-deletion emails exist in all 14 languages with every key, every placeholder survives, one button where one is wanted, plain-text twin, RTL for Arabic.
// PROPERTY: for every language and every kind the email has a subject, text and html, no unfilled {placeholder}, and the date/name appear; a missing key in any language fails.
import { accountEmail } from "../src/email/docustayAccountEmails.mjs";
import { ACCOUNT, ACCOUNT_KEYS } from "../src/email/docustayAccountLanguages.mjs";
import { BILLING_LANGS } from "../src/email/docustayBillingLanguages.mjs";
let pass = 0, fail = 0;
const t = (n, f) => { try { f(); console.log("  ok", n); pass++; } catch (e) { console.log("  FAIL", n, "-", e.message); fail++; } };
const must = (c, m) => { if (!c) throw new Error(m); };
const kinds = ["account_scheduled", "workspace_scheduled", "kept_account", "kept_workspace", "reminder_account", "reminder_workspace", "account_done"];
t("every language carries every key", () => { for (const l of BILLING_LANGS) for (const k of ACCOUNT_KEYS) must(typeof ACCOUNT[l]?.[k] === "string" && ACCOUNT[l][k].length > 1, `${l}.${k}`); });
t("each language keeps the same placeholders as English", () => { for (const l of BILLING_LANGS) for (const k of ACCOUNT_KEYS) { const a = (ACCOUNT.en[k].match(/\{\w+\}/g) ?? []).sort().join(), b = (ACCOUNT[l][k].match(/\{\w+\}/g) ?? []).sort().join(); must(a === b, `${l}.${k}: ${a} vs ${b}`); } });
t("all kinds x all languages render with no leftover placeholder", () => { for (const l of BILLING_LANGS) for (const k of kinds) { const e = accountEmail(k, { lang: l, facts: { date: "2026-11-01", name: "Acme" } }); must(e.subject && e.text && e.html, `${l}/${k}`); must(!/\{\w+\}/.test(e.subject + e.text + e.html), `${l}/${k} leftover`); } });
t("the date and workspace name appear (positive control for the placeholder test)", () => { const e = accountEmail("workspace_scheduled", { lang: "de", facts: { date: "2026-11-01", name: "Acme" } }); must(e.subject.includes("Acme") && e.text.includes("2026-11-01"), e.subject); });
t("scheduled emails carry the Keep button; immediate ones do not; Arabic is RTL; unknown language falls back to English", () => {
  must(/settings\?tab=data/.test(accountEmail("account_scheduled", { facts: { date: "x" } }).html), "button");
  must(!/settings\?tab=data/.test(accountEmail("account_scheduled", { facts: { immediate: true } }).html), "no button when immediate");
  must(/dir="rtl"/.test(accountEmail("account_done", { lang: "ar" }).html), "rtl");
  must(accountEmail("account_done", { lang: "xx" }).subject === ACCOUNT.en.doneSub, "fallback");
});
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
