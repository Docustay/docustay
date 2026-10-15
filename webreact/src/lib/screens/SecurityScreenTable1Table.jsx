// ═══════════════════════════════════════════════════════════════════════════════════════════════
// R8.014.T1 — SecurityScreen › SecurityScreenTable1Table: the table as its own component
// ═══════════════════════════════════════════════════════════════════════════════════════════════

export default function SecurityScreenTable1Table({
  sessions = [],
  current = null,
  busyTokenId = null,
  when = null,
  signOutOne = null,
}) {
  return (
    <div className="overflow-auto rounded-lg border border-line bg-surface">
      <table className="w-full border-collapse" data-testid="security-sessions-table">
        <thead>
          <tr>
            <th scope="col" className="h-9 border-b border-line bg-surface-2 px-4 text-left text-caption font-medium text-mute">
              Device
            </th>
            <th scope="col" className="h-9 border-b border-line bg-surface-2 px-4 text-left text-caption font-medium text-mute">
              Kind
            </th>
            <th scope="col" className="h-9 border-b border-line bg-surface-2 px-4 text-left text-caption font-medium text-mute">
              Signed in
            </th>
            <th scope="col" className="h-9 border-b border-line bg-surface-2 px-4 text-left text-caption font-medium text-mute">
              Expires
            </th>
            <th scope="col" className="h-9 border-b border-line bg-surface-2 px-4"></th>
          </tr>
        </thead>
        <tbody>
          {sessions.map((s) => (
            <tr
              key={s.tokenId}
              data-testid={`security-session-row-${s.tokenId}`}
              data-current={s.tokenId === current ? "true" : "false"}
              className="border-b border-hair last:border-b-0"
            >
              <th scope="row" className="h-10 border-b border-hair px-4 text-left text-ui text-ink">
                {s.userAgentSummary}
                {s.tokenId === current && (
                  <span
                    className="ml-2 inline-block px-2 py-1 text-xs font-medium bg-gray-200 text-gray-800 rounded"
                    data-testid={`security-session-current-${s.tokenId}`}
                  >
                    This device
                  </span>
                )}
              </th>
              <td className="h-10 border-b border-hair px-4 text-left text-ui text-ink" data-testid={`security-session-kind-${s.tokenId}`}>
                {s.kind}
              </td>
              <td className="h-10 border-b border-hair px-4 text-left text-ui text-ink" data-testid={`security-session-created-${s.tokenId}`}>
                {when ? when(s.createdAt) : "—"}
              </td>
              <td className="h-10 border-b border-hair px-4 text-left text-ui text-ink" data-testid={`security-session-expires-${s.tokenId}`}>
                {when ? when(s.expiresAt) : "—"}
              </td>
              <td className="h-10 border-b border-hair px-4">
                <button
                  type="button"
                  className="px-3 py-1 bg-gray-200 text-gray-800 rounded disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-300 transition-colors text-sm font-medium"
                  data-testid={`security-session-signout-${s.tokenId}`}
                  disabled={busyTokenId === s.tokenId}
                  onClick={() => signOutOne?.(s.tokenId)}
                >
                  Sign out
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
