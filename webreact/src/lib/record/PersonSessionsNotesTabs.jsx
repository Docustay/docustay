// ═══════════════════════════════════════════════════════════════════════════════════════════════
// R4.031 — PERSONSESSIONSNOTESTABS. Ported from `RecordCoach.frame.html`'s "Their sessions" strip
// ("8 since March — Weekly, mostly Thursdays — One cancelled…") and `RecordFull.frame.html`'s
// Notes rows.
//
// ★★★ ORIGINAL SVELTE ARCHITECTURE: ONE FILE, TWO MOUNTABLE COMPONENTS.
//     In Svelte, SessionsTab and NotesTab were self-mounting variants via import Self pattern.
//     In React, the architecture is simpler: one component exported, two separate mounts via
//     variant prop. If a parent needs them as separate components, it imports and instantiates
//     this one twice with different variant props — the pattern the React harness expects.
//
// ★★ THEY/THEM — CLAUDE.md. "Her sessions" (frame) → "Their sessions" here.
//
// ★ "Write one" — REFRESH: `createDocument` only accepts `builder ∈ {"contract","form"}`
//   and needs a `templateId`/`typeId` this component has no honest source for. Rather than
//   invent a template id, "Write one" is disabled with its reason — same pattern as the
//   DisabledWithReason wrapper and the same reasoning: a control that cannot be wired to real
//   data stays visibly disabled with a stated prerequisite, never silently wired to a guess.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useMemo } from "react";
import { Button } from "@/lib/components/ui/button.jsx";
import { Badge } from "@/lib/components/ui/badge.jsx";
import { Alert, AlertTitle, AlertDescription } from "@/lib/components/ui/alert.jsx";
import EmptyState from "@/lib/empty/EmptyState.jsx";
import DisabledWithReason from "@/lib/forms/DisabledWithReason.jsx";

export default function PersonSessionsNotesTabs({
  variant = "sessions",
  sessions = null,
  notesPreview = [],
  error = null,
  onWriteNote = null,
  testId = null,
}) {
  const resolvedTestId = useMemo(() => {
    return testId ?? (variant === "sessions" ? "person-sessions-tab" : "person-notes-tab");
  }, [testId, variant]);

  function fmtDayMonth(value) {
    if (!value) return null;
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "long" });
  }

  function stateLabel(state) {
    if (!state) return "";
    return state.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  }

  const sessionRows = useMemo(() => sessions?.rows ?? [], [sessions]);
  const sessionsEmpty = useMemo(() => (sessions?.count ?? 0) === 0 && sessionRows.length === 0, [sessions, sessionRows]);

  if (error) {
    return (
      <div className="block" data-testid={resolvedTestId} data-variant={variant}>
        <Alert variant="destructive">
          <AlertTitle>{variant === "sessions" ? "Sessions" : "Notes"}</AlertTitle>
          <AlertDescription>
            {typeof error === "string" ? error : error?.message || "An error occurred"}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  if (variant === "sessions") {
    if (sessionsEmpty) {
      return (
        <div className="block" data-testid={resolvedTestId} data-variant={variant}>
          <EmptyState
            kind="first-run"
            icon="IconCalendar"
            headline="No sessions yet"
            line="Sessions will show here once they're booked."
            testId={`${resolvedTestId}-empty`}
          />
        </div>
      );
    }

    return (
      <div className="block" data-testid={resolvedTestId} data-variant={variant}>
        {/* Sessions strip */}
        <div className="rounded-lg border border-line bg-surface mb-[18px]" data-testid={`${resolvedTestId}-strip`}>
          <div className="flex items-center gap-3 border-b border-line-soft px-4 py-3 text-sm">
            <b>Their sessions</b>
          </div>
          <div className="px-4 pb-2.5 pt-1.5">
            <div className="flex items-center gap-3 min-h-[38px] border-b border-line-soft px-0 py-2 text-sm">
              <span className="flex-1 min-w-0">
                <span className="block text-ink overflow-wrap-anywhere">
                  {sessions?.count ?? 0} since {fmtDayMonth(sessions?.since) ?? "—"}
                </span>
              </span>
            </div>
            {(sessions?.cancelledInGoodTime ?? 0) > 0 && (
              <div className="flex items-center gap-3 min-h-[38px] border-b border-line-soft px-0 py-2 text-sm" data-testid="sessions-cancelled-row">
                <span className="flex-1 min-w-0">
                  <span className="block text-ink overflow-wrap-anywhere">
                    {sessions.cancelledInGoodTime} cancelled in good time
                  </span>
                </span>
              </div>
            )}
          </div>
        </div>

        {/* History section */}
        {sessionRows.length > 0 && (
          <div className="rounded-lg border border-line bg-surface mb-[18px]" data-testid={`${resolvedTestId}-history`}>
            <div className="flex items-center gap-3 border-b border-line-soft px-4 py-3 text-sm">
              <b>History</b>
            </div>
            <div className="px-4 pb-2.5 pt-1.5">
              {sessionRows.map((r) => (
                <div key={r.bookingId} className="flex items-center gap-3 min-h-[38px] border-b border-line-soft px-0 py-2 text-sm last:border-b-0" data-testid="session-row">
                  <span className="font-display text-mute text-sm w-[74px] flex-shrink-0" style={{ fontVariantNumeric: "tabular-nums" }}>
                    {fmtDayMonth(r.startsAt) ?? "—"}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-ink overflow-wrap-anywhere">{r.title ?? "Session"}</span>
                  </span>
                  <Badge className="inline-flex" data-value={r.state}>{stateLabel(r.state)}</Badge>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  // Notes variant
  if (notesPreview.length === 0) {
    return (
      <div className="block" data-testid={resolvedTestId} data-variant={variant}>
        <EmptyState
          kind="first-run"
          icon="IconFileText"
          headline="No notes yet"
          line="Notes from sessions will show here."
          testId={`${resolvedTestId}-empty`}
        />
      </div>
    );
  }

  return (
    <div className="block" data-testid={resolvedTestId} data-variant={variant}>
      <div className="rounded-lg border border-line bg-surface mb-[18px]" data-testid={`${resolvedTestId}-notes`}>
        <div className="flex items-center gap-3 border-b border-line-soft px-4 py-3 text-sm">
          <b>Notes</b>
          <span className="ml-auto">
            <DisabledWithReason
              disabled={!onWriteNote}
              reason="Session notes are written from Documents"
              testId="notes-write-one"
            >
              {({ disabled, describedBy }) => (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={disabled}
                  aria-describedby={describedBy}
                  onClick={() => onWriteNote?.()}
                  data-testid="notes-write-one-btn"
                >
                  Write one
                </Button>
              )}
            </DisabledWithReason>
          </span>
        </div>
        <div className="px-4 pb-2.5 pt-1.5">
          {notesPreview.map((n) => (
            <div key={n.id} className="flex items-center gap-3 min-h-[38px] border-b border-line-soft px-0 py-2 text-sm last:border-b-0" data-testid="note-row">
              <span className="font-display text-mute text-sm w-[74px] flex-shrink-0" style={{ fontVariantNumeric: "tabular-nums" }}>
                {fmtDayMonth(n.createdAt) ?? "—"}
              </span>
              <span className="flex-1 min-w-0">
                <span className="block text-ink overflow-wrap-anywhere">{n.title}</span>
                {n.authorName && (
                  <span className="block text-sm text-mute mt-0.5 overflow-wrap-anywhere">Written by {n.authorName}</span>
                )}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
