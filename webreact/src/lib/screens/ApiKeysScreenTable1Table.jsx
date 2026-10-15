// ═══════════════════════════════════════════════════════════════════════════════════════════════
// R8.001.T1 — ApiKeysScreen › ApiKeysScreenTable1Table: the table as its own component
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import DeveloperActions from "@/lib/screens/DeveloperActions.jsx";

export default function ApiKeysScreenTable1Table({ rank = null, onDone = null, keys = [], live = [], when = null }) {
  return (
    <div className="overflow-auto rounded-card border border-line bg-surface">
      <table className="w-full border-collapse" data-testid="apikeys-table">
        <thead>
          <tr>
            <th scope="col" className="h-(--size-row-head) border-b border-line bg-surface-2 px-4 text-left text-caption font-medium text-mute">What it is for</th>
            <th scope="col" className="h-(--size-row-head) border-b border-line bg-surface-2 px-4 text-left text-caption font-medium text-mute">Fingerprint</th>
            <th scope="col" className="h-(--size-row-head) border-b border-line bg-surface-2 px-4 text-left text-caption font-medium text-mute">Environment</th>
            <th scope="col" className="h-(--size-row-head) border-b border-line bg-surface-2 px-4 text-left text-caption font-medium text-mute">Created</th>
            <th scope="col" className="h-(--size-row-head) border-b border-line bg-surface-2 px-4 text-left text-caption font-medium text-mute">State</th>
          </tr>
        </thead>
        <tbody>
          {keys.map((k) => (
            <tr
              key={k.id}
              data-testid={`apikey-row-${k.id}`}
              data-revoked={k.revoked_at ? "true" : "false"}
              className="border-b border-hair last:[&>td]:border-b-0"
            >
              <th scope="row" className="h-(--size-row) border-b border-hair px-4 text-left text-ui text-ink">
                {k.name ?? "—"}
              </th>
              <td className="h-(--size-row) border-b border-hair px-4 text-ui text-ink">
                <code className="font-mono text-sm text-mute" data-testid={`apikey-fp-${k.id}`}>
                  {k.fingerprint ?? k.last_four ?? "—"}
                </code>
              </td>
              <td className="h-(--size-row) border-b border-hair px-4 text-ui text-ink">
                {k.environment ?? "—"}
              </td>
              <td className="h-(--size-row) border-b border-hair px-4 text-ui text-ink">
                {when ? when(k.created_at) : "—"}
              </td>
              <td className="h-(--size-row) border-b border-hair px-4 text-ui text-ink">
                {k.revoked_at ? (
                  // ★★ SHOWN, NOT REMOVED — and with the DATE, which is the fact somebody came for.
                  <span className="text-sm text-mute" data-testid={`apikey-revoked-${k.id}`}>
                    Revoked {when ? when(k.revoked_at) : "—"}
                  </span>
                ) : (
                  <div className="flex items-center gap-2">
                    <span data-testid={`apikey-live-${k.id}`}>Active</span>
                    {/* ★ The revoke lives ON THE ROW it revokes, so the confirm can name that key and
                         its fingerprint rather than asking "are you sure" about one of several. */}
                    <DeveloperActions rank={rank} row={k} onDone={() => onDone?.()} />
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
