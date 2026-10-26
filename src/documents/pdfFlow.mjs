// src/documents/pdfFlow.mjs — THE STATUS MACHINE OF AN UPLOADED DOCUMENT (QUEUE §23.4.11), written with xstate. Pure, so the server enforces it and the Track screen reads the same table to know which buttons
// make sense. The persisted truth is `document_instance.state`; this gives it the names a person sees:
//
//   draft → ready → sent → in_progress → completed
//                     ↘ declined · expired · voided (from sent / in_progress)
//
// (`processing` is the moment between the upload arriving and its pages being read — shown while the upload request is in flight; it is never stored, because the file is read before the draft is created.)
import { createMachine, getNextSnapshot, getInitialSnapshot } from "xstate";

const pdfFlowMachine = createMachine({
  id: "pdfDocument",
  initial: "draft",
  states: {
    draft:       { on: { EDIT: "draft", CHECK_OK: "ready", SEND: "sent", DELETE: "draft" } },
    ready:       { on: { EDIT: "draft", SEND: "sent", DELETE: "ready" } },
    sent:        { on: { SIGN: "in_progress", SIGN_LAST: "completed", DECLINE: "declined", EXPIRE: "expired", VOID: "voided", REMIND: "sent", REASSIGN: "sent", REISSUE: "sent" } },
    in_progress: { on: { SIGN: "in_progress", SIGN_LAST: "completed", DECLINE: "declined", EXPIRE: "expired", VOID: "voided", REMIND: "in_progress", REASSIGN: "in_progress", REISSUE: "in_progress" } },
    completed:   { type: "final" },
    declined:    { type: "final" },
    expired:     { type: "final" },
    voided:      { type: "final" },
  },
});

/** The persisted instance state → the status a person sees. `checksOk` only matters for a draft. */
export function pdfStatus(instanceState, { checksOk = false } = {}) {
  switch (instanceState) {
    case "draft": return checksOk ? "ready" : "draft";
    case "sent": return "sent";
    case "partially_signed": return "in_progress";
    case "executed": return "completed";
    case "declined": return "declined";
    case "expired": return "expired";
    case "void": return "voided";
    default: throw new Error(`unknown document state "${instanceState}"`);
  }
}

const SNAPSHOT_AT = Object.fromEntries(Object.keys(pdfFlowMachine.config.states).map((s) => [s, pdfFlowMachine.resolveState({ value: s })]));

/** Does this event do anything from this status? (`can` in the xstate sense: the transition exists and leaves the machine well-defined.) */
export function can(status, event) {
  const snap = SNAPSHOT_AT[status];
  if (!snap) return false;
  return snap.can({ type: event });
}

/** Move the machine; throws a plain Error naming the status and the event when the move is not allowed (callers wrap it as a conflict). */
export function transition(status, event) {
  if (!can(status, event)) throw new Error(`a document that is ${status} cannot ${event.toLowerCase().replace("_", " ")}`);
  return getNextSnapshot(pdfFlowMachine, SNAPSHOT_AT[status], { type: event }).value;
}

/** What the Track screen may offer for a status — one table, so the buttons and the server agree. */
export function actionsFor(status) {
  return {
    edit: can(status, "EDIT"), send: can(status, "SEND"),
    remind: can(status, "REMIND"), void: can(status, "VOID"), reassign: can(status, "REASSIGN"), reissue: can(status, "REISSUE"),
    download: status === "completed", delete: status === "draft" || status === "ready",
  };
}

export { getInitialSnapshot };
