// ═══════════════════════════════════════════════════════════════════════════════════════════════
// R8.040.T1 — PlatFlags › PlatFlagsLedgerPlatformFlagsTable: the table as its own component
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useState } from "react";

export default function PlatFlagsLedgerPlatformFlagsTable({
  flags = [],
  practice = null,
  formatSince = null,
  formatOnFor = null,
  getStateBadge = null,
  blockedFlags = [],
  summary = null,
}) {
  const [openRowMenu, setOpenRowMenu] = useState(null);

  return (
    <div className="overflow-auto rounded-card border border-line bg-surface">
      <table className="w-full border-collapse" data-testid="platflags-catalog-table">
        <thead>
          <tr>
            <th scope="col" className="h-(--size-row-head) border-b border-line bg-surface-2 px-4 text-left text-caption font-medium text-mute">
              Switch
            </th>
            <th scope="col" className="h-(--size-row-head) border-b border-line bg-surface-2 px-4 text-left text-caption font-medium text-mute">
              What it does
            </th>
            <th scope="col" className="h-(--size-row-head) border-b border-line bg-surface-2 px-4 text-left text-caption font-medium text-mute">
              On for
            </th>
            <th scope="col" className="h-(--size-row-head) border-b border-line bg-surface-2 px-4 text-left text-caption font-medium text-mute">
              Since
            </th>
            <th scope="col" className="h-(--size-row-head) border-b border-line bg-surface-2 px-4 text-left text-caption font-medium text-mute">
              State
            </th>
            <th scope="col" className="h-(--size-row-head) border-b border-line bg-surface-2 px-4"></th>
          </tr>
        </thead>
        <tbody>
          {flags.map((flag) => {
            const badge = getStateBadge ? getStateBadge(flag) : null;
            return (
              <tr
                key={flag.key}
                data-testid={`platflags-catalog-row-${flag.key}`}
                data-flag-key={flag.key}
                className="border-b border-hair last:[&>td]:border-b-0"
              >
                <td
                  data-testid={`platflags-switch-${flag.key}`}
                  className="h-(--size-row) border-b border-hair px-4 text-ui font-medium text-ink"
                >
                  {flag.label ?? flag.key}
                </td>
                <td
                  data-testid={`platflags-description-${flag.key}`}
                  className="h-(--size-row) border-b border-hair px-4 text-ui text-ink"
                >
                  {flag.description}
                </td>
                <td
                  data-testid={`platflags-on-for-${flag.key}`}
                  className="h-(--size-row) border-b border-hair px-4 text-ui text-ink"
                >
                  {formatOnFor ? formatOnFor(flag.onFor) : "—"}
                </td>
                <td
                  data-testid={`platflags-since-${flag.key}`}
                  className="h-(--size-row) border-b border-hair px-4 text-ui text-ink"
                >
                  {formatSince ? formatSince(flag.since) : "—"}
                </td>
                <td
                  data-testid={`platflags-state-${flag.key}`}
                  className="h-(--size-row) border-b border-hair px-4 text-ui text-ink"
                >
                  {badge && (
                    <div className="inline-flex">
                      <span
                        className={`inline-flex h-5 items-center rounded-full px-2.25 text-xs font-medium ${
                          badge.tone === "ok"
                            ? "bg-ok-soft text-ok"
                            : badge.tone === "act"
                            ? "bg-brand-soft text-brand"
                            : badge.tone === "bad"
                            ? "bg-bad-soft text-bad"
                            : "bg-hair text-mute"
                        }`}
                      >
                        {badge.label}
                      </span>
                    </div>
                  )}
                </td>
                <td className="h-(--size-row) border-b border-hair px-4 text-right">
                  <button
                    type="button"
                    className="text-mute hover:text-ink"
                    onClick={() => {
                      const pickerEl = document.querySelector('[data-testid="platflags-picker"]');
                      if (pickerEl) pickerEl.scrollIntoView({ behavior: "smooth" });
                    }}
                  >
                    ⋯
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
