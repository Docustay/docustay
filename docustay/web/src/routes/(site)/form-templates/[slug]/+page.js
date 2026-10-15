import { error } from "@sveltejs/kit";
import { FORMS, FORM_CATS, formBySlug, formCard, formMeta, publishWords } from "$lib/site/pages/formTemplates.js";
export const prerender = true;
export const entries = () => FORMS.map((f) => ({ slug: f.slug }));
export const load = ({ params }) => {
  const f = formBySlug(params.slug); if (!f) error(404, "Not found");
  return { f, meta: formMeta(f), cat: FORM_CATS[f.use], publish: publishWords(f.publish), related: FORMS.filter((x) => x.use === f.use && x.slug !== f.slug).slice(0, 3).map(formCard) };
};
