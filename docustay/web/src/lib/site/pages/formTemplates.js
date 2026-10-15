// The thirty form templates on the website (Run 7 part 3). Everything shown comes from forms.gen.json (scripts/build-forms.mjs, from src/documents/starters/forms.mjs): the sections,
// every field, who fills it, who counter-signs and the default Publish options. The words written here are only the page furniture.
import DATA from "../forms.gen.json" with { type: "json" };
export const FORM_CATS = Object.fromEntries(DATA.categories.map((c) => [c.id, c.label]));
export const FORMS = DATA.forms;
export const formBySlug = (s) => FORMS.find((f) => f.slug === s) ?? null;
export const formMeta = (f) => `A free ${f.title.toLowerCase()} form template. ${f.summary.replace(/\.$/, "")}. Publish it as one link; every response is its own signed copy.`.slice(0, 300);
export const formCard = (f) => ({ slug: f.slug, title: f.title, summary: f.summary, use: f.use, cat: FORM_CATS[f.use], fields: f.fieldCount, counterSign: f.counterSign });
/** The Publish defaults in words, in the order the Publish step shows them. */
export const publishWords = (p) => [
  p.verifyEmail ? "People confirm their email before they sign." : "People sign without an email check.",
  p.counterSign ? "Someone on your team counter-signs each response." : "The person's signature completes each response.",
  p.responseLimit ? `It closes after ${p.responseLimit} responses.` : "No limit on responses.",
  p.fillAgain ? "After signing, people can start another response." : "One response per visit.",
  p.notifyOwner ? "You get an email for every signed response." : "No email to you per response; they wait in Forms.",
  p.confirmRespondent ? "The person gets an email with their signed copy." : "No confirmation email to the person.",
];
