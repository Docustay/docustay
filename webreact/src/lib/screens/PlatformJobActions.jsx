// ═══════════════════════════════════════════════════════════════════════════════════════════════
// STAGE 4 TASK 10 — "RETRY NOW" AND "GIVE UP…" ON A PLATFORM JOBS ROW.
//   MOCKUPS §20 `PlatJobs`: *"what happened in plain words, retry counts, Retry now, 'Give up…'
//   with a reason."* The first three were built in Task 8. These are the two verbs.
//
// ★★★ IT DRAWS NOTHING ON A ROW IT CANNOT ACT ON. Platform Jobs is a UNION of four sources —
//     outbox events, worker jobs, unacknowledged give-ups, and dead listeners — and only the
//     give-up branch carries a `failure_id`. A pair of buttons on the other three would be a dead
//     control on every row of a screen whose entire purpose is noticing things that are stuck.
//     ★ That is why `failure_id` is the condition rather than the path: the row says whether it
//       can be acted on, and this component asks the row.
//
// ★★★ THE VERSION OF THE ROW GOES BACK WITH THE CLICK (progress.md M-3), AND THAT IS THE WHOLE
//     REASON THE LIST CARRIES `repeat_count` AND `last_seen_at`. A give-up can REPEAT between the
//     moment this screen was loaded and the moment somebody clicks — 0156 counts a new failure of
//     the same kind onto the open row — so the reason they typed may be about a smaller problem
//     than the one they are closing. The server refuses the write if either value moved, and the
//     person is told to reload and look again. Nothing is lost; nothing is closed unseen.
//
// ★★ THE RANK IS ASSERTED BY THE SERVER (super_admin_1 AND the platform tenant AND
//    caller_is_platform() inside the database, 0160). Hiding the buttons below that rank is so the
//    product stops promising what it cannot do — §K3: it is NOT the boundary, and both are true at
//    once.
//
// ★ NO PORTAL AND NO DIALOG for the reason. `ConfirmAction` is the right component for the eight
//   irreversible confirms that stand alone; this one lives INSIDE a table row, where an inline
//   prompt keeps the question next to the row it is about. A modal would hide the very line the
//   person is deciding from.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useState } from "react";
import { api } from "@/lib/api.js";
import { Button } from "@/lib/components/ui/button.jsx";
import { toast } from "sonner";

export default function PlatformJobActions({
  row,
  rank = null,
  onDone = null,
  failureId = null,
}) {
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(null); // "retry" | "give-up" | null
  const [problem, setProblem] = useState(null);

  const actualFailureId = failureId ?? row?.failure_id ?? null;
  const actionable = actualFailureId !== null && actualFailureId !== undefined && rank === "super_admin_1";

  // ★ The server's own sentence, verbatim — a refusal must say which rule said no, in its words.
  const refusalOf = (err) => err?.body?.error?.message ?? err?.message ?? "that did not go through";

  // ★ The row's version, sent with every write. Read from the row, never remembered separately.
  const version = () => ({
    failureId: Number(actualFailureId),
    repeatCount: row?.repeat_count ?? null,
    lastSeenAt: row?.last_seen_at ?? null,
  });

  const retry = async () => {
    setBusy("retry");
    setProblem(null);
    try {
      await api.retryJobNow(version());
      toast.success("Retry started");
      onDone?.();
    } catch (err) {
      setProblem(refusalOf(err));
    } finally {
      setBusy(null);
    }
  };

  const giveUp = async () => {
    // ★★ REFUSED HERE TOO, AND NOT INSTEAD OF THE SERVER. 07 §4 rule 8 makes the reason the point of
    //    the button; the route and the database both refuse a blank one. This check exists so the
    //    person is told before a round trip, never as the only place the rule lives.
    if (reason.trim() === "") {
      setProblem("Say why you are giving up on this — the reason is kept with the record.");
      return;
    }
    setBusy("give-up");
    setProblem(null);
    try {
      await api.giveUpJobFailure({ ...version(), reason: reason.trim() });
      setAsking(false);
      setReason("");
      toast.success("Marked as given up");
      onDone?.();
    } catch (err) {
      setProblem(refusalOf(err));
    } finally {
      setBusy(null);
    }
  };

  if (!actionable) {
    return null;
  }

  return (
    <div className="flex flex-wrap gap-2 items-start" data-testid="job-actions" data-failure-id={actualFailureId}>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={busy !== null}
        onClick={retry}
        data-testid="job-retry"
      >
        {busy === "retry" ? "Working…" : "Retry now"}
      </Button>

      {/* ★ The ellipsis is the promise that it will ASK. A "Give up" with no ellipsis that then
           demanded a reason would have lied about what the click does. */}
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={busy !== null}
        aria-expanded={asking}
        onClick={() => {
          setAsking(!asking);
          setProblem(null);
        }}
        data-testid="job-give-up"
      >
        Give up…
      </Button>

      {asking && (
        <div className="w-full flex flex-col gap-2" data-testid="job-give-up-prompt">
          <label htmlFor={`give-up-reason-${actualFailureId}`} className="text-sm text-mute">
            Why are you giving up on this? It is kept with the record.
          </label>
          <textarea
            id={`give-up-reason-${actualFailureId}`}
            className="rounded-lg border border-line px-3 py-2 text-ui resize-none focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand-soft"
            rows="2"
            data-testid="job-give-up-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            disabled={busy !== null}
          />
          <div className="flex gap-2 justify-end">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy !== null}
              onClick={() => {
                setAsking(false);
                setProblem(null);
              }}
              data-testid="job-give-up-cancel"
            >
              Keep it open
            </Button>
            <Button
              type="button"
              variant="default"
              size="sm"
              disabled={busy !== null}
              onClick={giveUp}
              data-testid="job-give-up-confirm"
            >
              {busy === "give-up" ? "Working…" : "Give up"}
            </Button>
          </div>
        </div>
      )}

      {problem && (
        <p
          className="w-full m-0 text-sm text-bad"
          data-testid="job-action-error"
          role="alert"
        >
          {problem}
        </p>
      )}
    </div>
  );
}
