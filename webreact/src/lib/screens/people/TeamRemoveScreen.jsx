// ═══════════════════════════════════════════════════════════════════════════════════════════════
// TeamRemoveScreen — Remove someone from the team, optionally reassigning future sessions.
// Ported from webui/src/lib/screens/people/TeamRemoveScreen.svelte (278 lines).
// Uses DecisionModal archetype; layout/behaviour from Svelte source; styling from kit components + tokens.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

import { useState, useMemo, useEffect } from "react";
import { api, ApiError } from "@/lib/api.js";
import DecisionModal from "@/lib/forms/DecisionModal.jsx";
import DisabledWithReason from "@/lib/forms/DisabledWithReason.jsx";
import { Field, FieldLabel, FieldContent } from "@/lib/components/ui/field.jsx";
import { Input } from "@/lib/components/ui/input.jsx";
import Combobox from "@/lib/components/kit/Combobox.jsx";
import { Skeleton } from "@/lib/components/ui/skeleton.jsx";
import { Button } from "@/lib/components/ui/button.jsx";

export default function TeamRemoveScreen({ preview = null, personId = null, onNavigate = null, onDone = null }) {
  const person = useMemo(() => preview?.person ?? { id: personId, displayName: "this team member" }, [preview, personId]);
  const futureSessions = useMemo(() => preview?.futureSessions ?? [], [preview]);
  const sessionsGiven = useMemo(() => preview?.sessionsGiven ?? 0, [preview]);
  const notesWritten = useMemo(() => preview?.notesWritten ?? 0, [preview]);
  const seats = useMemo(() => preview?.seats ?? null, [preview]);
  const n = useMemo(() => futureSessions.length, [futureSessions]);

  const firstName = useMemo(() => {
    const s = String(person?.displayName ?? "").trim();
    if (!s) return "this team member";
    return s.split(/\s+/)[0];
  }, [person]);

  const plural = (count, word) => count === 1 ? word : `${word}s`;

  const formatDateList = (dates) => {
    const fmt = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "long" });
    const labels = (dates ?? []).map((d) => fmt.format(new Date(d)));
    if (labels.length === 0) return "";
    if (labels.length === 1) return labels[0];
    return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
  };

  const rows = useMemo(() => [
    {
      headline: n === 0
        ? "No future sessions booked with them"
        : `${n} ${plural(n, "session")} booked with them`,
      detail: n === 0
        ? "Nothing to move."
        : `${formatDateList(futureSessions.map((s) => s.startsAt))}. Somebody has to take them or move them.`,
    },
    {
      headline: `${sessionsGiven} ${plural(sessionsGiven, "session")} they have given`,
      detail: "They stay on their name in your reports, for ever.",
    },
    {
      headline: `${notesWritten} ${plural(notesWritten, "note")} they have written`,
      detail: "They stay. You can still read them.",
    },
    {
      headline: "Their seat",
      detail: seats
        ? (seats.limit == null
          ? `Freed up straight away. ${seats.usedAfter} used after this.`
          : `Freed up straight away. ${seats.usedAfter} of ${seats.limit} used after this.`)
        : "Freed up straight away.",
    },
  ], [n, futureSessions, sessionsGiven, notesWritten, seats]);

  // Load coaches for reassignment
  const [coaches, setCoaches] = useState([]);
  const [coachesLoading, setCoachesLoading] = useState(true);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const { roster } = await api.teamRoster();
        if (live) {
          setCoaches((roster?.rows ?? []).filter((r) => r.id !== personId && r.staff_role));
        }
      } catch {
        if (live) setCoaches([]);
      } finally {
        if (live) setCoachesLoading(false);
      }
    })();
    return () => { live = false; };
  }, [personId]);

  const coachOptions = useMemo(() => coaches.map((c) => ({ value: c.id, label: c.display_name })), [coaches]);

  const [open, setOpen] = useState(true);
  const [confirmName, setConfirmName] = useState("");
  const [newHostId, setNewHostId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);

  const confirmMatches = useMemo(() => confirmName === person.displayName, [confirmName, person]);

  const submitLeave = async () => {
    if (submitting) return;
    if (!confirmMatches) {
      setSubmitError(`Type ${person.displayName}'s name exactly to confirm.`);
      return;
    }
    setSubmitError(null);
    setSubmitting(true);
    try {
      await api.offboardTeamMember({ personId, reassignments: [], futureSessions: { mode: "leave" } });
      onDone?.();
    } catch (err) {
      setSubmitError(err instanceof ApiError ? err.message : String(err?.message ?? err));
    } finally {
      setSubmitting(false);
    }
  };

  const submitReassign = async () => {
    if (submitting) return;
    if (!newHostId) {
      setSubmitError("Pick a new host to move these sessions to.");
      return;
    }
    setSubmitError(null);
    setSubmitting(true);
    try {
      await api.offboardTeamMember({
        personId,
        reassignments: [],
        futureSessions: { mode: "reassign", newHostUserId: newHostId },
      });
      onDone?.();
    } catch (err) {
      setSubmitError(err instanceof ApiError ? err.message : String(err?.message ?? err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancel = () => {
    setOpen(false);
    onNavigate?.("/people/team");
  };

  return (
    <DecisionModal
      open={open}
      onOpenChange={setOpen}
      title={`Take ${firstName} off the team?`}
      subtitle="They lose access straight away. Their work stays exactly where it is."
      rows={rows}
      cancelLabel="Cancel"
      confirmLabel={n === 0 ? "Remove them" : `Move the ${n} ${plural(n, "session")} first`}
      danger={n === 0}
      busy={submitting}
      confirmDisabled={n === 0 && !confirmMatches}
      error={submitError}
      onCancel={handleCancel}
      onConfirm={n === 0 ? submitLeave : submitReassign}
      testId="team-remove"
    >
      <div className="flex flex-col gap-2.5" data-testid="team-remove-extra">
        {n > 0 && (
          <>
            <div className="flex items-center gap-2.5" data-testid="team-remove-reassign">
              <span className="text-meta text-mute whitespace-nowrap">Reassign to</span>
              {coachesLoading ? (
                <Skeleton className="h-8 w-full rounded-control" data-testid="team-remove-host-loading" />
              ) : (
                <Combobox
                  value={newHostId}
                  options={coachOptions}
                  placeholder="New host…"
                  emptyText="No other coaches on the team."
                  testId="team-remove-host-picker"
                  onValueChange={setNewHostId}
                />
              )}
            </div>

            <p className="m-0 rounded-sm py-3.5 px-4 bg-warn-soft text-warn text-meta leading-relaxed" data-testid="team-remove-warning">
              <b className="font-semibold">Move the {n} {plural(n, "session")} first.</b> If you don't, they stay booked with somebody
              who can no longer sign in, and the clients won't be told.
            </p>
          </>
        )}

        <Field data-testid="team-remove-confirm-field" style={{ maxWidth: "440px" }}>
          <FieldLabel htmlFor="team-remove-confirm-input">Type {person.displayName} to confirm</FieldLabel>
          <FieldContent>
            <Input
              id="team-remove-confirm-input"
              data-testid="team-remove-confirm-input"
              placeholder={person.displayName}
              autoComplete="off"
              value={confirmName}
              onChange={(e) => setConfirmName(e.target.value)}
            />
          </FieldContent>
        </Field>

        {n > 0 && (
          <DisabledWithReason
            disabled={!confirmMatches}
            reason={`Type ${person.displayName} exactly to confirm.`}
            testId="team-remove-remove-anyway"
          >
            {({ disabled }) => (
              <Button
                type="button"
                variant="destructive"
                disabled={disabled}
                data-testid="team-remove-remove-anyway-btn"
                onClick={submitLeave}
              >
                Remove them anyway
              </Button>
            )}
          </DisabledWithReason>
        )}
      </div>
    </DecisionModal>
  );
}
