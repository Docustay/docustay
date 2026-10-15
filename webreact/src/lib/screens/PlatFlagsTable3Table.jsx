// ═══════════════════════════════════════════════════════════════════════════════════════════════
// R8.040.T3 — PlatFlags › PlatFlagsTable3Table: the table as its own component
// ═══════════════════════════════════════════════════════════════════════════════════════════════

export default function PlatFlagsTable3Table({ practice = null, formatSince = null }) {
  const changeLog = practice?.changeLog ?? [];

  return (
    <div className="overflow-auto rounded-card border border-line bg-surface">
      <table className="w-full border-collapse" data-testid="platflags-log-table">
        <thead>
          <tr>
            <th scope="col" className="h-(--size-row-head) border-b border-line bg-surface-2 px-4 text-left text-caption font-medium text-mute">
              Flag
            </th>
            <th scope="col" className="h-(--size-row-head) border-b border-line bg-surface-2 px-4 text-left text-caption font-medium text-mute">
              Changed to
            </th>
            <th scope="col" className="h-(--size-row-head) border-b border-line bg-surface-2 px-4 text-left text-caption font-medium text-mute">
              Previous
            </th>
            <th scope="col" className="h-(--size-row-head) border-b border-line bg-surface-2 px-4 text-left text-caption font-medium text-mute">
              Reason
            </th>
            <th scope="col" className="h-(--size-row-head) border-b border-line bg-surface-2 px-4 text-left text-caption font-medium text-mute">
              Set by
            </th>
            <th scope="col" className="h-(--size-row-head) border-b border-line bg-surface-2 px-4 text-left text-caption font-medium text-mute">
              When
            </th>
          </tr>
        </thead>
        <tbody>
          {changeLog.map((c, i) => (
            <tr
              key={i}
              data-testid="platflags-log-row"
              className="border-b border-hair last:[&>td]:border-b-0"
            >
              <td className="h-(--size-row) border-b border-hair px-4 text-ui text-ink">
                <code className="font-mono">{c.flag_key}</code>
              </td>
              <td className="h-(--size-row) border-b border-hair px-4 text-ui text-ink">
                {c.on ? "On" : "Off"}
              </td>
              <td className="h-(--size-row) border-b border-hair px-4 text-ui text-ink">
                {c.previous ? "On" : "Off"}
              </td>
              <td className="h-(--size-row) border-b border-hair px-4 text-ui text-ink">
                {c.reason ?? "—"}
              </td>
              <td className="h-(--size-row) border-b border-hair px-4 text-ui text-ink">
                {c.set_by}
              </td>
              <td className="h-(--size-row) border-b border-hair px-4 text-ui text-ink">
                {formatSince ? formatSince(c.set_at) : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
