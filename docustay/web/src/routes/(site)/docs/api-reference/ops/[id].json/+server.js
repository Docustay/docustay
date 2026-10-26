// One operation's request examples (eight languages) and its answer, highlighted at build time.
import fs from "node:fs";
import path from "node:path";
import { error } from "@sveltejs/kit";
import { operations } from "$lib/docs/openapi.js";
import { samples } from "$lib/docs/samples.js";
import { highlight } from "$lib/docs/highlight.js";
export const prerender = true;
const load = () => operations(JSON.parse(fs.readFileSync(path.join(process.cwd(), "static", "api", "openapi.json"), "utf8")));
export const entries = () => load().map((o) => ({ id: o.id }));
export async function GET({ params }) {
  const op = load().find((o) => o.id === params.id); if (!op) error(404, "Not found");
  const langs = [];
  for (const [id, label, lang, code] of samples(op)) langs.push({ id, label, code, html: await highlight(code, lang) });
  const body = op.okExample === null ? "" : JSON.stringify(op.okExample, null, 2);
  return new Response(JSON.stringify({ languages: langs, response: { status: op.okCode, body, html: body ? await highlight(body, "json") : "" } }), { headers: { "content-type": "application/json" } });
}
