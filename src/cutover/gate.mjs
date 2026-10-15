// P11.4 / P11.5 — THE UNIVERSAL GATE AND THE RETIREMENT ORDER.
//
// ★★★ §11.3, verbatim — EVERY step must satisfy ALL FIVE:
//   1. verify PASS **with the report committed**
//   2. **14 days** of real use of the replacement
//   3. **rollback rehearsed on that specific surface**
//   4. **14 days of zero non-staff requests**
//   5. ★ the redirect target returns **200, not 404**
//
// ★★ THIS IS A FUNCTION THAT REFUSES, NOT A CHECKLIST SOMEBODY READS. A checklist is satisfied by
// whoever is in a hurry; a predicate is satisfied by evidence. ★ Every retirement in this project
// turns something off that a real person is currently using, so "we think it is fine" is not a
// standard — the gate names which of the five is missing, and names nothing else.
//
// ★★★ AND NOTHING IN THIS FILE EXECUTES A RETIREMENT. It decides whether one WOULD be permitted.
// Executing the cutover is P11.7, and it is BLOCKED — see HANDOFF.md.

export const SOAK_DAYS = 14;

/** ★ §11.3: "Parallel period: 90 days. The technical floor is ~30–45 … ★ the binding constraint
 *  is MOBILE ADOPTION, and saying so out loud stops someone 'optimising' it away." */
export const PARALLEL_PERIOD_DAYS = 90;
export const TECHNICAL_FLOOR_DAYS = 30;
export const PARALLEL_BINDING_CONSTRAINT = 'mobile_adoption';

/**
 * ★★ §11.2 — THE ORDER. Encoded so a step cannot be taken out of turn by someone who read the
 * list once and remembers it approximately.
 */
export const RETIREMENT_ORDER = Object.freeze([
  { id: 'R0',  what: 'mobile bridge (forced-update gate + backend-URL indirection)' },
  { id: 'R1',  what: 'meetings + Typesense index 1' },
  { id: 'R2',  what: 'parent portal (3 users)',  retiresBy: 'route_guard' },
  { id: 'R3',  what: 'admin',                    retiresBy: 'route_guard' },
  { id: 'R4',  what: 'Nexus',                    retiresBy: 'route_guard' },
  { id: 'R5',  what: 'functions, in tranches',   noRollbackWithoutTag: true },
  { id: 'R6',  what: 'Typesense index 2 (resources)' },
  { id: 'R7',  what: 'GLT' },
  { id: 'R8',  what: 'marketing' },
  { id: 'R9',  what: 'mobile completes' },
  { id: 'R10', what: 'Railway' },
  { id: 'R11', what: 'storage' },
  { id: 'R12', what: 'Firestore' },
  { id: 'R13', what: 'extensions' },
  { id: 'R14', what: 'Auth' },
  { id: 'R15', what: 'hosting' },
]);

/**
 * ★★ §11.2: "R2, R3 and R4 are ONE BUNDLE on ONE HOSTING TARGET — they retire **by route guard,
 * not by deploy**. That is what makes staging them possible at all."
 * ★ Deploying to retire one of three surfaces that share a bundle retires all three. The route
 * guard is what makes "retire the parent portal but not admin" expressible at all.
 */
export function retirementMechanism(stepId) {
  const s = RETIREMENT_ORDER.find((x) => x.id === stepId);
  if (!s) throw new Error(`no retirement step "${stepId}"`);
  return s.retiresBy ?? 'deploy';
}

/**
 * ★★★ §11.5 — TYPESENSE RETIRES IN TWO PIECES.
 * [MEAS] two extension instances: `externalMeetings → meetings` and `resources → resources`.
 * ★ "Retiring it with the meetings cut KILLS THE LIBRARY SEARCH TOO. The `resources` index
 * outlives the meetings one by however long the library runs on the old stack."
 * ★★ Modelled as two separate steps (R1 and R6) so "retire Typesense" is not expressible as one
 * action — because as one action it is wrong.
 */
export const TYPESENSE_PIECES = Object.freeze([
  { step: 'R1', instance: 'externalMeetings', index: 'meetings' },
  { step: 'R6', instance: 'resources',        index: 'resources' },
]);

export class GateRefused extends Error {
  constructor(stepId, missing) {
    super(`retirement of ${stepId} is REFUSED — missing: ${missing.join(', ')}`);
    this.name = 'GateRefused';
    this.stepId = stepId;
    this.missing = missing;
  }
}

