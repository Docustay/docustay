// P6.7 — ★★ ONE DEFINITION PER AXIS, AND A GATE THAT PROVES THE DATABASE AGREES WITH IT.
//
// ★★★ THE DEFECT THIS EXISTS TO PREVENT, MEASURED. [MEAS, E1 §1.2] the legacy `category` axis had
// FOUR independent declarations that did not match, and [MEAS, E1 §1.3] the drift guard was green
// anyway **because it never read two of them**. ★ A guard that checks three of four definitions
// reports agreement on a set that disagrees.
//
// ★★ AND THE FIX PATTERN IS ALREADY PROVEN IN THIS CODEBASE. [MEAS, E1 §1.4] axis 2
// (`subCategory`) has a compile-time link between its runtime list and its type union, and its
// four surfaces agree. Axis 1 was typed as bare `string[]` and drifted. The difference is not
// discipline — it is whether anything MECHANICALLY forces the surfaces together.
//
// ★ Here the two surfaces are THIS FILE and THE DATABASE'S CHECK CONSTRAINTS. `db/gates/
// p6_vocabulary_agreement.mjs` reads the constraint text out of `pg_constraint` and asserts set
// equality in BOTH directions — so adding a value in one place and not the other is a red build,
// and there is no third place to forget.

/**
 * ★ AXIS 3 — signer configuration. [MEAS, E1 §4.1] there are **ELEVEN**, with explicit signing
 * order. ★★ The legacy doc comment calls this "the eight-value union" in FIVE places across two
 * files, above a list of eleven — harmless to the machine, actively misleading to anyone
 * designing a replacement. The count is not restated here; the array is the count.
 */
export const SIGNER_CONFIGS = Object.freeze({
  PIR_ONLY:              ['pir'],
  COACH_ONLY:            [`coach`],
  CO_SIGNED:             ['pir', `coach`],
  PARENT_ONLY:           ['parent'],
  PARENT_AND_COACH:      ['parent', `coach`],
  PIR_PARENT_COACH:      ['parent', 'pir', `coach`],
  CLIENT_ONLY:           ['client'],
  CLIENT_AND_CONSULTANT: ['client', 'consultant'],
  // ★★★ THE TWELFTH, added 25 Sep 2026 with migration 0417 (task 14.10, R-14.13's teen signing
  //     order). `db/gates/p6_vocabulary_agreement.mjs` compares THIS object against the database's
  //     `document_type_signer_config_check`, so the two must move together or that gate goes red
  //     the moment 0417 applies — which is exactly what would have happened: 14.10's own field 2
  //     named this file, and its dispatch (mine) wrongly restricted it to the migration and test.
  //     It reported the gap rather than silently leaving the vocabulary short. This closes it.
  //   ★ ORDER MATTERS FOR THE CLIENT, NOT FOR THE CHECK: a parent signs for a teen, so the client
  //     is named first and the parent second, matching `PIR_PARENT_COACH`'s own convention of
  //     listing the signers in the order the guided flow asks for them.
  CLIENT_AND_PARENT:     ['client', 'parent'],
  FAMILY_MEMBER_ONLY:    ['familyMember'],
  RECIPIENT_ONLY:        ['recipient'],
  RECIPIENT_AND_COACH:   ['recipient', `coach`],
});

export const SIGNER_CONFIG_KEYS = Object.freeze(Object.keys(SIGNER_CONFIGS));

/**
 * ★★ THE FIVE SECTION OWNERS, PLUS THE TWO THE PROJECT RULE NAMES SEPARATELY.
 * CLAUDE.md §2.7: "NAME THE PARTY YOU MEAN, NEVER BORROW ANOTHER'S" — a GLT tech client's
 * signature once rendered under a badge reading "PIR" on an executed instrument, because a
 * `|| signerByRole.client` fallback let the recovery branch catch the tech party.
 * ★ `both` is a legacy assignment value, not a party; it is accepted as an ASSIGNMENT target
 * and must never be used as a signer role.
 */
export const ASSIGNMENT_TARGETS = Object.freeze([
  'pir', 'parent', `coach`, 'client', 'consultant', 'familyMember', 'recipient', 'both',
]);

/** ★ AXIS 4 — who may SEE a type. These are PARTY roles on `app_user`, not signer roles. */
export const AUDIENCES = Object.freeze([
  'staff', 'adult_client', 'adolescent_client', 'parent',
]);

/** ★ AXIS 5 — the two divisions. GLT = an example organisation Tech (never "Golden Light Technologies"). */
export const DIVISIONS = Object.freeze(['recovery', 'tech']);

/** ★ AXIS 6 — which kind of person a type is FOR. Distinct from who may SEE it. */
export const APPLIES_TO = Object.freeze([
  'adult_client', 'adolescent_client', 'parent', 'staff',
]);

/**
 * ★★★ P6.3 — `assignedTo` IS A GATE, NOT A LABEL.
 * [MEAS] it is "the only per-document gate the rules actually read, and named in no plan
 * document" — and [MEAS, E1 §6.4] the parent path's comment claiming the rules filter it is
 * FALSE for its own path and cites stale line numbers. ★ So it was simultaneously the only
 * real gate and the one nobody had written down correctly.
 *
 * ★★ AUDIENCE AND ASSIGNED-TO ARE DIFFERENT QUESTIONS AND BOTH MUST PASS:
 *   · `audience` is ORG POLICY, set once per TYPE — "may a parent ever see a consent form?"
 *   · `assignedTo` is THIS DOCUMENT's parties — "is this particular instrument for them?"
 * Collapsing them loses one or the other: per-type alone shows a client every other client's
 * agreement; per-document alone is the hand-set visibility that does not survive a second tenant.
 */
export function assignmentAdmits(assignedTo, partyRole) {
  if (!Array.isArray(assignedTo) || assignedTo.length === 0) return false; // ★ fail closed
  if (assignedTo.includes('both')) return true;
  return assignedTo.includes(partyRole);
}

/**
 * ★ Map a person's PARTY role on `app_user` to the assignment vocabulary.
 * ★★ NEVER FALL BACK FROM ONE PARTY TO ANOTHER (§2.7). An unmapped role returns null and is
 * refused — it does not borrow `client`, which is the exact defect that put a tech client's
 * signature under a "PIR" badge.
 */
export function partyForRole(role) {
  switch (role) {
    case 'adult_client':      return 'pir';
    case 'adolescent_client': return 'pir';
    case 'parent':            return 'parent';
    case 'staff':             return `coach`;
    default:                  return null;
  }
}
