import { error } from "@sveltejs/kit";
import { byPath, under } from "$lib/site/pages/registry.js";
import { CARDS } from "$lib/site/pages/templateList.js";
import FIELDS from "$lib/site/starter-fields.json";
export const prerender = true;
export const entries = () => under("/use-cases").map((slug) => ({ slug }));
// Runs at build time only: the real field positions go to the page only for the templates its "real first page" sections show, so no page downloads the other twenty-odd.
export const load = ({ params }) => {
  const page = byPath("/use-cases/" + params.slug); if (!page) error(404, "Not found");
  const want = new Set(page.blocks.filter((b) => b.t === "docfields").map((b) => b.slug));
  return { page, templates: CARDS.map((c) => (want.has(c.slug) && FIELDS[c.starter] ? { ...c, fields: FIELDS[c.starter] } : c)) };
};
