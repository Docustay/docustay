import { byPath } from "$lib/site/pages/registry.js";
export const prerender = true;
export const load = () => ({ page: byPath("/use-cases"), templates: [] });
