// ═══════════════════════════════════════════════════════════════════════════════════════════════
// AvailabilityRowActions — P3.U21 (S1). Built FROM specs/mockups/EngAvailabilityActions.frame.html's
// table row (When · Repeats · Until · actions), ported verbatim: same order, same labels, same text
// runs. Mounted by the host screen's own <table><tbody>, one <tr> per availability rule, block or time
// off entry (`row.kind`) — exactly as RefundRequestRow.jsx is mounted for a refund request.
// ★ Four writes, one row kind each (WIRING-MAP §3.3/§3.4 · the frame's own "What every control on this
//   frame does" block):
//     · a WEEKLY RULE's row shows only "End…" → `endAvailability` ({ruleId, onDate}) — the one control
//       that asks a question first: a date, never before today (P6.28's own rule: END a rule rather
//       than deleting it, so past bookings stay explicable).
//     · a BLOCK's row shows "Skip one" → `skipBlock` ({blockId, date}) and "Stop" → `stopBlock`
//       ({blockId, fromDate}) — both take effect from TODAY; neither asks a date (only End does, per
//       this task's own rule).
//     · a TIME OFF row shows only "Delete" → `deleteTimeOff` (timeOffId, no body).
// ★ `stopBlock`/`skipBlock`/`deleteTimeOff` have no apiRoutes.json entry yet (only `endAvailability`
//   does) — useWrite's OWN documented second form, a literal "METHOD /path" route key
//   (permissions/useWrite.js:5), is used for those three instead of the api.js method name. It reaches
//   the exact same route, the exact same routePermissions.json declaration and the exact same body
//   shape api.js's own `stopBlock`/`skipBlock`/`deleteTimeOff` send (api.js:2941-2960) — never api.js's
//   named export directly (K6a: an api.js write method is called only from write.js).
// ★ `useWrite`'s `hidden` decides visibility. End/Skip/Stop are `engagement.edit` grants — a Team
//   member's own grant is `edit/owned` (src/permissions/defaults.mjs), so `ownerId: row.hostId` is
//   passed so the scope is asked about THIS row, exactly as RefundRequestRow asks `invoice.edit` per
//   row (WIRING-MAP: "engagement.edit — hidden when refused"). Delete's route is declared `section:
//   null` (WIRING-MAP: "section (null) — hidden when refused") — a kind the client cannot be refused
//   by (can.js's own rule: "the server decides and the control shows its error if refused"), so it is
//   NOT scoped by owner here; the server is the boundary for it, same as it is for every route of that
//   kind in this codebase.
// ★ A missing prerequisite is `write.blocked`, carried on `row.blockedReason`, exactly like
//   RefundRequestRow/PauseDialog/AdjustCreditSheet: DISABLED WITH THE REASON, never hidden.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useState } from "react";
import { createPortal } from "react-dom";
import { format } from "date-fns";
import WriteButton from "@/lib/permissions/WriteButton.jsx";
import { useWrite } from "@/lib/permissions/useWrite.js";
import ActionSurface from "@/lib/forms/ActionSurface.jsx";
import ConfirmAction from "@/lib/forms/ConfirmAction.jsx";
import SheetRow from "@/lib/components/kit/SheetRow.jsx";
import DatePicker from "@/lib/components/kit/DatePicker.jsx";

const TD = "h-(--size-row) border-b border-hair px-4 text-ui text-ink";
const todayISO = () => format(new Date(), "yyyy-MM-dd");

function ErrorText({ error, testId }) {
  if (!error) return null;
  return (
    <>
      <span data-testid={`${testId}-message`}>{error.message}</span>
      {error.requestId && (
        <>
          <br />
          <span className="text-meta text-mute" data-testid={`${testId}-reference`}>Reference: {error.requestId}</span>
        </>
      )}
    </>
  );
}

/**
 * @param row { kind: "rule" | "block" | "timeOff", id, hostId?, whenLabel, repeatsLabel, untilLabel,
 *   blockedReason? } — `kind` decides which button set renders, exactly as the frame draws one set per
 *   row. `hostId` is the schedule's owner, asked about for the two engagement-scoped kinds' `ownerId`.
 * @param onChanged — called after any successful write, so the host screen refetches.
 */
