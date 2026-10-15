// ═══════════════════════════════════════════════════════════════════════════════════════════════
// R8.040.T2 — PlatFlags › PlatFlagsTable2Table: the table as its own component
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { Button } from "@/lib/components/ui/button.jsx";
import DisabledWithReason from "@/lib/forms/DisabledWithReason.jsx";

export default function PlatFlagsTable2Table({
  flags = [],
  practice = null,
  busyKey = null,
  reasonDrafts = {},
  toggle = null,
  overrideFor = null,
  effectiveFor = null,
}) {
  return (
    <div className="overflow-auto rounded-card border border-line bg-surface">
      <table className="w-full border-collapse" data-testid="platflags-table">
        <thead>
          <tr>
            <th scope="col" className="h-(--size-row-head) border-b border-line bg-surface-2 px-4 text-left text-caption font-medium text-mute">
              Flag
            </th>
            <th scope="col" className="h-(--size-row-head) border-b border-line bg-surface-2 px-4 text-left text-caption font-medium text-mute">
              Description
            </th>
            <th scope="col" className="h-(--size-row-head) border-b border-line bg-surface-2 px-4 text-left text-caption font-medium text-mute">
              Default (everyone)
            </th>
            <th scope="col" className="h-(--size-row-head) border-b border-line bg-surface-2 px-4 text-left text-caption font-medium text-mute">
              This practice
            </th>
            <th scope="col" className="h-(--size-row-head) border-b border-line bg-surface-2 px-4 text-left text-caption font-medium text-mute">
              Reason
            </th>
            <th scope="col" className="h-(--size-row-head) border-b border-line bg-surface-2 px-4"></th>
          </tr>
        </thead>
        <tbody>
          {flags.map((f) => {
            const ov = overrideFor ? overrideFor(f.key) : null;
            const eff = effectiveFor ? effectiveFor(f.key) : null;
            return (
              <tr
                key={f.key}
                data-testid={`platflags-row-${f.key}`}
                data-flag-key={f.key}
                className="border-b border-hair last:[&>td]:border-b-0"
              >
                <th scope="row" className="h-(--size-row) border-b border-hair px-4 text-left text-ui text-ink">
                  <code className="font-mono">{f.key}</code>
                </th>
                <td className="h-(--size-row) border-b border-hair px-4 text-ui text-ink">
                  {f.description}
                </td>
                <td
                  data-testid={`platflags-default-${f.key}`}
                  className="h-(--size-row) border-b border-hair px-4 text-ui text-ink"
                >
                  {f.availability === "available" && f.onFor > 0 ? "On by default" : "Off by default"}
                </td>
                <td
                  data-testid={`platflags-effective-${f.key}`}
                  className="h-(--size-row) border-b border-hair px-4 text-ui text-ink"
                >
                  {!practice ? (
                    <span className="inline-flex h-5 items-center rounded-full bg-hair px-2.25 text-xs text-mute">
                      choose a practice
                    </span>
                  ) : (
                    <span
                      className={`inline-flex h-5 items-center rounded-full px-2.25 text-xs ${
                        eff === true
                          ? "bg-ok-soft text-ok"
                          : "bg-hair text-mute"
                      }`}
                      data-effective={eff === true ? "on" : "off"}
                    >
                      {eff === true ? "On" : "Off"}
                      {ov ? " (override)" : " (default)"}
                    </span>
                  )}
                </td>
                <td className="h-(--size-row) border-b border-hair px-4 text-ui text-ink">
                  <input
                    type="text"
                    data-testid={`platflags-reason-${f.key}`}
                    placeholder="reason (optional)"
                    value={reasonDrafts[f.key] ?? ""}
                    onChange={(e) => {
                      reasonDrafts[f.key] = e.target.value;
                    }}
                    disabled={!practice || f.availability !== "available"}
                    className="w-full rounded-card border border-line bg-surface px-3 py-2 text-ui text-ink placeholder-mute disabled:bg-hair disabled:text-mute"
                  />
                </td>
                <td className="h-(--size-row) border-b border-hair px-4 text-right">
                  {f.availability === "blocked" || f.availability === "being_built" ? (
                    <DisabledWithReason disabled reason={f.availability === "blocked" ? "Blocked" : "Being built"}>
                      <Button variant="secondary" size="sm" disabled>
                        No action
                      </Button>
                    </DisabledWithReason>
                  ) : (
                    <div className="flex items-center gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={!practice || busyKey === f.key}
                        onClick={() => toggle && toggle(f.key, true)}
                        data-testid={`platflags-turn-on-${f.key}`}
                      >
                        On
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={!practice || busyKey === f.key}
                        onClick={() => toggle && toggle(f.key, false)}
                        data-testid={`platflags-turn-off-${f.key}`}
                      >
                        Off
                      </Button>
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
