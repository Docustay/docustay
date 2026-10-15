// Docustay's account-deletion emails (scheduled, kept, reminder, done) in the recipient's language, in the Docustay frame with one button and a plain-text twin. Pure: returns { subject, text, html }.
import { docustayFrame } from "./docustayBilling.mjs";
import { billingWords, BILLING_LANGS } from "./docustayBillingLanguages.mjs";
import { ACCOUNT } from "./docustayAccountLanguages.mjs";

const APP = () => (process.env.KEYSTONE_DOCUSTAY_APP_URL || "https://app.docustay.app").replace(/\/+$/, "");
const fill = (s, v = {}) => String(s).replace(/\{(\w+)\}/g, (_, k) => (v[k] ?? `{${k}}`));
const words = (lang) => { const L = BILLING_LANGS.includes(lang) ? lang : "en"; const t = ACCOUNT[L]; const w = (k, v) => fill(t[k] ?? ACCOUNT.en[k] ?? k, v); w.lang = L; return w; };
const keepUrl = () => `${APP()}/settings?tab=data`;

/** kind: account_scheduled | workspace_scheduled | kept_account | kept_workspace | reminder_account | reminder_workspace | account_done. facts: { date, name, immediate } */
export function accountEmail(kind, { facts = {}, lang = "en" } = {}) {
  const w = words(lang), L = w.lang, footer = billingWords(L)("footer");
  const frame = (o) => { const f = docustayFrame({ lang: L, footer, ...o }); return { subject: o.subject, ...f }; };
  const v = { date: facts.date ?? "", name: facts.name ?? "" };
  switch (kind) {
    case "account_scheduled": {
      const when = facts.immediate ? w("accSoon") : w("accWhen", v);
      return frame({ subject: w("accSub"), preheader: w("accSub"), heading: w("accSub"), intro: [w("accI"), when, w("keptAcc"), w("accNotYou")], button: facts.immediate ? null : { label: w("btnKeepAcc"), url: keepUrl() } });
    }
    case "workspace_scheduled": {
      const when = facts.immediate ? w("accSoon") : w("wsWhen", v);
      return frame({ subject: w("wsSub", v), preheader: w("wsSub", v), heading: w("wsSub", v), intro: [w("wsI", v), when, w("keptWs"), w("wsNotExpected")], button: facts.immediate ? null : { label: w("btnKeepWs"), url: keepUrl() } });
    }
    case "kept_account": return frame({ subject: w("keptAccSub"), preheader: w("keptAccSub"), heading: w("keptAccSub"), intro: [w("keptAccBody")] });
    case "kept_workspace": return frame({ subject: w("keptWsSub"), preheader: w("keptWsSub"), heading: w("keptWsSub"), intro: [w("keptWsBody")] });
    case "reminder_account": return frame({ subject: w("remAccSub", v), preheader: w("remAccSub", v), heading: w("remAccSub", v), intro: [w("remAccI", v), w("remBody")], button: { label: w("btnKeep"), url: keepUrl() } });
    case "reminder_workspace": return frame({ subject: w("remWsSub", v), preheader: w("remWsSub", v), heading: w("remWsSub", v), intro: [w("remWsI", v), w("remBody")], button: { label: w("btnKeep"), url: keepUrl() } });
    case "account_done": return frame({ subject: w("doneSub"), preheader: w("doneSub"), heading: w("doneSub"), intro: [w("doneI"), w("keptAcc")] });
    default: return null;
  }
}
