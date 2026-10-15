// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ReassignDialog — P3.U27 (S6). Built FROM specs/mockups/TaskReassign.frame.html's `.modal`: move one
// or more tasks onto a different team member's list. `taskIds` may name several tasks (a list
// workspace's bulk row) — each is its own POST /api/tasks/reassign (api.js's `reassignTasks`, the
// CONTRACTS §10 name for the route `reassignTask` already hits), sent ONE AT A TIME, in order, so a
// mid-batch refusal STOPS the batch and shows exactly what stopped it, rather than several requests
// racing and several errors arriving in no particular order.
// ★ "Tell them" IS UI-ONLY. `reassignTasks` (api.js) takes only `{taskId, assigneeId}` — there is no
//   field on the wire for a notification toggle. The frame draws it as a chip reading "On"; this
//   renders the same control, interactive, so the frame's own layout and text are ported faithfully,
//   but nothing about its value travels with the write. Flagged here, not silently dropped: a later
//   task must add the field to the route before this toggle changes anything for the person it names.
// ★ `useWrite` decides the permission, not this component: hidden (no permission to reassign) renders
//   NOTHING, the same as WriteButton — a control asking a permission it doesn't have IS the defect.
// ★ A missing prerequisite — nobody else on the team to hand a task to — is `write.blocked`:
//   DisabledWithReason renders the reason and the submit stays disabled, never hidden.
// ★ `write.error` is the server's own message, never a re-worded one (api.js's own rule) — the same
//   shape PauseDialog.jsx/MarkPaidDialog.jsx use.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useEffect, useState } from "react";
import ActionSurface from "@/lib/forms/ActionSurface.jsx";
import DisabledWithReason from "@/lib/forms/DisabledWithReason.jsx";
import ErrorPanel from "@/lib/empty/ErrorPanel.jsx";
import SheetRow from "@/lib/components/kit/SheetRow.jsx";
import Combobox from "@/lib/components/kit/Combobox.jsx";
import { Skeleton } from "@/lib/components/ui/skeleton.jsx";
import { Switch } from "@/lib/components/ui/switch.jsx";
import { useWrite } from "@/lib/permissions/useWrite.js";
import { api } from "@/lib/api.js";

/**
 * @param taskIds string[] — one or more task ids to move onto `assigneeId`'s list.
 * @param open, onOpenChange — the surface is only ever shown while `open`; `onOpenChange(false)` on
 *   cancel/close/Escape/after every task in `taskIds` has been reassigned (ActionSurface owns the
 *   busy lock and the discard guard).
 */
export default function ReassignDialog({ taskIds, open, onOpenChange }) {
  const [assigneeId, setAssigneeId] = useState("");
  const [tellThem, setTellThem] = useState(true);
  const [team, setTeam] = useState({ loading: false, error: null, data: [] });

  // Reset to this dialog's own defaults every time it opens, and load who it can hand the task(s) to.
  useEffect(() => {
    if (!open) return;
    setAssigneeId("");
    setTellThem(true);
    setTeam({ loading: true, error: null, data: [] });
    api.view("/people/team")
      .then((r) => setTeam({ loading: false, error: null, data: r?.data?.rows ?? [] }))
      .catch((err) => setTeam({ loading: false, error: err, data: [] }));
  }, [open]);

  const blockedReason = !team.loading && !team.error && team.data.length === 0
    ? "There is no one else on the team to reassign to." : null;
  const write = useWrite("reassignTasks", { blockedReason });

  if (!open || write.hidden) return null;

  const count = (taskIds ?? []).length;
  const options = team.data.map((m) => ({ value: m.id, label: m.display_name }));
  const submitDisabled = !assigneeId || team.loading || !!team.error || !!write.blocked;

  async function handleSubmit() {
    if (submitDisabled) return;
    try {
      // Deliberately sequential: a mid-batch refusal must stop the batch, which racing every
      // call with Promise.all cannot guarantee.
      for (const taskId of taskIds) {
        // eslint-disable-next-line no-await-in-loop
        await write.run({ taskId, assigneeId });
      }
      onOpenChange?.(false);
    } catch {
      // write.error is already set by useWrite — the surface stays open and shows it (below).
    }
  }

  return (
    <ActionSurface
      kind="dialog"
      testId="task-reassign"
      title={`Reassign ${count} task${count === 1 ? "" : "s"}`}
      busy={write.busy}
      busyLabel="Reassigning…"
      submitLabel="Reassign"
      cancelLabel="Cancel"
      submitDisabled={submitDisabled}
      onCancel={() => onOpenChange?.(false)}
      onSubmit={handleSubmit}
      error={write.error ? (
        <>
          <span data-testid="task-reassign-error-message">{write.error.message}</span>
          {write.error.requestId && (
            <>
              <br />
              <span className="text-mute" data-testid="task-reassign-error-reference">Reference: {write.error.requestId}</span>
            </>
          )}
        </>
      ) : null}
    >
      <SheetRow label="To">
        {team.loading ? (
          <Skeleton className="h-9 w-full" data-testid="task-reassign-to-loading" />
        ) : team.error ? (
          <ErrorPanel error={team.error} subject="Team members" testId="task-reassign-to-error" />
        ) : (
          <Combobox testId="task-reassign-to" value={assigneeId} options={options}
                     onValueChange={setAssigneeId} emptyText="No team members yet." />
        )}
      </SheetRow>

      <SheetRow label="Tell them">
        <Switch checked={tellThem} onCheckedChange={setTellThem} data-testid="task-reassign-tell-them" />
      </SheetRow>

      {write.blocked && (
        <DisabledWithReason disabled reason={write.blocked.reason} testId="task-reassign-blocked">
          Reassign needs one more thing before it can run.
        </DisabledWithReason>
      )}
    </ActionSurface>
  );
}
