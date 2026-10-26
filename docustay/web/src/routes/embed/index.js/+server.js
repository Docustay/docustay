// The embed script, served from the same address as the rest of docustay.app so the snippet in the docs works as written (a module script on another origin needs these CORS headers).
import src from "$lib/embed/index.js?raw";
export const prerender = false;
export const GET = () => new Response(src, { headers: { "content-type": "text/javascript; charset=utf-8", "access-control-allow-origin": "*", "cross-origin-resource-policy": "cross-origin", "cache-control": "public, max-age=3600" } });
