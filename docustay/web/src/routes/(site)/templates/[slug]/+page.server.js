import { error } from "@sveltejs/kit";
import { FULL_TEMPLATES } from "$lib/site/starterFull.js";
import { TEMPLATES, byNew } from "$lib/site/pages/templates.js";
import { CARDS } from "$lib/site/pages/templateList.js";
import { USE_LABEL } from "$lib/site/pages/labels.js";
export const prerender = true;
export const entries = () => TEMPLATES.map((m) => ({ slug: m.slug }));
export const load = ({ params }) => {
  const m = byNew(params.slug); if (!m) error(404, "Not found");
  const t = FULL_TEMPLATES.find((x) => x.slug === m.old); if (!t) error(404, "Not found");
  const { text, fieldList, seats, pages, minutes, who, summary, note } = t;
  return { m, t: { text, fields: fieldList, seats, pages, minutes, who, summary, note, title: m.title }, use: USE_LABEL[m.use], related: CARDS.filter((c) => c.use === m.use && c.slug !== m.slug).slice(0, 3) };
};
