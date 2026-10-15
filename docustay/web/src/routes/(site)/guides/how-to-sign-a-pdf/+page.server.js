import { byPath } from "$lib/site/pages/registry.js";
export const prerender = true;
export const load = () => ({ page: byPath("/guides/how-to-sign-a-pdf"), templates: [] });
