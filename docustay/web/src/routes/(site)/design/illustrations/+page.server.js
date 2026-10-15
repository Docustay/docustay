// The illustration library sheet: for the design team only. It answers 404 unless DOCUSTAY_DESIGN_PREVIEW=1 is set (the local preview sets it), is never prerendered, and is not in the sitemap.
import { error } from "@sveltejs/kit";
import { env } from "$env/dynamic/private";
export const prerender = false;
export function load() { if (env.DOCUSTAY_DESIGN_PREVIEW !== "1") error(404, "Not found"); return {}; }
