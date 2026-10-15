import { FORMS, FORM_CATS, formCard, formBySlug } from "$lib/site/pages/formTemplates.js";
export const prerender = true;
export const load = () => ({ cards: FORMS.map(formCard), cats: FORM_CATS, sample: formBySlug("contact-and-inquiry") });
