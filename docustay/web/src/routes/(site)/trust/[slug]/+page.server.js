import { error } from "@sveltejs/kit";
import { byPath, under } from "$lib/site/pages/registry.js";
import { CARDS } from "$lib/site/pages/templateList.js";
export const prerender = true;
export const entries = () => under("/trust").map((slug) => ({ slug }));
export const load = ({ params }) => { const page = byPath("/trust/" + params.slug); if (!page) error(404, "Not found"); return { page, templates: CARDS }; };
