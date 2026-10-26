import { SIGNPDF } from "$lib/site/signpdf.js";
export const prerender = true;
export const load = () => ({ langs: SIGNPDF.map(({ slug, name }) => ({ slug, name })) });
