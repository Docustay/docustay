// P11.3 — THE MIGRATION RUNNER.
//
// ★★★ THE PLAN'S OWN REQUIREMENTS, and the last one is the unusual one:
//   "idempotent … **not duplicating**, a **DRY-RUN mode**, a **LEDGER of what it did**, and
//    ★ **READ-BACK VERIFICATION AS A FIRST-CLASS STEP IN THE LOOP, NOT A FOLLOW-UP SCRIPT.**"
//
// ★★ WHY READ-BACK MUST BE INSIDE THE LOOP. A follow-up script runs after everything, against a
// dataset that has already moved on, written by someone who assumes the migration worked. Inside
// the loop, a row that did not land stops the migration AT THAT ROW, with the source still in
// hand and the reason still knowable. ★ The difference is between "we migrated 40,000 records and
// 12 are wrong somewhere" and "record 3,318 failed read-back, here it is."
//
// ★★★ AND NOTHING HERE RUNS AGAINST LIVE DATA IN THIS SESSION. P11.7 is BLOCKED. This is the
// mechanism, with its dry-run proven.

export const MIGRATION_SEQUENCE = Object.freeze([
  'orgs', 'people', 'relationships', 'documents', 'money', 'content',
]);

export class MigrationHalted extends Error {
  constructor(message, { entity, sourceId, reason }) {
    super(message);
    this.name = 'MigrationHalted';
    this.entity = entity; this.sourceId = sourceId; this.reason = reason;
  }
}

/**
 * ★★ Migrate one entity type.
 *
 * @param opts.dryRun   ★★★ when true, NOTHING IS WRITTEN — and the ledger still records what
 *                      WOULD have happened, which is what makes a dry run worth running.
 * @param opts.read     (sourceRow) => targetRow          — the mapping
 * @param opts.write    (tx, targetRow) => id             — the write
 * @param opts.readBack (tx, id) => storedRow             — ★ the verification, in the loop
 * @param opts.compare  (targetRow, storedRow) => string[]  — field names that disagree
 */
export async function migrateEntity(tx, entity, sourceRows, opts) {
  const { dryRun = false, read, write, readBack, compare, existing = () => null } = opts;
  if (!MIGRATION_SEQUENCE.includes(entity)) {
    throw new Error(`"${entity}" is not in the migration sequence: ${MIGRATION_SEQUENCE.join(' → ')}`);
  }

  const ledger = { entity, dryRun, migrated: [], skipped: [], wouldWrite: [], verified: 0 };

  for (const src of sourceRows) {
    const target = read(src);

    // ★★★ IDEMPOTENT: "not duplicating". Checked BEFORE writing, by a key the SOURCE owns —
    // re-running a migration is normal (it gets interrupted), and the second run must be a no-op
    // rather than a second copy.
    const already = await existing(tx, target);
    if (already) {
      ledger.skipped.push({ sourceId: src.id, targetId: already, reason: 'already_migrated' });
      continue;
    }

    if (dryRun) {
      // ★★ THE LEDGER IS WRITTEN ANYWAY. A dry run that reports only a count tells you nothing
      // about WHAT it would do — and "what it would do" is the entire question a dry run exists
      // to answer.
      ledger.wouldWrite.push({ sourceId: src.id, target });
      continue;
    }

    const id = await write(tx, target);

    // ★★★ READ-BACK, IN THE LOOP, IMMEDIATELY. Not batched, not deferred, not a later script.
    const stored = await readBack(tx, id);
    if (!stored) {
      throw new MigrationHalted(
        `${entity} ${src.id}: WROTE but could not READ BACK — halting with the source in hand`,
        { entity, sourceId: src.id, reason: 'read_back_empty' });
    }
    const disagree = compare(target, stored);
    if (disagree.length > 0) {
      // ★★ HALT, do not continue and count. A migration that logs mismatches and carries on
      // produces a report nobody can act on, because by then the source is gone.
      throw new MigrationHalted(
        `${entity} ${src.id}: read-back DISAGREES on ${disagree.join(', ')}`,
        { entity, sourceId: src.id, reason: `mismatch:${disagree.join(',')}` });
    }

    ledger.verified += 1;
    ledger.migrated.push({ sourceId: src.id, targetId: id });
  }

  return ledger;
}

/**
 * ★ Run the sequence in order. §Phase 10: "orgs → people → relationships → documents → money →
 * content." ★★ The order is a dependency order, not a preference: a document with no person to
 * attach to is an orphan, and a relationship written before both ends exist cannot be written at
 * all.
 */
export async function runSequence(tx, plans, { dryRun = false } = {}) {
  const ledgers = [];
  for (const entity of MIGRATION_SEQUENCE) {
    const plan = plans[entity];
    if (!plan) { ledgers.push({ entity, skipped: 'no plan supplied' }); continue; }
    ledgers.push(await migrateEntity(tx, entity, plan.rows, { ...plan, dryRun }));
  }
  return ledgers;
}

/** ★ Did a dry run and a real run agree about what was in scope? A cheap, useful cross-check. */
export function dryRunMatchesReal(dry, real) {
  const would = new Set(dry.wouldWrite.map((w) => w.sourceId));
  const did   = new Set(real.migrated.map((m) => m.sourceId));
  const missing = [...would].filter((x) => !did.has(x));
  const extra   = [...did].filter((x) => !would.has(x));
  return { agrees: missing.length === 0 && extra.length === 0, missing, extra };
}
