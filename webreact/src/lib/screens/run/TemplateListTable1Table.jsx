// ═══════════════════════════════════════════════════════════════════════════════════════════════
// TemplateListTable1Table — the templates list table component. Ported from
// webui/src/lib/screens/run/TemplateList.svelte lines 128-179. Renders a simple data table
// for displaying templates with edit functionality.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

import { Check } from "lucide-react";
import RowActions from "@/lib/lists/RowActions.jsx";

export default function TemplateListTable1Table({ rows = [], handleEdit = null }) {
  return (
    <div className="bg-white border border-line rounded-card overflow-hidden">
      <table className="w-full border-collapse">
        <thead>
          <tr>
            <th className="h-9.5 px-4 text-left font-medium text-label uppercase text-mute border-b border-line bg-surface-2">Template</th>
            <th className="h-9.5 px-4 text-left font-medium text-label uppercase text-mute border-b border-line bg-surface-2">Key</th>
            <th className="h-9.5 px-4 text-left font-medium text-label uppercase text-mute border-b border-line bg-surface-2">Where it's used</th>
            <th className="h-9.5 px-4 text-left font-medium text-label uppercase text-mute border-b border-line bg-surface-2">Versions</th>
            <th className="h-9.5 px-4 text-left font-medium text-label uppercase text-mute border-b border-line bg-surface-2">Active</th>
            <th className="h-9.5 px-4 text-right font-medium text-label uppercase text-mute border-b border-line bg-surface-2"></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className="border-b border-hair last:[&>td]:border-b-0">
              {/* ★ the maintainer, 29 Sep 2026 — was `text-accent`, which resolves to `--color-brand-soft` (the
                 SUBTLE hover tint, not a real link color) against a white cell — nearly invisible.
                 `text-brand` is the same bold purple every other list-row link in this app uses
                 (PeopleLedgerPeopleLedgerTable.jsx's name cell, for one). */}
              <td className="h-11.5 px-4 border-b border-hair cursor-pointer" onClick={() => handleEdit?.(row.key)}>
                <div className="text-ui text-brand hover:underline">{row.name}</div>
                {/* ★ the maintainer, 1 Oct 2026 — "a one-line description of when it sends and who gets it" */}
                {row.description && <div className="text-xs text-mute mt-0.5">{row.description}</div>}
              </td>
              <td className="h-11.5 px-4 text-ui text-mute border-b border-hair font-mono text-sm">{row.key}</td>
              <td className="h-11.5 px-4 text-ui text-ink border-b border-hair">{row.usedBy}</td>
              <td className="h-11.5 px-4 text-ui text-ink border-b border-hair font-tabular-nums">{row.versions}</td>
              <td className="h-11.5 px-4 text-ui text-ink border-b border-hair">
                {/* ★ the maintainer, 29 Sep 2026 — was the literal text "v2": a letter "v", not a tick, where a
                   glance should read "this one is live." A real check mark, plus the version number
                   as a secondary fact rather than the headline. */}
                <span className="inline-flex items-center gap-1 text-ok">
                  <Check className="size-3.5" strokeWidth={2.5} aria-hidden="true" />
                  <span className="text-ink">Version {row.activeVersion}</span>
                </span>
                {row.origin === "Edited" && (
                  <span className="ml-2 inline-flex items-center h-5.25 px-2 rounded-full border border-line text-label font-medium text-warn bg-warn-soft">Edited</span>
                )}
              </td>
              <td className="h-11.5 px-4 text-right text-mute border-b border-hair">
                <RowActions actions={[{ id: "edit", label: "Open", onRun: () => handleEdit?.(row.key) }]} row={row} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
