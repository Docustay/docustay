import { error } from "@sveltejs/kit";
import { CARDS } from "$lib/site/pages/templateList.js";
import { byPath, under } from "$lib/site/pages/registry.js";
export const prerender = true;
export const entries = () => under("/self-host").map((slug) => ({ slug }));
export const load = ({ params }) => { const page = byPath("/self-host/" + params.slug); if (!page) throw error(404); return { page, templates: CARDS }; };
