// The component sheet: for builders only. 404 unless DOCUSTAY_DESIGN_PREVIEW=1 (the local preview sets it); never prerendered, never in the sitemap.
import { error } from "@sveltejs/kit";
import { env } from "$env/dynamic/private";
export const prerender = false;
export function load() { if (env.DOCUSTAY_DESIGN_PREVIEW !== "1") error(404, "Not found"); return {}; }
