import { SIGNPDF, bySlug } from "$lib/site/signpdf.js";
import { error } from "@sveltejs/kit";
export const prerender = true;
export const entries = () => SIGNPDF.map((s) => ({ lang: s.slug }));
export const load = ({ params }) => { const l = bySlug(params.lang); if (!l) error(404, "Not found"); return { l, others: SIGNPDF.filter((x) => x.slug !== l.slug).map(({ slug, name }) => ({ slug, name })) }; };