export default function AvailabilityRowActions({ row, onChanged }) {
  const end = useWrite("endAvailability", { ownerId: row?.hostId, blockedReason: row?.blockedReason ?? null });
  const stop = useWrite("POST /api/engagements/blocks/stop", { ownerId: row?.hostId, blockedReason: row?.blockedReason ?? null });
  const skip = useWrite("POST /api/engagements/blocks/skip", { ownerId: row?.hostId, blockedReason: row?.blockedReason ?? null });
  const del = useWrite("POST /api/people/scheduling/time-off/:id/delete", { blockedReason: row?.blockedReason ?? null });

  const [endOpen, setEndOpen] = useState(false);
  const [endDate, setEndDate] = useState(null);
  const [stopOpen, setStopOpen] = useState(false);
  const [skipOpen, setSkipOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const kind = row?.kind;
  const today = todayISO();
  const endDateInvalid = !endDate || endDate < today;

  async function handleEnd() {
    if (endDateInvalid) return;
    try {
      await end.run({ ruleId: row.id, onDate: endDate });
      setEndOpen(false);
      setEndDate(null);
      onChanged?.();
    } catch {
      // end.error is already set — the surface stays open and shows it (below).
    }
  }

  async function handleStop() {
    try {
      await stop.run({ body: { blockId: row.id, fromDate: today } });
      setStopOpen(false);
      onChanged?.();
    } catch {
      // stop.error is already set — the confirm stays open and shows it (below).
    }
  }

  async function handleSkip() {
    try {
      await skip.run({ body: { blockId: row.id, date: today } });
      setSkipOpen(false);
      onChanged?.();
    } catch {
      // skip.error is already set — the confirm stays open and shows it (below).
    }
  }

  async function handleDelete() {
    try {
      await del.run({ params: { id: row.id } });
      setDeleteOpen(false);
      onChanged?.();
    } catch {
      // del.error is already set — the confirm stays open and shows it (below).
    }
  }

  return (
    <tr data-testid="availability-row" data-kind={kind}>
      <td className={TD}>{row?.whenLabel}</td>
      <td className={TD}>{row?.repeatsLabel}</td>
      <td className={TD}>{row?.untilLabel}</td>
      <td className={`${TD} text-right`}>
        <div className="flex items-center justify-end gap-2">
          {kind === "rule" && (
            <WriteButton write={end} testId="availability-end" variant="outline" size="sm"
                         onClick={() => { setEndDate(null); setEndOpen(true); }}>
              End…
            </WriteButton>
          )}
          {kind === "block" && (
            <>
              <WriteButton write={skip} testId="block-skip" variant="outline" size="sm"
                           onClick={() => setSkipOpen(true)}>
                Skip one
              </WriteButton>
              <WriteButton write={stop} testId="block-stop" variant="outline" size="sm"
                           onClick={() => setStopOpen(true)}>
                Stop
              </WriteButton>
            </>
          )}
          {kind === "timeOff" && (
            <WriteButton write={del} testId="time-off-delete" variant="outline" size="sm"
                         onClick={() => setDeleteOpen(true)}>
              Delete
            </WriteButton>
          )}
        </div>
      </td>

      {endOpen && createPortal(
        // ★ Portalled to document.body ourselves — ActionSurface (unlike ConfirmAction, which uses
        //   Radix's own Portal) renders inline, and this component's own root is a `<tr>`: a `<div>`
        //   sibling of `<td>` inside `<tr>` is invalid table content, same reasoning RefundRequestRow's
        //   own decline dialog gives.
        <ActionSurface
          kind="dialog"
          testId="availability-end-dialog"
          title="End this availability?"
          busy={end.busy}
          busyLabel="Ending…"
          submitLabel="End"
          cancelLabel="Cancel"
          submitDisabled={endDateInvalid || !!end.blocked}
          onCancel={() => setEndOpen(false)}
          onSubmit={handleEnd}
          error={end.error ? <ErrorText error={end.error} testId="availability-end-dialog-error" /> : null}
        >
          <p className="m-0 text-control leading-relaxed text-ink-2" data-testid="availability-end-dialog-body">
            Bookings already made under {row?.whenLabel} stay as they are. Nothing books against it from the date you choose.
          </p>
          <SheetRow label="End date" htmlFor="availability-end-date">
            <DatePicker id="availability-end-date" testId="availability-end-date" value={endDate ?? undefined}
                        minValue={today} onValueChange={(v) => setEndDate(v)} />
          </SheetRow>
        </ActionSurface>,
        document.body,
      )}

      {stopOpen && (
        <ConfirmAction
          open={stopOpen}
          onOpenChange={setStopOpen}
          testId="block-stop-confirm"
          object="this block"
          verb="Stop"
          destructive={false}
          consequence="It stops repeating from today on. Time before today is unaffected."
          confirmLabel="Stop"
          busy={stop.busy}
          error={stop.error ? <ErrorText error={stop.error} testId="block-stop-confirm-error" /> : null}
          onCancel={() => setStopOpen(false)}
          onConfirm={handleStop}
        />
      )}

      {skipOpen && (
        <ConfirmAction
          open={skipOpen}
          onOpenChange={setSkipOpen}
          testId="block-skip-confirm"
          object="today's block"
          verb="Skip"
          destructive={false}
          consequence="It happens again as usual after today."
          confirmLabel="Skip"
          busy={skip.busy}
          error={skip.error ? <ErrorText error={skip.error} testId="block-skip-confirm-error" /> : null}
          onCancel={() => setSkipOpen(false)}
          onConfirm={handleSkip}
        />
      )}

      {deleteOpen && (
        <ConfirmAction
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          testId="time-off-delete-confirm"
          object="this time off"
          verb="Delete"
          destructive
          consequence="These dates open back up for booking."
          confirmLabel="Delete"
          busy={del.busy}
          error={del.error ? <ErrorText error={del.error} testId="time-off-delete-confirm-error" /> : null}
          onCancel={() => setDeleteOpen(false)}
          onConfirm={handleDelete}
        />
      )}
    </tr>
  );
}
