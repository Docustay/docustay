// Docustay's own billing and account emails, in English (the 13 other languages were removed in Docustay v1, 17 Oct 2026). Pure data: no imports. Placeholders: {name} {date} {amount} are filled in by docustayBilling.mjs.
// The terms for Billing, Plan, Next payment and Resume Pro are the SAME words the app's own screens use (docustay/web/i18n/translations), so an email and the page it points to agree.
// Every language must carry every key (test/docustay_billing_languages.test.mjs): English is the fallback for a language Docustay does not have words for, never for a missing key.
export const BILLING_LANGS = ["en"];
export const BILLING_KEYS = ["hi", "hiNoName", "plan", "price", "nextPayment", "renewsOn", "amountPaid", "paidOn", "covers", "invoiceNumber", "planPro", "planProYearly", "perMonth", "perYear",
  "openBilling", "resumePro", "startAgain", "manageBilling", "updateCard", "viewInvoice", "footer",
  "startedSub", "startedPre", "startedH", "startedI", "startedAfter", "startedFine",
  "cancelPreDate", "cancelPre", "cancelH", "cancelIDate", "cancelI", "cancelI2", "cancelI3", "cancelFine", "cancelSubDate", "cancelSub",
  "resumedPre", "resumedH", "resumedI", "resumedSub",
  "endedPre", "endedH", "endedI", "endedFine", "endedSub",
  "renewPreDate", "renewPre", "renewH", "renewIDate", "renewI", "renewIAmount", "renewFine", "renewSubDate", "renewSub",
  "failedPre", "failedH", "failedI", "failedFine", "failedSub",
  "receiptPre", "receiptH", "receiptI", "receiptFine", "receiptSub", "planPrice", "creditApplied"];

export const BILLING = {
  en: {
    hi: "Hi {name},", hiNoName: "Hi,", plan: "Plan", price: "Price", nextPayment: "Next payment", renewsOn: "Renews on", amountPaid: "Amount paid", planPrice: "Plan price", creditApplied: "Credit from your earlier plan", paidOn: "Paid on", covers: "Covers", invoiceNumber: "Invoice number",
    planPro: "Docustay Pro", planProYearly: "Docustay Pro (yearly)", perMonth: "a month", perYear: "a year",
    openBilling: "Open Billing", resumePro: "Resume Pro", startAgain: "Start Pro again", manageBilling: "Manage or cancel in Billing", updateCard: "Update payment method", viewInvoice: "View invoice in Billing",
    footer: "You are getting this because it is about your Docustay account.",
    startedSub: "Welcome to Docustay Pro", startedPre: "Everything in Pro is switched on. Here is what you can do first.", startedH: "Welcome to Docustay Pro",
    startedI: "Your payment went through and Pro is on. Pro has unlimited documents and templates, 100 AI drafts a month, 100 MB uploads, no fee on payments and your own plays, all ready now.",
    startedAfter: "Three good first steps: send a document in bulk, turn on automatic reminders in Settings, and add a teammate. Your receipt and invoices are always in Billing.",
    startedFine: "You can cancel any time in Billing. Pro then stays on until the date you have paid for. Docustay does not give refunds.",
    cancelPreDate: "Pro stays on until {date}. You will not be charged again.", cancelPre: "Your Pro plan is cancelled. You will not be charged again.", cancelH: "Your Docustay Pro plan is cancelled",
    cancelIDate: "Pro stays on until {date}. After that your workspace moves to the Free plan and you will not be charged again.", cancelI: "You will not be charged again.",
    cancelI2: "Documents already sent still finish, signing links keep working, and signed copies stay downloadable. Extra team members become read-only.",
    cancelI3: "Docustay does not give refunds, so the period you paid for stays on in full.",
    cancelFine: "Changed your mind? Resume Pro any time before that date and nothing changes.", cancelSubDate: "Docustay Pro ends on {date}", cancelSub: "Your Docustay Pro plan is cancelled",
    resumedPre: "Pro carries on as it was.", resumedH: "Pro is back on", resumedI: "You resumed Docustay Pro. Nothing changes: your plan carries on and renews as before.", resumedSub: "Your Docustay Pro plan carries on",
    endedPre: "Your workspace is on the Free plan. Nothing was deleted.", endedH: "Your Docustay Pro plan has ended",
    endedI: "Your workspace is now on the Free plan. Nothing was deleted: documents already sent finish, signing links keep working, signed copies stay downloadable, and extra team members are read-only.",
    endedFine: "Thank you for using Docustay Pro.", endedSub: "Your Docustay Pro plan has ended",
    renewPreDate: "Your yearly plan renews on {date}.", renewPre: "Your yearly plan renews soon.", renewH: "Your Docustay Pro plan renews soon", renewIDate: "Your yearly Docustay Pro plan renews on {date}.", renewI: "Your yearly Docustay Pro plan renews soon.",
    renewIAmount: "You will be charged {amount} unless you cancel before then.",
    renewFine: "To cancel, open Billing and choose Cancel Pro. It takes one step and you do not need to contact anyone. Pro then stays on until the renewal date.", renewSubDate: "Your Docustay Pro plan renews on {date}", renewSub: "Your Docustay Pro plan renews soon",
    failedPre: "Please update your card so Pro carries on.", failedH: "Your last Docustay payment didn't go through",
    failedI: "We could not take your last payment for Docustay Pro. Please update your payment method so your plan carries on without interruption.",
    failedFine: "We will try again. If it keeps failing, your workspace moves to the Free plan; nothing is deleted.", failedSub: "Your last Docustay payment didn't go through",
    receiptPre: "Receipt for {amount}, Docustay Pro.", receiptH: "Your Docustay receipt", receiptI: "Thank you. Your payment of {amount} for Docustay Pro went through.",
    receiptFine: "Your invoices and PDF copies are always in Billing.", receiptSub: "Your Docustay Pro receipt — {amount}",
  },
};

