import * as ButtonGroup from "@/lib/components/ui/button-group.jsx";

export default function NotificationPrefsScreenTable1Table({
  topics,
  ROLE_COLUMNS,
  CHANNEL_COLUMNS,
  busy,
  cellKey,
  enabledOf,
  toggle,
}) {
  return (
    <table className="w-full border-collapse" data-testid="notif-table">
      <thead>
        <tr>
          <th scope="col" className="h-9 px-4 text-left text-xs font-medium text-structure-600 border-b border-structure-200 bg-structure-100">
            When
          </th>
          {ROLE_COLUMNS.map((col) => (
            <th
              key={col.key}
              scope="col"
              className="h-9 px-4 text-left text-xs font-medium text-structure-600 border-b border-structure-200 bg-structure-100"
            >
              {col.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {topics.map((row) => (
          <tr key={row.key} data-testid={`notif-row-${row.key}`} data-always-on={row.alwaysOn}>
            <th scope="row" className="h-[46px] px-4 text-left text-sm font-normal text-structure-900 border-b border-structure-150 max-w-80 whitespace-normal break-words">
              {row.label}
            </th>
            {ROLE_COLUMNS.map((col) => (
              <td key={`${row.key}-${col.key}`} className="h-[46px] px-4 text-sm border-b border-structure-150">
                {row.alwaysOn ? (
                  <span
                    className="text-xs text-structure-600"
                    data-testid={`notif-locked-${row.key}-${col.key}`}
                  >
                    Always on
                  </span>
                ) : (
                  <ButtonGroup.ButtonGroup
                    className="flex gap-1"
                    aria-label={`${row.label} — ${col.label}`}
                    data-testid={`notif-pills-${row.key}-${col.key}`}
                  >
                    {CHANNEL_COLUMNS.map((ch) => {
                      const cell = row.roles?.[col.key]?.[ch.key];
                      // the API sends { enabled, provenance } per cell; older fixtures send a bare boolean
                      const serverValue = cell !== null && typeof cell === "object" ? cell.enabled : cell;
                      const on = enabledOf(row.key, col.key, ch.key, serverValue);
                      const key = cellKey(row.key, col.key, ch.key);
                      return (
                        <button
                          key={key}
                          type="button"
                          className={`px-3.5 py-1.5 text-xs rounded-full font-medium transition-colors ${
                            on
                              ? "bg-structure-900 text-structure-0 border border-structure-900"
                              : "bg-transparent text-structure-650 border border-structure-200"
                          } hover:opacity-80 disabled:opacity-60 cursor-pointer disabled:cursor-default`}
                          role="switch"
                          aria-checked={on ? "true" : "false"}
                          aria-label={`${row.label} — ${col.label} — ${ch.label} — ${on ? "on" : "off"}`}
                          data-testid={`notif-pill-${row.key}-${col.key}-${ch.key}`}
                          disabled={busy === key}
                          onClick={() => toggle(row.key, col.key, ch.key, serverValue)}
                        >
                          {ch.label}
                        </button>
                      );
                    })}
                  </ButtonGroup.ButtonGroup>
                )}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
