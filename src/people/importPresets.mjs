// Task 12.16 — Import presets, the source step and the check counts (STAGE-12-PLAN.md §12.16,
// OQ-12.7 option A).
//
// ★★★ FIXTURES NOT FOUND AT BUILD TIME. STAGE-12-PLAN.md's own field 4 calls for one sample export
//     per platform to be obtained into `test/fixtures/import/` at REFRESH, and says explicitly:
//     "the builder types only headers present in a fixture file, never from memory — a platform
//     with no fixture ships `columns: {}`". MEASURED: `test/fixtures/import/` does not exist
//     anywhere in this repo (checked at build time — this is not a guess). Every real-platform
//     preset below therefore ships `columns: {}` per that exact, plan-authored fallback — not
//     invented headers. The check step's own "We'll ask about each column" copy (task 12.31) is
//     what a `columns: {}` preset is for; `applyPreset` below already produces the right shape for
//     it (every header lands in `unmapped`).
//
// When real exports land in `test/fixtures/import/`, each platform's `columns` map below is filled
// in from that file — never from memory — and this comment block is removed.

/** The source step's own list, in its own order — `key` is what the wizard stores as `sourceKey`. */
export const IMPORT_SOURCES = Object.freeze([
  { key: "mindbody", label: "Mindbody" },
  { key: "vagaro", label: "Vagaro" },
  { key: "boulevard", label: "Boulevard" },
  { key: "practice_better", label: "Practice Better" },
  { key: "simplepractice", label: "SimplePractice" },
  { key: "acuity_square", label: "Acuity or Square" },
  { key: "spreadsheet", label: "A spreadsheet" },
  { key: "other", label: "Somewhere else, or nowhere" },
]);

/** No fixture on hand for any platform yet — see the file header. */
function emptyPreset() {
  return Object.freeze({ columns: Object.freeze({}), cardColumn: null, knownUnmapped: Object.freeze([]) });
}

// One entry per platform key EXCEPT 'spreadsheet'/'other' — neither of those names a platform with
// a column layout to preset; a spreadsheet's/unknown source's columns are whatever the file has.
export const PRESETS = Object.freeze({
  mindbody: emptyPreset(),
  vagaro: emptyPreset(),
  boulevard: emptyPreset(),
  practice_better: emptyPreset(),
  simplepractice: emptyPreset(),
  acuity_square: emptyPreset(),
});

/**
 * Applies `PRESETS[sourceKey]` to a real CSV's column headers. An unrecognized `sourceKey` (or one
 * with no preset, e.g. 'spreadsheet'/'other') behaves exactly like a preset with empty `columns` —
 * every header lands in `unmapped`, nothing is invented.
 * @returns {{ mapping: Record<string,string>, certain: string[], unmapped: string[] }}
 */
export function applyPreset(sourceKey, csvColumns) {
  const preset = PRESETS[sourceKey];
  const columns = preset?.columns ?? {};
  const mapping = {};
  const certain = [];
  const unmapped = [];
  for (const header of csvColumns) {
    const fieldKey = columns[header];
    if (fieldKey) {
      mapping[header] = fieldKey;
      certain.push(header);
    } else {
      unmapped.push(header);
    }
  }
  return { mapping, certain, unmapped };
}
