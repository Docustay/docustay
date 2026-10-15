import { CARDS } from "$lib/site/pages/templateList.js";
export const prerender = true;
export const load = () => ({ cards: CARDS });
