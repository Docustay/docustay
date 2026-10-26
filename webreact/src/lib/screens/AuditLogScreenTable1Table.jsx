// ═══════════════════════════════════════════════════════════════════════════════════════════════
// R8.002.T1 — AuditLogScreen › AuditLogScreenTable1Table: the audit table as its own component.
// Ported from webui/src/lib/screens/AuditLogScreen.svelte:68-99 (the table element and its contents).
// Props: `events` (array of audit records), `when` (function to format timestamps).
// ═══════════════════════════════════════════════════════════════════════════════════════════════

export default function AuditLogScreenTable1Table({ events = [], when = null }) {
  const formatWhen = when || ((t) => {
    if (!t) return "—";
    const d = new Date(t);
    return Number.isNaN(d.getTime())
      ? String(t)
      : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  });

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-ui" data-testid="audit-table">
        <thead>
          <tr className="border-b border-line bg-surface-2">
            <th scope="col" className="h-9 border-b border-line bg-surface-2 px-3 py-1.5 text-left text-caption font-medium text-mute">
              What happened
            </th>
            <th scope="col" className="h-9 border-b border-line bg-surface-2 px-3 py-1.5 text-left text-caption font-medium text-mute">
              Section
            </th>
            <th scope="col" className="h-9 border-b border-line bg-surface-2 px-3 py-1.5 text-left text-caption font-medium text-mute">
              Subject
            </th>
            <th scope="col" className="h-9 border-b border-line bg-surface-2 px-3 py-1.5 text-left text-caption font-medium text-mute">
              When
            </th>
            <th scope="col" className="h-9 border-b border-line bg-surface-2 px-3 py-1.5 text-left text-caption font-medium text-mute">
              Reason
            </th>
            <th scope="col" className="h-9 border-b border-line bg-surface-2 px-3 py-1.5 text-left text-caption font-medium text-mute">
              Topic
            </th>
          </tr>
        </thead>
        <tbody>
          {events.map((e) => (
            <tr
              key={e.id}
              data-testid="audit-row"
              data-topic={e.topic}
              className="border-b border-line hover:bg-surface-2"
            >
              <td className="border-b border-hair px-3 py-1.5 text-ui text-ink">
                {e.description ?? e.topic}
              </td>
              <td className="border-b border-hair px-3 py-1.5 text-ui text-ink">
                {e.section ?? "—"}
              </td>
              <td
                data-testid="audit-subject"
                className="border-b border-hair px-3 py-1.5 text-ui text-ink"
              >
                {e.subjectId ?? "—"}
              </td>
              <td className="border-b border-hair px-3 py-1.5 text-ui text-ink">
                {formatWhen(e.at)}
              </td>
              <td
                data-testid="audit-reason"
                className="border-b border-hair px-3 py-1.5 text-ui text-ink"
              >
                {e.reason ?? "—"}
              </td>
              <td className="border-b border-hair px-3 py-1.5 text-ui text-ink">
                <code className="font-mono text-ui text-mute">{e.topic}</code>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