/**
 * ★★★ THE GATE. Returns { permitted, missing } and NEVER a bare boolean — a refusal that cannot
 * say which of the five is absent gets argued with instead of fixed.
 *
 * @param evidence {
 *   verifyReportCommitted: boolean,
 *   replacementInUseSince:  Date,
 *   rollbackRehearsedOn:    string   — the SURFACE it was rehearsed on
 *   lastNonStaffRequestAt:  Date|null,
 *   redirectStatus:         number,
 * }
 */
export function evaluateGate(stepId, evidence = {}, { now = new Date() } = {}) {
  const step = RETIREMENT_ORDER.find((x) => x.id === stepId);
  if (!step) throw new Error(`no retirement step "${stepId}"`);

  const missing = [];
  const days = (d) => (now.getTime() - new Date(d).getTime()) / 86_400_000;

  // 1 · the report is COMMITTED, not merely produced. ★ A verification nobody can find later did
  // not happen, for every purpose that matters six months from now.
  if (evidence.verifyReportCommitted !== true) missing.push('verify_report_committed');

  // 2 · 14 days of REAL USE of the replacement.
  if (!evidence.replacementInUseSince || days(evidence.replacementInUseSince) < SOAK_DAYS) {
    missing.push(`replacement_soak_${SOAK_DAYS}d`);
  }

  // 3 · ★★ ROLLBACK REHEARSED ON **THAT SPECIFIC SURFACE**. A rehearsal on a different surface is
  // a rehearsal of a different thing — the failure modes are not shared, which is the whole
  // reason the plan says "that specific surface" rather than "rollback rehearsed".
  if (evidence.rollbackRehearsedOn !== stepId) {
    missing.push(evidence.rollbackRehearsedOn
      ? `rollback_rehearsed_on_${evidence.rollbackRehearsedOn}_not_${stepId}`
      : 'rollback_rehearsed');
  }

  // 4 · 14 days of ZERO NON-STAFF requests. ★ `null` means none ever seen, which passes; a recent
  // one does not. Staff traffic is excluded deliberately — we are the ones testing it.
  if (evidence.lastNonStaffRequestAt && days(evidence.lastNonStaffRequestAt) < SOAK_DAYS) {
    missing.push(`zero_non_staff_traffic_${SOAK_DAYS}d`);
  }

  // 5 · ★ THE REDIRECT TARGET RETURNS 200, NOT 404. Retiring a surface whose replacement 404s
  // does not move users — it strands them, and the 404 is served by us, at our domain, looking
  // like we broke.
  if (evidence.redirectStatus !== 200) {
    missing.push(`redirect_200_got_${evidence.redirectStatus ?? 'none'}`);
  }

  // ★★★ R5 ONWARD HAS NO ROLLBACK WITHOUT A REPO TAG. §11 prerequisites: "0.6 (repo tagged —
  // THERE IS NO ROLLBACK FROM R5 ONWARD WITHOUT IT)". ★ Part V #7 records that no tag exists.
  if (step.noRollbackWithoutTag && evidence.repoTagged !== true) {
    missing.push('repo_tagged_no_rollback_without_it');
  }

  return { permitted: missing.length === 0, stepId, missing };
}

/** ★ Throwing form, for a caller that should not be able to ignore the answer. */
export function assertGate(stepId, evidence, opts) {
  const r = evaluateGate(stepId, evidence, opts);
  if (!r.permitted) throw new GateRefused(stepId, r.missing);
  return r;
}

/**
 * ★★ ORDER ENFORCEMENT. A step may only be taken when every earlier step is done.
 * ★ R0 first is not a preference: "★ YOU CANNOT ADD A GATE TO A VERSION ALREADY ON A PHONE. Skip
 * R0 and the only lever over a stale install is BREAKING ITS API — which is going dark."
 */
export function nextPermittedStep(completed = []) {
  return RETIREMENT_ORDER.find((s) => !completed.includes(s.id)) ?? null;
}

export function isOutOfOrder(stepId, completed = []) {
  const idx = RETIREMENT_ORDER.findIndex((s) => s.id === stepId);
  if (idx === -1) throw new Error(`no retirement step "${stepId}"`);
  const earlier = RETIREMENT_ORDER.slice(0, idx).map((s) => s.id);
  const skipped = earlier.filter((id) => !completed.includes(id));
  return skipped.length > 0 ? skipped : null;
}
