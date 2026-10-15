// THE CREDIT STATE MACHINE (QUEUE §12.3/12.5 — XState, MIT). ONE definition of which moves a session credit may make.
//
// ★★★ THE SAME TABLE LIVES IN THE DATABASE (keystone.credit_transition, migration 0583, enforced by a trigger on every UPDATE of
//     entitlement_credit.status). This file is the application's half: callers ask `assertMove()` BEFORE writing so a bad move is a
//     clear error in words, not a bare CHECK violation — and `db/gates/credit_machine_matches_db.mjs` fails if the two ever disagree.
//
//   pending ─UNLOCK→ available ─RESERVE→ reserved ─CONSUME→ consumed
//   reserved ─RETURN→ returned ─RESERVE→ reserved         (a cancelled session gives its credit back, spendable again)
//   consumed ─RETURN→ returned                            (a deleted/refunded session that had been used)
//   available|returned ─EXPIRE→ expired                   (the pack's expiry date passed)  — terminal
//   anything not yet used ─VOID→ voided                   (a refund / lost dispute)       — terminal
import { createMachine, getNextSnapshot } from "xstate";

const CREDIT_STATES = Object.freeze(["pending", "available", "reserved", "consumed", "returned", "expired", "voided"]);
/** Spendable = may be reserved. `returned` is spendable again (credits.mjs header — a cancel is not a penalty). */
export const SPENDABLE_STATES = Object.freeze(["available", "returned"]);

export const creditMachine = createMachine({
  id: "credit",
  initial: "available",
  states: {
    pending:   { on: { UNLOCK: "available", VOID: "voided" } },
    available: { on: { RESERVE: "reserved", EXPIRE: "expired", VOID: "voided" } },
    reserved:  { on: { CONSUME: "consumed", RETURN: "returned", VOID: "voided" } },
    consumed:  { on: { RETURN: "returned", VOID: "voided" } },
    returned:  { on: { RESERVE: "reserved", EXPIRE: "expired", VOID: "voided" } },
    expired:   { type: "final" },
    voided:    { type: "final" },
  },
});

const EVENT_FOR_TARGET = Object.freeze({ available: "UNLOCK", reserved: "RESERVE", consumed: "CONSUME", returned: "RETURN", expired: "EXPIRE", voided: "VOID" });

/** Every legal [from, to] pair, derived from the machine itself (never a second hand-written list). */
export function legalMoves() {
  const out = [];
  for (const from of CREDIT_STATES) {
    for (const to of CREDIT_STATES) if (canMove(from, to)) out.push([from, to]);
  }
  return out;
}

export function canMove(from, to) {
  const event = EVENT_FOR_TARGET[to];
  if (!event || !CREDIT_STATES.includes(from)) return false;
  const snap = creditMachine.resolveState({ value: from });
  const next = getNextSnapshot(creditMachine, snap, { type: event });
  return next.value === to && next.value !== from;
}

class IllegalCreditMove extends Error {
  constructor(from, to) { super(`a credit cannot go from "${from}" to "${to}"`); this.name = "IllegalCreditMove"; this.from = from; this.to = to; }
}
function assertMove(from, to) { if (!canMove(from, to)) throw new IllegalCreditMove(from, to); return true; }
