// The API description at https://docustay.app/openapi.json: a 200 with the file itself (not a redirect into /api/, which robots.txt keeps crawlers out of). Built into the site from static/api/openapi.json, which scripts/build-api-files.mjs writes from the API.
import spec from "../../../static/api/openapi.json?raw";
export const prerender = true;
export const GET = () => new Response(spec, { headers: { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=3600", "access-control-allow-origin": "*" } });
