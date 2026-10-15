import fs from "node:fs";
import path from "node:path";
import { operations, tagsOf } from "$lib/docs/openapi.js";
export const prerender = true;
export const load = () => {
  const spec = JSON.parse(fs.readFileSync(path.join(process.cwd(), "static", "api", "openapi.json"), "utf8"));
  const ops = operations(spec);
  // the page carries the words; each operation's code panel is fetched when it comes into view (ops/<id>.json), so the page stays small
  return { intro: String(spec.info?.description ?? "").trim(), version: spec.info?.version ?? "", groups: tagsOf(ops).map((g) => ({ tag: g.tag, items: g.items.map(({ bodyExample, okExample, ...o }) => o) })) };
};
