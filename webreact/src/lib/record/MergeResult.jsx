// ═══════════════════════════════════════════════════════════════════════════════════════════════
// 12.25 — MERGERESULT. Ported from `specs/mockups/MergeResult.frame.html`. Pure presentation: the
// caller (`MergeDialog.jsx`) supplies everything, including the Undo handler — this component
// makes no network call of its own.
//
// ★★★ MERGE RE-POINTS AND PRESERVES. IT NEVER DELETES REAL CLIENT DATA. This screen exists so the
//     person who just merged can see, in plain language, that nothing was thrown away — every row
//     under "What came across" is real data that still exists, and "What was dropped" is the one
//     genuinely superseded field (the second record's created date), never a warning that data was
//     destroyed.
//
// ★ `cameAcross`/`dropped` are `previewMerge`'s own `whatHappens` rows (`src/records/merge.mjs`),
//   split by `verdict` — this component does not recompute anything, only renders what the server
//   already decided. `undoUntil` is `previewMerge`'s own deadline, captured moments before the
//   merge actually ran — close enough to the real `person_merge_tombstone.undo_deadline` (merge
//   time + 30 days, `src/records/merge.mjs:451`) to show as the real date, never a vague "30 days".
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { Badge } from "@/lib/components/ui/badge.jsx";
import { Button } from "@/lib/components/ui/button.jsx";

function formatDate(iso) {
  if (!iso) return "the deadline";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });
}

export default function MergeResult({
  survivorName,
  cameAcross = [],
  dropped = [],
  undoUntil = null,
  busy = false,
  onUndo,
  onClose = null,
  testId = "merge-result",
}) {
  const undoUntilText = formatDate(undoUntil);

  return (
    <div
      className="flex flex-col gap-4"
      data-testid={testId}
    >
      {/* ★ THE SUCCESS BANNER — "✓ Merged. One {name} ... You have until {date} to undo it." Both the
          name and the real deadline are rendered, never omitted for a generic "It worked." */}
      <div
        className="flex gap-4 items-start p-4 rounded-lg bg-success-50 text-success-700 text-sm leading-relaxed"
        data-testid={`${testId}-banner`}
        role="status"
      >
        <span className="flex-shrink-0" aria-hidden="true">✓</span>
        <span>
          <strong>Merged.</strong> One {survivorName}, with everything from both records. You have until{" "}
          {undoUntilText} to undo it.
        </span>
      </div>

      {cameAcross.length > 0 && (
        <section className="flex flex-col gap-1" data-testid={`${testId}-came-across`}>
          <h3 className="m-0 text-base font-medium text-ink">What came across</h3>
          <div className="flex flex-col">
            {cameAcross.map((row, i) => (
              <div
                key={row.label + i}
                className="flex items-center gap-4 py-2.5 border-b border-structure-150 last:border-b-0"
                data-testid={`${testId}-came-${i}`}
              >
                <span className="flex-1 flex flex-col gap-0.5 text-sm">
                  <b className="text-ink font-medium">{row.label}</b>
                  <span className="text-structure-550 text-xs">{row.detail}</span>
                </span>
                <Badge variant="default">Kept</Badge>
              </div>
            ))}
          </div>
        </section>
      )}

      {dropped.length > 0 && (
        <section className="flex flex-col gap-1" data-testid={`${testId}-dropped`}>
          <h3 className="m-0 text-base font-medium text-ink">What was dropped</h3>
          <div className="flex flex-col">
            {dropped.map((row, i) => (
              <div
                key={row.label + i}
                className="flex items-center gap-4 py-2.5 border-b border-structure-150 last:border-b-0"
                data-testid={`${testId}-dropped-${i}`}
              >
                <span className="flex-1 flex flex-col gap-0.5 text-sm">
                  <b className="text-ink font-medium">{row.label}</b>
                  <span className="text-structure-550 text-xs">{row.detail}</span>
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="flex flex-col gap-1" data-testid={`${testId}-if-wrong`}>
        <h3 className="m-0 text-base font-medium text-ink">If this was wrong</h3>
        <div className="flex items-center gap-4 py-2.5">
          <span className="flex-1 flex flex-col gap-0.5 text-sm">
            <b className="text-ink font-medium">Undo puts both back</b>
            <span className="text-structure-550 text-xs">Exactly as they were, until {undoUntilText}.</span>
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-testid={`${testId}-undo`}
            disabled={busy}
            onClick={() => onUndo?.()}
          >
            {busy ? "Undoing…" : "Undo"}
          </Button>
        </div>
      </section>

      {onClose && (
        <div className="flex justify-end pt-1">
          <Button
            type="button"
            variant="default"
            size="default"
            data-testid={`${testId}-close`}
            disabled={busy}
            onClick={() => onClose?.()}
          >
            Done
          </Button>
        </div>
      )}
    </div>
  );
}
