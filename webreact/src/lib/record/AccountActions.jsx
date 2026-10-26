// ═══════════════════════════════════════════════════════════════════════════════════════════════
// A7 — ACCOUNTS · NETWORK · PLATFORM · RECORDS. **MOSTLY INSTANCES; TWO REAL DECISIONS.**
//
// ★★★ DECISION 1 — **PAUSE AND RESUME STAY TWO CONTROLS AND MUST NEVER BECOME A TOGGLE.**
//     `paused` = *we chose not to*. `not_deliverable_no_grant` / `_grant_lost` / `_resource_lost`
//     = *we cannot*. They are different facts with different fixes, and **a re-consent must never
//     un-pause.**
//   ★★ THE SERVER ALREADY ENFORCES IT FROM THE OTHER SIDE: `resumeScheduleItems` carries
//      `AND state = 'paused'` in its predicate, so resuming a `not_deliverable_*` item matches
//      **ZERO ROWS AND DOES NOTHING** — silently, with a 200. A single switch would therefore look
//      like it worked and change nothing, which is worse than being refused.
//   ★★★ SO THE UI SAYS WHICH PROBLEM IT IS. A blocked item is not offered a resume it would
//       silently no-op; it is told what actually fixes it.
//
// ★★★ DECISION 2 — **NEITHER PAUSE NOR RESUME CLAIMS A NOTICE, BECAUSE NEITHER EMITS AN EVENT.**
//     MEASURED: `pauseScheduleItems` and `resumeScheduleItems` contain **no `emit(` at all**.
//     BUILD-ACTIONS lists them as firing a notice and rules: *"Either wire the event or stop
//     claiming the notice — do not ship the claim without the event."*
//   ★ I took the second option, deliberately. Wiring one would add topics to `ALL_TOPICS` (83 →
//     85), and a topic is a schema change, not a string — it ripples into every gate that asserts
//     the catalogue's size, which is beyond a UI item. **So the copy says exactly what happens —
//     the schedule stops — and says nothing about anybody being told.** Recorded as F420 so the
//     event is wired on purpose rather than discovered missing.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useState } from "react";
import { api, ApiError } from "@/lib/api.js";
import { RANK_ORDER } from "@/lib/permissions/rank.js";
import { Button } from "@/lib/components/ui/button.jsx";
import AccountActionsPipelineFormSheet from "./AccountActionsPipelineFormSheet.jsx";
import AccountActionsAdvanceFormSheet from "./AccountActionsAdvanceFormSheet.jsx";
import AccountActionsAccountPauseConfirm from "./AccountActionsAccountPauseConfirm.jsx";
import AccountActionsAccountResumeConfirm from "./AccountActionsAccountResumeConfirm.jsx";

const BLOCKED_FIX = {
  not_deliverable_no_grant: "Nobody has connected the account this needs yet.",
  not_deliverable_grant_lost: "The connection was withdrawn or expired and has to be granted again.",
  not_deliverable_resource_lost: "What this pointed at no longer exists.",
};

export default function AccountActions({ account = null, scheduleItems = [], rank = null, onDone = null }) {
  const isAdmin = RANK_ORDER.indexOf(rank ?? "") >= RANK_ORDER.indexOf("admin");

  const pausedCount = scheduleItems.filter((i) => i.state === "paused").length;
  const blocked = scheduleItems.filter((i) => String(i.state ?? "").startsWith("not_deliverable"));
  const runningCount = scheduleItems.filter((i) => ["pending", "healthy", "degraded"].includes(i.state)).length;

  const [open, setOpen] = useState(null);           // "pipeline" | "advance"
  const [pauseOpen, setPauseOpen] = useState(false);
  const [resumeOpen, setResumeOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(null);
  const [stage, setStage] = useState("");

  async function run(fn) {
    if (busy) return;
    setBusy(true);
    setProblem(null);
    try {
      await fn();
      setOpen(null);
      setPauseOpen(false);
      setResumeOpen(false);
      setStage("");
      onDone?.();
    } catch (err) {
      setProblem(err instanceof ApiError ? err.message : String(err?.message ?? err));
    } finally {
      setBusy(false);
    }
  }

  if (!account || !isAdmin) return null;

  return (
    <>
      <Button
        type="button"
        variant="default"
        size="sm"
        data-testid="account-pipeline-trigger"
        onClick={() => {
          setProblem(null);
          setOpen("pipeline");
        }}
      >
        Start a pipeline
      </Button>

      {account.pipeline_id && (
        <Button
          type="button"
          variant="default"
          size="sm"
          data-testid="account-advance-trigger"
          onClick={() => {
            setProblem(null);
            setOpen("advance");
          }}
        >
          Move to the next stage
        </Button>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════════════════════════
         ★★★ TWO CONTROLS. NEVER A SWITCH. Each is offered only when it has something to act on, so
             neither is a button that silently matches no rows.
      ═══════════════════════════════════════════════════════════════════════════════════════════ */}
      {runningCount > 0 && (
        <Button
          type="button"
          variant="default"
          size="sm"
          data-testid="account-pause-trigger"
          onClick={() => {
            setProblem(null);
            setPauseOpen(true);
          }}
        >
          Pause this account's work
        </Button>
      )}

      {pausedCount > 0 && (
        <Button
          type="button"
          variant="default"
          size="sm"
          data-testid="account-resume-trigger"
          onClick={() => {
            setProblem(null);
            setResumeOpen(true);
          }}
        >
          Resume
        </Button>
      )}

      {/* ★★★ A BLOCKED ITEM IS A DIFFERENT PROBLEM AND IS NOT OFFERED A RESUME. Resume's predicate is
           `state = 'paused'`, so pressing it here would match nothing, return 200, and change
           nothing — a control that reports success and does not act. This says what actually fixes
           it instead. */}
      {blocked.length > 0 && (
        <p data-testid="account-blocked" className="text-meta text-mute">
          {blocked.length} item{blocked.length === 1 ? "" : "s"} cannot run — this is not a pause and
          resuming will not clear it. {BLOCKED_FIX[blocked[0].state] ?? "Access to what it needs is gone."}
        </p>
      )}

      <AccountActionsPipelineFormSheet
        open={open === "pipeline" ? true : false}
        onOpenChange={(v) => setOpen(v ? "pipeline" : null)}
        account={account}
        busy={busy}
        problem={problem}
        run={run}
      />

      <AccountActionsAdvanceFormSheet
        open={open === "advance" ? true : false}
        onOpenChange={(v) => setOpen(v ? "advance" : null)}
        account={account}
        busy={busy}
        problem={problem}
        stage={stage}
        setStage={setStage}
        run={run}
      />

      <AccountActionsAccountPauseConfirm
        open={pauseOpen}
        onOpenChange={setPauseOpen}
        account={account}
        runningCount={runningCount}
        busy={busy}
        problem={problem}
        run={run}
      />

      <AccountActionsAccountResumeConfirm
        open={resumeOpen}
        onOpenChange={setResumeOpen}
        account={account}
        pausedCount={pausedCount}
        blocked={blocked}
        busy={busy}
        problem={problem}
        run={run}
      />
    </>
  );
}
