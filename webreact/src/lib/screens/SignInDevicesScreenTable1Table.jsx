// ═══════════════════════════════════════════════════════════════════════════════════════════════
// R8.036.T1 — SignInDevicesScreen › SignInDevicesScreenTable1Table: the table as its own component
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { Button } from "@/lib/components/ui/button.jsx";
import { Badge } from "@/lib/components/ui/badge.jsx";

export default function SignInDevicesScreenTable1Table({
  sessions = [],
  removingId = null,
  when = null,
  lastUsed = null,
  deviceLabel = null,
  truncateAddress = null,
  removeSession = null,
}) {
  return (
    <div className="overflow-auto rounded-lg border border-line bg-surface">
      <table className="w-full border-collapse" data-testid="signin-sessions-table">
        <thead>
          <tr>
            <th scope="col" className="h-9 border-b border-line bg-surface-2 px-4 text-left text-caption font-medium text-mute">
              Device
            </th>
            <th scope="col" className="h-9 border-b border-line bg-surface-2 px-4 text-left text-caption font-medium text-mute">
              Started
            </th>
            <th scope="col" className="h-9 border-b border-line bg-surface-2 px-4 text-left text-caption font-medium text-mute">
              Last used
            </th>
            <th scope="col" className="h-9 border-b border-line bg-surface-2 px-4 text-left text-caption font-medium text-mute">
              Location
            </th>
            <th scope="col" className="h-9 border-b border-line bg-surface-2 px-4"></th>
          </tr>
        </thead>
        <tbody>
          {sessions.map((s) => (
            <tr
              key={s.id}
              data-testid={`session-row-${s.id}`}
              data-current={s.current ? "true" : "false"}
              className="border-b border-hair last:border-b-0"
            >
              <th scope="row" className="h-10 border-b border-hair px-4 text-left text-ui text-ink">
                <div className="flex items-center gap-2">
                  {deviceLabel ? deviceLabel(s.userAgent) : "—"}
                  {s.current && (
                    <Badge
                      variant="outline"
                      data-testid={`session-current-${s.id}`}
                    >
                      This device
                    </Badge>
                  )}
                </div>
              </th>
              <td className="h-10 border-b border-hair px-4 text-left text-ui text-ink">
                {when ? when(s.createdAt) : "—"}
              </td>
              <td className="h-10 border-b border-hair px-4 text-left text-ui text-ink" data-testid={`session-lastused-${s.id}`}>
                {lastUsed ? lastUsed(s.lastSeenAt) : "—"}
              </td>
              <td className="h-10 border-b border-hair px-4 text-left text-ui text-ink" data-testid={`session-location-${s.id}`}>
                {truncateAddress ? truncateAddress(s.ipFirstSeen) : "—"}
              </td>
              <td className="h-10 border-b border-hair px-4">
                <Button
                  variant="outline"
                  size="sm"
                  data-testid={`session-remove-${s.id}`}
                  disabled={removingId === s.id}
                  onClick={() => removeSession?.(s.id)}
                >
                  Remove
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
