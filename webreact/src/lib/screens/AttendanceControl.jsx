// ═══════════════════════════════════════════════════════════════════════════════════════════════
// A4.1 — ATTENDANCE. **TWO CONTROLS, BOOKING-LEVEL SHAPE.** (F399)
//
// ★★★ THE DEFECT THIS EXISTS TO AVOID IS A ONE-CLICK TICK. `POST /api/engagements/attendance`
//     BRANCHES ON THE BODY SHAPE:
//       { participantId, attended }        → updates one row → emits `booking.participant.added`
//       { bookingId, outcome, participants } → recordAttendance → emits `booking.booking.completed`
//     **A one-click row control naturally posts the participant shape — the branch that does NOT
//     fire `booking.completed`.** The row would be written, the tick would appear, and the
//     session-note chain would silently never run. That is the "half-built" failure on the core
//     loop, in the one place it was ruled it must not happen.
//   ★ So this ALWAYS sends `{ bookingId, outcome, participants }`. The single-participant shape is
//     never constructed here, and the server refuses a body carrying both.
//
// ★★★ AND THERE ARE **TWO OUTCOMES**, NOT ONE. `ATTENDANCE_OUTCOMES = ["completed", "no_show"]`,
//     and the server refuses to guess between them: *"there is no default: 'the session happened'
//     and 'they did not come' are different facts, and one of them part-charges the client."*
//   ★★ A single button that always means "attended" either makes a no-show unrecordable, or
//      invites a coach to mark one as attended to avoid a second interaction — **a billing
//      decision made to dodge a UI.**
//
// ★★★ THE NO-SHOW CONTROL NAMES THE CONSEQUENCE **BEFORE** IT IS PRESSED, and the number is READ,
//     never hardcoded. It comes from `GET /api/engagements/attendance-policy`, which calls
//     `resolveNoShowCharge` — the SAME function `recordAttendance` calls. A practice that has set
//     25% must never be shown 50% and charged 25%.
//
// ★★ IT DOES NOT SWITCH THE MONEY ON, AND MUST NOT BE DESCRIBED AS DOING SO. `src/money/charge.mjs`
//    is deliberately unwired: `p18_charge_path.mjs:214` asserts *"no route mounts the charge path
//    — 'record, do not surface'"* as the CORRECT state and FAILS if one does. What a no-show does
//    today is RECORD the outcome and the percentage that will apply. The wording says "will be",
//    not "has been".
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useState, useEffect } from "react";
import { api } from "@/lib/api.js";
import { Button } from "@/lib/components/ui/button.jsx";
import { ButtonGroup } from "@/lib/components/ui/button-group.jsx";
import SettleBookingModal from "./SettleBookingModal.jsx";

// ★★★ THE TWO OUTCOMES ARE WRITTEN OUT, NOT LOOPED OVER `ATTENDANCE_OUTCOMES`, AND THAT IS
//     DELIBERATE — this is the one place in the build where importing the server vocabulary would
//     be the WRONG call. The two are not interchangeable values with one appearance: "Held" is a
//     plain confirmation and "No-show" carries a percentage that part-charges somebody. A loop
//     would render two identical buttons and lose exactly the distinction the control exists to
//     make. ★★ `src/booking/attendance.mjs` is not importable here anyway (it reaches `pg`
//     through `emit`), so the alternative was another vocab extraction for no runtime benefit.
//   ★★★ COVERAGE IS ASSERTED WHERE IT BELONGS INSTEAD: the gate compares the set of outcomes this
//       control can POST against the server's `ATTENDANCE_OUTCOMES`, so a THIRD outcome added to
//       the vocabulary turns the gate red for having no button — which a runtime loop would have
//       silently "handled" by drawing a button nobody designed.

