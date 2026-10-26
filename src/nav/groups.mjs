// PART 4 [TY, RULED 23 Sep 2026] — ACCOUNT SHAPE REPLACES PER-FEATURE HIDING. Every practice is
// one of three shapes; no more toggling individual `src/nav/sections.mjs` section keys off one at
// a time. This supersedes WORKSTREAM 12's `NAV_GROUPS`/`GROUP_SECTIONS`/`GROUP_INFO`/
// `sectionsHiddenByGroups` (removed here) and the `nav.groups_off` setting it read.
//
// · crm  → people, engagements, money, documents, items.
// · run  → accounts, network, growth, reports.
// · both → everything (also the DEFAULT — see migration 0343: "default 'both' means nothing
//   migrates").
//   home, tasks, settings and platform are never gated by shape — a tenant always needs its own
//   task list and a way back into Settings to change its shape, and platform is a super-admin
//   surface this concept does not touch at all.
export const SHAPES = Object.freeze(['crm', 'run', 'both']);

export const SHAPE_SECTIONS = Object.freeze({
  crm: Object.freeze(['people', 'engagements', 'money', 'documents', 'items']),
  run: Object.freeze(['accounts', 'network', 'run', 'reports']),
});

export const SHAPE_INFO = Object.freeze({
  crm: { label: 'CRM', detail: 'People, engagements, invoicing and payments, documents, items and services' },
  run: { label: 'Run', detail: 'Accounts, network, growth and reports' },
  both: { label: 'Both', detail: 'Everything' },
});

/**
 * @param {string} shape - the tenant's `tenant.shape` column: 'crm' | 'run' | 'both'.
 * @returns {Set<string>} section keys to hide from the sidebar.
 */
export function sectionsHiddenByShape(shape) {
  if (shape === 'both') return new Set();
  // Batch B — a Docustay workspace sees Documents and nothing else of the CRM or Run. It is not offered at signup or in Settings → Shape: it is what a Docustay sign-up creates,
  // and "upgrade in place" is the owner choosing 'crm' or 'both' there (the same column, nothing migrates).
  if (shape === 'documents') return new Set([...SHAPE_SECTIONS.crm, ...SHAPE_SECTIONS.run].filter((k) => k !== 'documents'));
  const shown = new Set(SHAPE_SECTIONS[shape] ?? []);
  const hidden = new Set();
  for (const key of [...SHAPE_SECTIONS.crm, ...SHAPE_SECTIONS.run]) {
    if (!shown.has(key)) hidden.add(key);
  }
  return hidden;
}
