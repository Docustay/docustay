// DOCUSTAY'S OWN EMAILS about the person's account and money (13 Oct 2026, after the $1 live test): Pro started, a cancellation scheduled, Pro resumed, Pro ended, a payment that failed.
// They are Docustay's, never the organisation's: the white paper frame, the final wordmark, one violet button, the postal address, a plain-text twin, a preheader, and dark-mode safe colours.
// (Mail sent to SIGNERS on an organisation's behalf is a different thing and keeps the organisation's brand "via Docustay".) Pure: returns { subject, text, html }.

import { billingWords } from "./docustayBillingLanguages.mjs";

const SITE = () => (process.env.DOCUSTAY_PUBLIC_URL || "https://docustay.app").replace(/\/+$/, "");
const APP = () => (process.env.KEYSTONE_DOCUSTAY_APP_URL || "https://app.docustay.app").replace(/\/+$/, "");
const POSTAL = () => process.env.DOCUSTAY_POSTAL_ADDRESS || "";
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const LOCALE = { en: "en-US", es: "es", fr: "fr", de: "de", pt: "pt-BR", it: "it", nl: "nl", pl: "pl", tr: "tr", ru: "ru", ar: "ar", ja: "ja", zh: "zh-CN", ko: "ko" };
const money = (minor, currency, lang = "en") => { try { return new Intl.NumberFormat(LOCALE[lang] ?? "en-US", { style: "currency", currency: String(currency || "usd").toUpperCase() }).format(Number(minor) / 100); } catch { return `${(Number(minor) / 100).toFixed(2)}`; } };
const longDate = (iso, lang = "en") => { const d = iso ? new Date(iso) : null; return d && Number.isFinite(d.getTime()) ? d.toLocaleDateString(LOCALE[lang] ?? "en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" }) : null; };
// A sign-up names the person "<email name>'s workspace" until they choose one; that is not a name to greet, so such a value greets nobody by name.
const first = (name) => { if (/workspace\s*$/i.test(String(name ?? ""))) return null; const n = String(name ?? "").trim().split(/\s+/)[0]; return n && !/@/.test(n) ? n : null; };

