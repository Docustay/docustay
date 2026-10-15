// ═══════════════════════════════════════════════════════════════════════════════════════════════
// THE LAZY SCREEN REGISTRY (Ruling R-54). A screen is named by FILE, or by (section, name) through screenFiles.json,
// and loaded on demand as its own chunk. A file that does not exist yet resolves to a PENDING component that throws
// "not built yet — <file>" when rendered, so an unbuilt screen fails loudly inside the screen's error boundary and
// never renders blank. When an R4+ task writes the file, the next build picks it up — no barrel, no route edit.
// ★ Components are cached per key: React.lazy identity must be stable across renders, or the screen remounts.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { lazy } from "react";
import screenFiles from "./screenFiles.json";
import { pending } from "./pending.js";

// ★ Only the directories screens live in (screenFiles.json + the router's direct files) — the shell and kit are
//   static imports and must stay out of the lazy graph.
const MODULES = import.meta.glob(["../screens/**/*.jsx", "../record/**/*.jsx", "../forms/*.jsx", "../portal/**/*.jsx", "../staff/**/*.jsx", "../money/**/*.jsx", "../shell/SectionNotBuilt.jsx", "!../**/*.stories.jsx"]);
const cache = new Map();

/** "lib/record/PersonRecord.jsx" → the glob key relative to this file ("../record/PersonRecord.jsx"). */
const keyOf = (file) => `../${file.replace(/^lib\//, "")}`;

export function isBuilt(file) { return Boolean(MODULES[keyOf(file)]); }

/** A React component for `file`'s `exportName` (default: the default export). */
export function fileComponent(file, exportName = "default") {
  const id = `${file}#${exportName}`;
  if (!cache.has(id)) {
    const loader = MODULES[keyOf(file)];
    const name = exportName === "default" ? file.split("/").pop().replace(/\.jsx$/, "") : exportName;
    cache.set(id, loader
      ? lazy(async () => { const m = await loader(); return { default: m[exportName] ?? pending(name, file) }; })
      : pending(name, file));
  }
  return cache.get(id);
}

/** The component a section's (former) barrel exported under `name` — Screen.svelte's `sectionMod[name]`. */
export function sectionComponent(section, name) {
  const entry = screenFiles[section]?.[name];
  if (!entry) throw new Error(`lazyScreens: section "${section}" has no component "${name}" (screenFiles.json) — the route names a component no barrel ever exported`);
  return fileComponent(entry.file, entry.export);
}
