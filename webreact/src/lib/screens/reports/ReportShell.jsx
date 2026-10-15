// ═══════════════════════════════════════════════════════════════════════════════════════════════
// 16.37 — REPORTSHELL. Shared chrome for report screens.
//
// ★★★ BAND-INDEPENDENT ERROR HANDLING: Each panel snippet is responsible for resolving its own
//     data safely and rendering ErrorPanel internally if it has an error. ReportShell does not wrap
//     panels in try/catch (not idiomatic Svelte). Instead, calling screens pass already-resolved
//     data per panel, and each panel signals failure via a prop that triggers its local ErrorPanel.
//     This keeps one panel's failure from blanking the rest of the report.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useMemo } from "react";
import { api } from "@/lib/api.js";
import ScreenState from "@/lib/empty/ScreenState.jsx";
import ExportMenu from "@/lib/lists/ExportMenu.jsx";

export default function ReportShell({
  title = "",
  headline = "",
  name = "",
  range = "this-month",
  onRange = null,
  compare = false,
  onCompare = null,
  exportName = "",
  enough = false,
  emptyData = { days: 0, n: 0 },
  children = null,
}) {
  // Build export URL with current query params
  const exportUrl = useMemo(
    () => (exportName ? api.reportExportUrl(exportName, { range, compare }) : null),
    [exportName, range, compare],
  );

  // Export formats: CSV is a safe default for all report types
  const exportFormats = useMemo(
    () => [{ key: "csv", label: "CSV", includes: "All columns as a spreadsheet" }],
    [],
  );

  const handleExport = (key) => {
    if (exportUrl) {
      window.location.href = exportUrl;
    }
  };

  // ★★★ EMPTY STATE CONFIGURATION for ScreenState when enough=false
  const emptyBlock = useMemo(() => {
    if (enough) return null;
    return {
      kind: "first-run",
      headline: "Not enough has happened yet. Come back after your first month",
      line: `Reports compare one period against another, so they need something to compare against. You've been going ${emptyData.days} days and taken ${emptyData.n} payments — that's not a trend yet, it's ${emptyData.n} payments.`,
      action: {
        label: `See the ${emptyData.n} payments`,
        href: "/money/payments",
      },
    };
  }, [enough, emptyData]);

  return (
    <div className="flex flex-col gap-6">
      {/* Header with When pill, compare, and Export */}
      <div className="flex items-start justify-between gap-6">
        <div className="flex-1">
          <h1 className="m-0 text-page-title font-medium tracking-[-0.01em] text-ink">
            {title}
          </h1>
          {headline && (
            <p className="m-0 mt-1.5 text-sm text-mute">
              {headline}
            </p>
          )}
        </div>

        <div className="flex items-center gap-3 flex-shrink-0">
          {/* When pill/select */}
          <div className="inline-flex items-center gap-2">
            <label htmlFor="when-select" className="text-xs font-medium text-mute">
              When
            </label>
            <select
              id="when-select"
              value={range}
              onChange={(e) => onRange?.(e.target.value)}
              className="h-8.5 px-3 border border-line rounded-sm bg-white text-xs font-normal text-ink cursor-pointer"
            >
              <option value="this-month">This month</option>
              <option value="last-3-months">Last 3 months</option>
              <option value="this-quarter">This quarter</option>
              <option value="custom">Custom</option>
            </select>
          </div>

          {/* Compare toggle */}
          <div className="inline-flex items-center gap-2">
            <label htmlFor="compare-toggle" className="text-xs font-medium text-mute">
              Compare
            </label>
            <input
              id="compare-toggle"
              type="checkbox"
              checked={compare}
              onChange={(e) => onCompare?.(e.target.checked)}
              className="w-5 h-5 cursor-pointer"
            />
          </div>

          {/* Export menu */}
          {exportFormats.length > 0 && (
            <ExportMenu
              formats={exportFormats}
              onExport={handleExport}
              label="Export"
              busy={false}
            />
          )}
        </div>
      </div>

      {/* Content: empty state or children via ScreenState */}
      <div className="flex-1">
        <ScreenState
          phase={enough ? "ready" : "empty"}
          empty={emptyBlock}
          onNavigate={(href) => window.location.assign(href)}
        >
          {children}
        </ScreenState>

        {/* Secondary action link: "Export what there is" (shown in empty state footer) */}
        {!enough && exportUrl && (
          <div className="flex justify-center mt-5 pt-5 border-t border-line">
            <a href={exportUrl} className="text-sm text-ink no-underline hover:underline px-4 py-2">
              Export what there is
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
