// ═══════════════════════════════════════════════════════════════════════════════════════════════
// R8.006.T1 — DocumentAxesScreen › DocumentAxesScreenTable1Table: the table as its own component
// ═══════════════════════════════════════════════════════════════════════════════════════════════

export default function DocumentAxesScreenTable1Table({ types = [], pretty = null }) {
  return (
    <div className="overflow-auto rounded-card border border-line bg-surface">
      <table className="w-full border-collapse" data-testid="doc-types-table">
        <thead>
          <tr>
            <th scope="col" className="h-(--size-row-head) border-b border-line bg-surface-2 px-4 text-left text-caption font-medium text-mute">
              Type
            </th>
            <th scope="col" className="h-(--size-row-head) border-b border-line bg-surface-2 px-4 text-left text-caption font-medium text-mute">
              Category
            </th>
            <th scope="col" className="h-(--size-row-head) border-b border-line bg-surface-2 px-4 text-left text-caption font-medium text-mute">
              Who signs
            </th>
            <th scope="col" className="h-(--size-row-head) border-b border-line bg-surface-2 px-4 text-left text-caption font-medium text-mute">
              Audience
            </th>
            <th scope="col" className="h-(--size-row-head) border-b border-line bg-surface-2 px-4 text-left text-caption font-medium text-mute">
              Division
            </th>
            <th scope="col" className="h-(--size-row-head) border-b border-line bg-surface-2 px-4 text-left text-caption font-medium text-mute">
              Applies to
            </th>
            <th scope="col" className="h-(--size-row-head) border-b border-line bg-surface-2 px-4 text-left text-caption font-medium text-mute">
              Assigned to
            </th>
          </tr>
        </thead>
        <tbody>
          {types.map((t) => (
            <tr
              key={t.id}
              data-testid={`doc-type-${t.key}`}
              className="border-b border-hair last:[&>td]:border-b-0"
            >
              <th scope="row" className="h-(--size-row) border-b border-hair px-4 text-left text-ui text-ink">
                {t.label}
                {t.is_session_note && (
                  // ★★ A SESSION NOTE IS THE ONE TYPE WITH A HARD VISIBILITY RULE BEHIND IT
                  //     (`document_is_visible()`, migration 0012 — it is what keeps a parent out of the
                  //     content). Flagged because it is not an ordinary type.
                  <span
                    className="ml-1.5 inline-block text-sm text-mute font-normal"
                    data-testid={`doc-session-note-${t.key}`}
                  >
                    session note
                  </span>
                )}
              </th>
              <td className="h-(--size-row) border-b border-hair px-4 text-ui text-ink">
                {t.category_label ?? "—"}
              </td>
              <td className="h-(--size-row) border-b border-hair px-4 text-ui text-ink">
                {pretty && t.signer_config ? pretty(t.signer_config) : t.signer_config ?? "—"}
              </td>
              <td className="h-(--size-row) border-b border-hair px-4 text-ui text-ink">
                {pretty && t.audience ? pretty(t.audience) : t.audience ?? "—"}
              </td>
              <td className="h-(--size-row) border-b border-hair px-4 text-ui text-ink">
                {pretty && t.division ? pretty(t.division) : t.division ?? "—"}
              </td>
              <td className="h-(--size-row) border-b border-hair px-4 text-ui text-ink">
                {pretty && t.applies_to ? pretty(t.applies_to) : t.applies_to ?? "—"}
              </td>
              <td className="h-(--size-row) border-b border-hair px-4 text-ui text-ink">
                {pretty && t.default_assigned_to ? pretty(t.default_assigned_to) : t.default_assigned_to ?? "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