/** Pay as you go wording (English): the same emails, with the plan named for what it is. Any key not listed here keeps the Pro words. */
export const PAYG_EN = {
  planPro: "Docustay Pay as you go", resumePro: "Resume Pay as you go", startAgain: "Start Pay as you go again",
  startedSub: "Welcome to Docustay Pay as you go", startedPre: "Pay as you go is on. Here is what you can do first.", startedH: "Welcome to Docustay Pay as you go",
  startedI: "Your payment went through and Pay as you go is on. Your first 15 documents and 10 AI drafts each month are included; after that each document costs $0.50 and each draft $0.30. You can set a monthly budget in Billing.",
  startedAfter: "Three good first steps: send your first document, set a monthly budget in Billing, and add a teammate. Your receipt and invoices are always in Billing.",
  startedFine: "You can cancel any time in Billing. Pay as you go then stays on until the date you have paid for. Docustay does not give refunds.",
  cancelPreDate: "Pay as you go stays on until {date}. You will not be charged again.", cancelPre: "Your Pay as you go plan is cancelled. You will not be charged again.", cancelH: "Your Docustay Pay as you go plan is cancelled",
  cancelIDate: "Pay as you go stays on until {date}. After that your workspace moves to the Free plan and you will not be charged again.",
  cancelFine: "Changed your mind? Resume Pay as you go any time before that date and nothing changes.", cancelSubDate: "Docustay Pay as you go ends on {date}", cancelSub: "Your Docustay Pay as you go plan is cancelled",
  resumedPre: "Pay as you go carries on as it was.", resumedH: "Pay as you go is back on", resumedI: "You resumed Docustay Pay as you go. Nothing changes: your plan carries on and renews as before.", resumedSub: "Your Docustay Pay as you go plan carries on",
  endedH: "Your Docustay Pay as you go plan has ended", endedFine: "Thank you for using Docustay Pay as you go.", endedSub: "Your Docustay Pay as you go plan has ended",
  failedPre: "Please update your card so Pay as you go carries on.", failedI: "We could not take your last payment for Docustay Pay as you go. Please update your payment method so your plan carries on without interruption.",
  receiptPre: "Receipt for {amount}, Docustay Pay as you go.", receiptI: "Thank you. Your payment of {amount} for Docustay Pay as you go went through.", receiptSub: "Your Docustay Pay as you go receipt — {amount}",
};

const fill = (s, v) => String(s).replace(/\{(name|date|amount)\}/g, (_, k) => String(v?.[k] ?? ""));
/** The words for a language (English for a language Docustay has no words for). `w(key, vars)` fills the placeholders. */
export function billingWords(lang, planKey = null) {
  const table = BILLING[BILLING_LANGS.includes(lang) ? lang : "en"];
  const payg = planKey === "docustay_payg" ? PAYG_EN : null;
  const w = (key, vars) => fill(payg?.[key] ?? table[key] ?? BILLING.en[key] ?? key, vars);
  w.lang = BILLING_LANGS.includes(lang) ? lang : "en";
  return w;
}
