import { Switch } from "@/lib/components/ui/switch.jsx";
import DisabledWithReason from "@/lib/forms/DisabledWithReason.jsx";

export default function SetNotificationsTable1Table({
  data,
  matrix,
  roles,
  channels,
  quietHours,
  busy,
  toggleRule,
  getCellState,
  getProvenanceLabel,
}) {
  return (
    <table className="w-full border-collapse">
      <thead>
        <tr>
          <th className="h-9 px-4 py-3 text-left text-meta font-medium text-mute-decor border-b border-line bg-paper">
            Topic
          </th>
          {roles.map((role) => (
            <th
              key={role}
              className="h-9 px-4 py-3 text-center text-meta font-medium text-mute-decor border-b border-line bg-paper"
              data-testid={`role-header-${role}`}
            >
              {role}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {matrix.map((row) => {
          const isLocked = row.locked ?? false;
          return (
            <tr
              key={row.topic}
              className={isLocked ? "bg-paper opacity-70" : ""}
              data-testid={`row-${row.topic}`}
            >
              <td className="h-10 px-4 py-3 text-ui font-medium text-ink border-b border-line whitespace-nowrap">
                <div className="block mb-1">
                  <span className="text-sm">{row.name}</span>
                </div>
                {isLocked && (
                  <span
                    className="inline-block px-1.5 py-0.5 rounded text-micro font-medium text-warn bg-warn-soft"
                    data-testid={`locked-${row.topic}`}
                  >
                    Locked
                  </span>
                )}
              </td>
              {roles.map((role) => (
                <td
                  key={`${row.topic}-${role}`}
                  className="h-10 px-4 py-3 text-center border-b border-line"
                  data-testid={`cell-${row.topic}-${role}`}
                >
                  <div className="flex flex-col gap-2 items-center">
                    {channels.map((channel) => {
                      const cellState = getCellState(row.topic, role, channel);
                      const cellId = `${row.topic}-${role}-${channel}`;

                      return (
                        <div
                          key={cellId}
                          className="flex items-center gap-2 justify-center"
                          data-testid={`cell-item-${cellId}`}
                        >
                          {isLocked ? (
                            <DisabledWithReason
                              disabled={true}
                              reason="This topic is locked."
                              testId={`locked-cell-${cellId}`}
                            >
                              {({ disabled }) => (
                                <Switch
                                  checked={cellState.enabled}
                                  disabled={true}
                                />
                              )}
                            </DisabledWithReason>
                          ) : (
                            <Switch
                              checked={cellState.enabled}
                              onCheckedChange={(checked) =>
                                toggleRule(row.topic, role, channel, checked)
                              }
                              disabled={busy[cellId]}
                              data-testid={`toggle-${cellId}`}
                            />
                          )}
                          <span className="text-caption text-mute-decor min-w-[50px] text-left">
                            {channel}
                          </span>
                          {cellState.provenance && (
                            <span
                              className="inline-flex items-center h-[18px] px-1.5 rounded text-micro font-medium text-brand bg-brand-soft"
                              data-testid={`provenance-${cellId}`}
                            >
                              {getProvenanceLabel(cellState.provenance)}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </td>
              ))}
            </tr>
          );
        })}

        {quietHours && (
          <tr className="bg-brand-soft" data-testid="quiet-hours-row">
            <td className="h-10 px-4 py-3 text-ui font-medium text-ink border-b border-line whitespace-nowrap">
              <span className="text-sm">Quiet hours</span>
            </td>
            <td
              colSpan={roles.length}
              className="h-10 px-4 py-3 border-b border-line"
            >
              <div className="flex items-center gap-3 justify-start">
                <input
                  type="time"
                  className="w-20 h-9 px-2 border border-line rounded text-control"
                  value={quietHours.startTime ?? ""}
                  data-testid="quiet-start-time"
                />
                <span className="text-control text-mute-decor">—</span>
                <input
                  type="time"
                  className="w-20 h-9 px-2 border border-line rounded text-control"
                  value={quietHours.endTime ?? ""}
                  data-testid="quiet-end-time"
                />
              </div>
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}
