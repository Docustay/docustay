import { CARDS } from "$lib/site/pages/templateList.js";
import { FORMS, FORM_CATS, formCard } from "$lib/site/pages/formTemplates.js";
export const prerender = true;
export const load = () => ({ docs: CARDS, forms: FORMS.map(formCard), formCats: FORM_CATS });