export default function AttendanceControl({ booking = null, participants = [], onDone = null }) {
  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // ★★★ F443, LEG 3 — **WHO** WAS THERE, NOT ONLY WHETHER IT HAPPENED.
  //
  //   The two buttons below record an OUTCOME for the session. They always could. What the control
  //   could not do — because `participants` arrived empty from a related entry that did not exist —
  //   was say which PEOPLE were present. So a coach closed a session and every participant row kept
  //   `attended = NULL` forever, and the Sessions list's Attended column could never become true.
  //
  // ★★ EVERYBODY IS TICKED BY DEFAULT, AND THAT IS THE RIGHT DEFAULT RATHER THAN A CONVENIENCE.
  //    "Held" means the session happened; the common case by a wide margin is that the people
  //    booked onto it were there. Starting unticked would make the ordinary case a chore and train
  //    a coach to press Held without looking — which is how you get attendance data that is
  //    technically recorded and actually meaningless.
  // ★★★ AND "NO-SHOW" IS NOT THE SAME BUTTON WITH A DIFFERENT WORD. It is a decision about
  //     CHARGING somebody, so it sends `attended: false` for everyone still ticked rather than
  //     silently reusing whatever the boxes happen to say. The two outcomes mean different things
  //     about the same people.
  // ★ `attended: null` — nobody has said — remains reachable: untick everyone and press Held. A
  //   session whose attendance genuinely is not known must stay expressible, because forcing a
  //   false answer is worse than keeping an honest gap.
  // ═══════════════════════════════════════════════════════════════════════════════════════════
  const [present, setPresent] = useState(null);

  // ★ Seeded from the rows the moment they arrive, and never re-seeded — re-deriving on every
  //   change would undo the coach's ticks as they made them.
  useEffect(() => {
    if (present === null && participants.length) {
      setPresent(new Set(participants.map((p) => p.id)));
    }
  }, [participants, present]);

  const toggle = (id) => {
    const next = new Set(present ?? []);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setPresent(next);
  };

  // ★★ THE PAYLOAD. `outcome` decides what a tick MEANS, which is why this takes it as an
  //    argument rather than reading component state.
  const payloadFor = (outcome) =>
    participants.map((p) => ({
      participantId: p.id,
      attended: outcome === "no_show" ? false : (present?.has(p.id) ?? false),
    }));

  const [policy, setPolicy] = useState(null);

  // ★★ LOADED ONCE, AND THE BUTTON IS HONEST WHILE IT IS UNKNOWN. Rendering "50%" before the answer
  //    arrives would be the hardcoded default wearing the read value's clothes.
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const p = await api.attendancePolicy();
        if (live) setPolicy(p);
      } catch {
        if (live) setPolicy(null); // ★ unknown stays unknown; see `noShowLabel`
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  const noShowLabel =
    policy?.percent === undefined || policy?.percent === null
      ? "No-show"
      : `No-show — ${policy.percent}% charge`;

  // ★ A session that is not open cannot take attendance, and the server says so in its own words.
  //   The control is still drawn: a coach needs to see WHY, and a missing button explains nothing.
  const closed = booking?.state === "completed" || booking?.state === "no_show";

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // ★★★ BOOKING OVERHAUL, 29 Sep 2026 — HELD/NO-SHOW NOW OPEN A CONFIRMATION MODAL INSTEAD OF
  //     RECORDING DIRECTLY. the maintainer's own ask: the click should show what will be charged — card on
  //     file, an invoice, or a package credit — and require an explicit confirmation naming the
  //     amount, before anything is recorded OR charged. `SettleBookingModal` owns that; this
  //     control's job is only to open it with the right outcome and participant ticks.
  // ═══════════════════════════════════════════════════════════════════════════════════════════
  const [pendingOutcome, setPendingOutcome] = useState(null);

  function openSettle(outcome) {
    if (pendingOutcome !== null || !booking?.id) return;
    setPendingOutcome(outcome);
  }

  function settled() {
    setPendingOutcome(null);
    onDone?.();
  }

  if (!booking) {
    return null;
  }

  return (
    <div
      className="inline-flex flex-col gap-1 items-start"
      data-testid="attendance-control"
      data-booking={booking.id}
    >
      {closed ? (
        // ★★ ALREADY RECORDED IS A FACT, NOT AN ABSENCE. Showing nothing here would read as a
        //    control that failed to load; showing the outcome answers the question the coach came
        //    with.
        <span
          className="px-2 py-0.5 rounded-full bg-muted text-muted-foreground text-xs font-medium inline-flex items-center"
          data-testid="attendance-recorded"
          data-value={booking.state}
        >
          {booking.state === "no_show" ? "No-show" : "Held"}
        </span>
      ) : (
        <>
          {participants.length ? (
            // ★★★ F443 — THE PEOPLE. Without this list the control recorded an outcome and marked
            //     nobody, and nothing on any screen said so. ★ A checkbox rather than a chip: this is an
            //     INPUT, and the shape of a control has to say whether you can change it.
            <fieldset
              className="flex flex-col gap-1.5 border border-line rounded-lg p-3 m-0 mb-3"
              data-testid="attendance-participants"
            >
              <legend className="px-1.5 text-xs text-muted-foreground font-normal">
                Who was there
              </legend>
              {participants.map((p) => (
                <label
                  key={p.id}
                  className="flex items-baseline gap-2 text-sm cursor-pointer"
                >
                  <input
                    type="checkbox"
                    data-testid={`attendance-person-${p.id}`}
                    checked={present?.has(p.id) ?? false}
                    disabled={pendingOutcome !== null}
                    onChange={() => toggle(p.id)}
                    className="mt-0.5"
                  />
                  <span>{p.label}</span>
                  {p.sub && <span className="text-muted-foreground text-xs">{p.sub}</span>}
                </label>
              ))}
            </fieldset>
          ) : (
            // ★★ NOBODY IS ON THIS BOOKING, and that is a different fact from "nobody came". Saying so
            //     is what stops the next reader concluding the list failed to load.
            <p className="text-muted-foreground text-xs" data-testid="attendance-no-participants">
              Nobody is listed on this session yet. You can still record what happened.
            </p>
          )}

          <ButtonGroup data-testid="attendance-group" aria-label="Record attendance">
            <Button
              type="button"
              variant="default"
              size="default"
              data-testid="attendance-held"
              disabled={pendingOutcome !== null}
              onClick={() => openSettle("completed")}
            >
              Held
            </Button>

            {/* ★★★ THE CONSEQUENCE IS IN THE LABEL, NOT IN A TOOLTIP. A coach deciding between these
               two is deciding whether to part-charge somebody, and the cost of the second option has
               to be visible at the moment of the decision — not discoverable after it. */}
            <Button
              type="button"
              variant="default"
              size="default"
              data-testid="attendance-no-show"
              disabled={pendingOutcome !== null}
              onClick={() => openSettle("no_show")}
            >
              {noShowLabel}
            </Button>
          </ButtonGroup>
        </>
      )}

      <SettleBookingModal
        open={pendingOutcome !== null}
        onOpenChange={(next) => { if (!next) setPendingOutcome(null); }}
        bookingId={booking?.id ?? null}
        outcome={pendingOutcome}
        participants={pendingOutcome ? payloadFor(pendingOutcome) : []}
        onSettled={settled}
      />
    </div>
  );
}
