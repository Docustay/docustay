// THE BUILT-IN PLAYS (FINAL PUSH Stage 4): Markdown files in ./builtin, validated once, served from memory. Their version is the file's own fingerprint, so a changed file is a new version with nothing to migrate.
// Written and reviewed by us; a workspace's own plays live in the database (plays.mjs). A document records the play that made it as `builtin:<name>@<hash8>`.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parsePlay, brief } from "./play.mjs";

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "builtin");
let cache = null;

/** → Map name → { play, hash, ref, builtin:true }. Throws (naming the file) if any built-in is invalid: a broken shipped play is a build failure, never a silent skip. */
export function builtinPlays() {
  if (cache) return cache;
  const out = new Map();
  for (const f of fs.readdirSync(DIR).filter((x) => x.endsWith(".md")).sort()) {
    const r = parsePlay(fs.readFileSync(path.join(DIR, f), "utf8"));
    if (!r.ok) throw new Error(`built-in play ${f} is invalid: ${r.errors.join(" · ")}`);
    if (`${r.play.name}.md` !== f) throw new Error(`built-in play ${f}: the name inside (${r.play.name}) must match the file name`);
    out.set(r.play.name, { play: r.play, hash: r.hash, ref: `builtin:${r.play.name}@${r.hash.slice(0, 8)}`, builtin: true });
  }
  cache = out; return out;
}
export const builtinPlay = (name) => builtinPlays().get(String(name)) ?? null;
export const builtinBriefs = () => [...builtinPlays().values()].map((b) => ({ ...brief(b.play), ref: b.ref, builtin: true }));   // Run 9 Part 4R: a play names no template (the template carries its own guidance)
