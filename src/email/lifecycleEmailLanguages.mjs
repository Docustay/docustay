// The four welcome-series emails (welcome, day 1, day 3, day 6) and their footer, in English and the 13 other languages. Pure data. {link} is the one button-link of each mail; {unsub} the one-click unsubscribe link;
// {address} the sender's postal address. Each mail has one idea and one link. Read once by the same reviewer pass as the other emails; the placeholder and brand checks are in test/launch_welcome_series.test.mjs.
export const WELCOME = {
  en: {
    steps: [
      { subject: "Welcome to Docustay", body: "Your workspace is ready. Upload a PDF, place the signature fields, and send it: the signer gets a link, and you get a sealed copy with a certificate. Free includes 15 documents, 15 different signers, 5 new templates and 10 AI drafts a month, and nothing is ever billed for going over.", cta: "Send your first document" },
      { subject: "Send your first document", body: "It takes about two minutes: upload a PDF, place the fields, say who signs, and send. Nothing is charged and the signer needs no account.", cta: "Send a document" },
      { subject: "Save a document you send often", body: "If you send the same document again and again, save it as a template. Next time it is one click: the fields and the wording are already there.", cta: "Open templates" },
      { subject: "Invite a teammate", body: "A teammate can send and track documents with you, so nothing waits on one person. Add them by email; they sign in with a code.", cta: "Invite a teammate" },
    ],
    foot: { why: "You get this because you created a Docustay account. It is one of four short emails in your first week.", unsub: "Stop these emails", settings: "Or turn them off in Settings, Account." },
  },
};
/** The words for one step (0 welcome, 1/2/3) in a language, English when the language has none. Returns { subject, body, cta, foot }. */
export function welcomeWords(lang, step) {
  const base = String(lang ?? "en").toLowerCase().split("-")[0];
  const l = WELCOME[base] ?? WELCOME.en;
  const s = l.steps[step] ?? WELCOME.en.steps[step];
  return { ...s, foot: l.foot };
}
