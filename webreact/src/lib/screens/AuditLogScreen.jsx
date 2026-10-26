// ═══════════════════════════════════════════════════════════════════════════════════════════════
// R8.002 — AuditLogScreen: the developer audit log screen. Ported from
// webui/src/lib/screens/AuditLogScreen.svelte — same props, testids and copy.
//
// ★★★ THE LOG IS APPEND-ONLY AND HAS NO WRITE ROUTE BY DESIGN. Rows arrive from `emit(tx, …)`
//     INSIDE each write's own transaction — that is the outbox pattern, and it is what makes the
//     record atomic with the thing it records. **So there is deliberately no control on this
//     screen.** A delete, an edit or a "clear log" button would each break the one property the
//     log exists to have.
//   ★ This is the one screen in the seven where having NO buttons is the correct answer rather
//     than an unfinished one, so it is said here rather than left looking incomplete.
//
// ★★★ AN EMPTY LOG MEANS AN EMPTY PRACTICE — **NOT AUDITING SWITCHED OFF.** Those are opposite
//     facts and an empty table cannot tell them apart. Somebody looking for a record of what
//     happened and finding nothing must not conclude the practice is not being recorded.
//
// ★★ THE SUMMARY IS ABOVE THE TABLE BECAUSE "WHAT HAS BEEN HAPPENING" IS THE QUESTION PEOPLE
//    ARRIVE WITH. A hundred undifferentiated rows answers "what happened last"; the topic counts
//    answer "what goes on here", and only one of those is findable by scrolling.
//
// ★ MEASURED LIMITATION, STATED RATHER THAN HIDDEN: the route accepts `?limit=` and the client
//   method takes no argument, so this screen shows the server's default of 100 and cannot ask for
//   more. The footer says so — a truncated list that looks complete is worse than a short one
//   that admits it (F428's sibling; recorded so the cap is a known limit, not a silent one).
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import PageHeader from "@/lib/lists/PageHeader.jsx";
import EmptyState from "@/lib/empty/EmptyState.jsx";
import AuditLogScreenTable1Table from "./AuditLogScreenTable1Table.jsx";

export default function AuditLogScreen({ view = null }) {
  const events = view?.events ?? [];
  const summary = view?.summary ?? [];

  /** ★ The server's own timestamps, rendered in the reader's zone. Never reformatted into a
   *  different calendar or truncated to a date — "when" on an audit row includes the time. */
  const when = (t) => {
    if (!t) return "—";
    const d = new Date(t);
    return Number.isNaN(d.getTime())
      ? String(t)
      : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  };

  return (
    <>
      <PageHeader title="Audit log" count={events.length} noun="event" />

      {summary.length > 0 && (
        <ul
          className="mb-2 list-none flex flex-wrap gap-2.5 p-0 m-0"
          data-testid="audit-summary"
        >
          {summary.map((s) => (
            <li
              key={s.topic}
              data-testid={`audit-summary-${s.topic}`}
              className="flex items-baseline gap-1.5 px-3 py-1.5 border border-line rounded-sm"
            >
              <span className="font-mono font-semibold text-body text-ink">
                {s.count}
              </span>
              <span className="text-ui text-mute">
                {s.description ?? s.topic}
              </span>
            </li>
          ))}
        </ul>
      )}

      {events.length === 0 ? (
        <EmptyState
          kind="empty"
          headline="Nothing has happened yet"
          line="An empty log means an empty practice, not auditing switched off. Every write this practice makes is recorded here, in the same transaction as the write itself."
          testId="audit-empty"
        />
      ) : (
        <>
          <AuditLogScreenTable1Table events={events} when={when} />

          <p
            className="mt-3.5 text-control text-mute"
            data-testid="audit-cap"
          >
            Showing the most recent {events.length} events.
          </p>
        </>
      )}
    </>
  );
}