/** The frame every Docustay account email wears. `rows` is [[label, value]] shown as a quiet table; `button` is { label, url }; `fine` is small print under the button. */
export function docustayFrame({ preheader, heading, intro = [], code = null, rows = [], button = null, after = [], fine = null, lang = "en", footer = "You are getting this because it is about your Docustay account." }) {
  const rtl = lang === "ar", dirAttr = rtl ? ' dir="rtl"' : "";
  const text = [heading, "", ...intro, ...(code ? ["", code] : []), ...(rows.length ? ["", ...rows.map(([k, v]) => `${k}: ${v}`)] : []), ...(button ? ["", `${button.label}: ${button.url}`] : []), ...(after.length ? ["", ...after] : []), ...(fine ? ["", fine] : []), "", "— Docustay", POSTAL()].filter((x, i, a) => !(x === "" && a[i - 1] === "")).join("\n").trim();
  const p = (t) => `<p class="dst" style="margin:0 0 14px;font-size:16px;line-height:1.55;color:#1b1b1b">${esc(t)}</p>`;
  const html = `<!doctype html><html lang="${esc(lang)}"${dirAttr}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark">
<style>@media (prefers-color-scheme: dark){.dsbg{background:#0f0f14!important}.dscard{background:#17171f!important;border-color:#2a2a36!important}.dst{color:#f3f2fa!important}.dsm{color:#a8a6bd!important}.dsrow td{border-color:#2a2a36!important}}</style></head>
<body style="margin:0;padding:0;background:#f4f3f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif" class="dsbg"><span style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${esc(preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="dsbg" style="background:#f4f3f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"><tr><td align="center" style="padding:28px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px"><tr><td style="padding:0 4px 16px"><a href="${esc(SITE())}"><img src="${esc(SITE())}/brand/docustay-wordmark-violet.png" alt="Docustay" height="26" style="height:26px;width:auto;display:block;border:0"></a></td></tr>
<tr><td class="dscard" style="background:#ffffff;border:1px solid #e6e4ef;border-radius:14px;padding:28px 28px 24px">
<h1 class="dst" style="margin:0 0 14px;font-size:22px;line-height:1.3;color:#1b1b1b;font-weight:650">${esc(heading)}</h1>
${intro.map(p).join("")}
${code ? `<p class="dst" style="margin:4px 0 20px;font-size:34px;letter-spacing:8px;font-weight:700;font-family:ui-monospace,Menlo,Consolas,monospace;color:#1b1b1b;background:#f4f3f8;border-radius:10px;padding:14px 18px;display:inline-block">${esc(code)}</p>` : ""}
${rows.length ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0 18px;border-collapse:collapse">${rows.map(([k, v]) => `<tr class="dsrow"><td class="dsm" style="padding:8px 0;border-top:1px solid #ece9f5;color:#5b5873;font-size:14px;width:42%">${esc(k)}</td><td class="dst" style="padding:8px 0;border-top:1px solid #ece9f5;font-size:15px;color:#1b1b1b;font-weight:600">${esc(v)}</td></tr>`).join("")}</table>` : ""}
${button ? `<p style="margin:6px 0 20px"><a href="${esc(button.url)}" style="display:inline-block;background:#5a3ac1;color:#ffffff;text-decoration:none;font-weight:600;font-size:16px;padding:13px 22px;border-radius:10px">${esc(button.label)}</a></p>` : ""}
${after.map(p).join("")}
${fine ? `<p class="dsm" style="margin:6px 0 0;font-size:13px;line-height:1.5;color:#5b5873">${esc(fine)}</p>` : ""}
</td></tr>
<tr><td class="dsm" style="padding:16px 8px 0;font-size:12px;line-height:1.5;color:#7a7794">Docustay${POSTAL() ? ` · ${esc(POSTAL())}` : ""}<br>${esc(footer)}</td></tr></table>
</td></tr></table></body></html>`;
  return { text, html };
}

const billingUrl = () => `${APP()}/billing`;

/** change: pro_started | cancel_scheduled | resumed | pro_ended | renewal_reminder | payment_failed. `facts` comes from the event: { amountMinor, currency, interval, periodEnd, cancelAt, founders }. `lang` is the person's language (English when Docustay has no words for it).
 *  → { subject, text, html } or null for a change that needs no email. */
export function billingEmail(change, { name = null, facts = {}, lang = "en" } = {}) {
  const w = billingWords(lang, facts.planKey), L = w.lang;
  const hi = first(name) ? w("hi", { name: first(name) }) : w("hiNoName");
  const amount = facts.amountMinor != null ? `${money(facts.amountMinor, facts.currency, L)} ${facts.interval === "year" ? w("perYear") : w("perMonth")}` : null;
  const amountOnly = facts.amountMinor != null ? money(facts.amountMinor, facts.currency, L) : null;
  const next = longDate(facts.periodEnd, L), until = longDate(facts.cancelAt ?? facts.periodEnd, L);
  const frame = (o) => docustayFrame({ lang: L, footer: w("footer"), ...o });
  if (change === "pro_started") {
    const f = frame({
      preheader: w("startedPre"), heading: w("startedH"), intro: [hi, w("startedI")],
      rows: [[w("plan"), facts.founders ? w("planProFounders") : w("planPro")], ...(amount ? [[w("price"), amount]] : []), ...(next ? [[w("nextPayment"), next]] : [])],
      button: { label: w("openBilling"), url: billingUrl() }, after: [w("startedAfter")], fine: w("startedFine"),
    });
    return { subject: w("startedSub"), ...f };
  }
  if (change === "cancel_scheduled") {
    const f = frame({
      preheader: until ? w("cancelPreDate", { date: until }) : w("cancelPre"), heading: w("cancelH"),
      intro: [hi, until ? w("cancelIDate", { date: until }) : w("cancelI"), w("cancelI2"), w("cancelI3")],
      ...(facts.founders ? { after: [w("cancelFounders")] } : {}),
      button: { label: w("resumePro"), url: billingUrl() }, fine: w("cancelFine"),
    });
    return { subject: until ? w("cancelSubDate", { date: until }) : w("cancelSub"), ...f };
  }
  if (change === "resumed") {
    const f = frame({
      preheader: w("resumedPre"), heading: w("resumedH"), intro: [hi, w("resumedI")],
      rows: [...(next ? [[w("nextPayment"), next]] : []), ...(amount ? [[w("price"), amount]] : [])],
      button: { label: w("openBilling"), url: billingUrl() },
    });
    return { subject: w("resumedSub"), ...f };
  }
  if (change === "pro_ended") {
    const f = frame({ preheader: w("endedPre"), heading: w("endedH"), intro: [hi, w("endedI")], button: { label: w("startAgain"), url: billingUrl() }, fine: w("endedFine") });
    return { subject: w("endedSub"), ...f };
  }
  if (change === "renewal_reminder") {
    const f = frame({
      preheader: next ? w("renewPreDate", { date: next }) : w("renewPre"), heading: w("renewH"),
      intro: [hi, next ? w("renewIDate", { date: next }) : w("renewI"), ...(amountOnly ? [w("renewIAmount", { amount: amountOnly })] : [])],
      rows: [[w("plan"), w("planProYearly")], ...(amount ? [[w("price"), amount]] : []), ...(next ? [[w("renewsOn"), next]] : [])],
      button: { label: w("manageBilling"), url: billingUrl() }, fine: w("renewFine"),
    });
    return { subject: next ? w("renewSubDate", { date: next }) : w("renewSub"), ...f };
  }
  if (change === "payment_failed") {
    const f = frame({ preheader: w("failedPre"), heading: w("failedH"), intro: [hi, w("failedI")], button: { label: w("updateCard"), url: billingUrl() }, fine: w("failedFine") });
    return { subject: w("failedSub"), ...f };
  }
  return null;
}

/** The receipt for one paid Pro invoice (renewals; the first payment's receipt is inside the "Welcome to Docustay Pro" email). `invoice` is Stripe's invoice object. */
export function receiptEmail({ name = null, invoice, ours = null, lang = "en", planKey = null }) {
  const w = billingWords(lang, planKey), L = w.lang;
  const hi = first(name) ? w("hi", { name: first(name) }) : w("hiNoName");
  const amount = money(invoice.amount_paid, invoice.currency, L);
  const per = invoice.lines?.data?.[0]?.period;
  const dd = (sec) => (sec ? longDate(new Date(Number(sec) * 1000).toISOString(), L) : null);
  const covers = per && dd(per.start) && dd(per.end) ? L === "en" ? `${dd(per.start)} to ${dd(per.end)}` : `${dd(per.start)} – ${dd(per.end)}` : null;
  const f = docustayFrame({
    lang: L, footer: w("footer"), preheader: w("receiptPre", { amount }), heading: w("receiptH"), intro: [hi, w("receiptI", { amount })],
    rows: [[w("plan"), w("planPro")], [w("amountPaid"), amount], ...(dd(invoice.status_transitions?.paid_at ?? invoice.created) ? [[w("paidOn"), dd(invoice.status_transitions?.paid_at ?? invoice.created)]] : []), ...(covers ? [[w("covers"), covers]] : []), ...((ours ?? invoice.number) ? [[w("invoiceNumber"), ours ?? invoice.number]] : [])],
    button: { label: w("viewInvoice"), url: billingUrl() }, fine: w("receiptFine"),
  });
  return { subject: w("receiptSub", { amount }), ...f };
}

/** In-app bell words for a plan change (the browser translates these). */
export const planNoticeTitle = (change, planKey = null) => planKey === "docustay_payg" ? ({
  pro_started: "Welcome to Docustay Pay as you go",
  cancel_scheduled: "Your Pay as you go plan is cancelled. It stays on until the end of what you paid for.",
  resumed: "Pay as you go is back on. Nothing changes.",
  pro_ended: "Your Pay as you go plan has ended. Your workspace is on Free.",
  payment_failed: "Your last payment did not go through.",
}[change] ?? "Your Docustay plan was updated.") : ({
  pro_started: "Welcome to Docustay Pro",
  cancel_scheduled: "Your Pro plan is cancelled. Pro stays on until the end of what you paid for.",
  resumed: "Pro is back on. Nothing changes.",
  pro_ended: "Your Pro plan has ended. Your workspace is on Free.",
  payment_failed: "Your last payment did not go through.",
}[change] ?? "Your Docustay plan was updated.");
