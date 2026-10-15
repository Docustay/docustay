// ═══════════════════════════════════════════════════════════════════════════════════════════════
// StageBoard — The documents pipeline, drawn as a pipeline (read-only, no drag).
// Ported from webui/src/lib/screens/StageBoard.svelte: same props, testids and copy.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useMemo } from "react";
import { formatValue } from "@/lib/format.js";

export default function StageBoard({ view, rows = [], onOpen = null, actions = null }) {
  const safeRows = useMemo(() => (Array.isArray(rows) ? rows : []), [rows]);

  // ★★★ THE STAGES COME FROM THE DESCRIPTOR, WHICH SITS BESIDE THE QUERY THAT PRODUCES THEM.
  //     A hardcoded list here would be a second copy of the SQL's `state IN (…)`, and the copy
  //     is always the one that drifts.
  const declared = useMemo(
    () => (Array.isArray(view?.stages) ? view.stages : []),
    [view?.stages]
  );

  // ★★★ AND ANY STAGE THE DATA CONTAINS THAT THE DESCRIPTOR DID NOT DECLARE GETS ITS OWN COLUMN.
  //     This is the assertion that matters most: a board that silently drops an unrecognised stage
  //     looks perfect. A document that fell out of the board is a document nobody chases.
  const stages = useMemo(() => {
    const declaredValues = new Set(declared.map((s) => s.value));
    const undeclared = [
      ...new Set(
        safeRows
          .map((r) => r.state)
          .filter((v) => v && !declaredValues.has(v))
      ),
    ]
      .map((value) => ({
        value,
        label: value,
        hint: null,
        undeclared: true,
      }))
      .sort();
    return [...declared, ...undeclared];
  }, [declared, safeRows]);

  const inStage = (stageValue) =>
    safeRows.filter((r) => r.state === stageValue);

  // Empty board: no stages declared
  if (stages.length === 0) {
    return (
      <section
        className="space-y-4"
        data-testid="stage-board"
        data-rows={safeRows.length}
      >
        <header className="border-b border-line pb-4">
          <h1 className="text-lg font-semibold">
            {view?.title ?? "Pipeline"}
          </h1>
        </header>
        <p
          className="text-control text-mute"
          data-testid="board-no-stages"
        >
          {view?.emptyState?.line ??
            view?.empty ??
            "Nothing is out for signature or completion."}
        </p>
      </section>
    );
  }

  // Full board with stages
  return (
    <section
      className="space-y-4"
      data-testid="stage-board"
      data-rows={safeRows.length}
      data-stages={stages.length}
    >
      <header className="border-b border-line pb-4">
        <div className="flex items-end justify-between gap-4">
          <div className="flex-1 min-w-0">
            <h1 className="text-lg font-semibold">
              {view?.title ?? "Pipeline"}
            </h1>
            {safeRows.length > 0 && (
              <p
                className="mt-1.25 text-control text-mute"
                data-testid="list-count"
              >
                {safeRows.length === 1
                  ? "1 record"
                  : `${safeRows.length} records`}
              </p>
            )}
          </div>
          {actions && (
            <div
              className="flex items-center gap-2"
              data-testid="list-actions"
            >
              {actions}
            </div>
          )}
        </div>
      </header>

      <div className="flex gap-4 overflow-x-auto pb-4">
        {stages.map((stage) => {
          const mine = inStage(stage.value);
          return (
            <section
              key={stage.value}
              className="flex-shrink-0 w-80 space-y-3"
              data-testid={`board-stage-${stage.value}`}
              data-count={mine.length}
              data-undeclared={stage.undeclared ? "true" : undefined}
            >
              <header className="flex items-baseline justify-between gap-2 border-b border-line pb-2">
                <span className="font-semibold text-control">
                  {stage.label}
                </span>
                <span className="text-sm text-mute">{mine.length}</span>
              </header>

              {stage.hint && (
                <p className="text-sm text-mute">{stage.hint}</p>
              )}

              {stage.undeclared && (
                <p
                  className="text-sm text-mute"
                  data-testid={`board-undeclared-${stage.value}`}
                >
                  This stage is in the data but not declared by the list. Both
                  should be updated.
                </p>
              )}

              <ul className="space-y-2">
                {mine.length === 0 ? (
                  <li
                    className="py-8 text-center text-sm text-mute"
                    data-testid={`board-empty-${stage.value}`}
                  >
                    Nothing here.
                  </li>
                ) : (
                  mine.map((row) => (
                    <li key={row.id}>
                      <button
                        type="button"
                        className="w-full p-3 rounded border border-line bg-surface hover:bg-surface-hover text-left space-y-1 transition-colors"
                        data-testid={`board-card-${row.id}`}
                        onClick={() =>
                          onOpen?.(view?.recordType, row.id)
                        }
                      >
                        <span className="block text-xs text-mute truncate">
                          {row.subject ?? "—"}
                        </span>
                        <span className="block font-semibold text-control truncate">
                          {row.title ?? "—"}
                        </span>
                        <span className="block text-xs text-mute">
                          {formatValue(row.sent_at, "date", {
                            empty: "—",
                          })}
                          {typeof row.age_days === "number" && (
                            <span data-days={row.age_days}>
                              {" · "}
                              {row.age_days}{" "}
                              {row.age_days === 1 ? "day" : "days"}
                            </span>
                          )}
                        </span>
                      </button>
                    </li>
                  ))
                )}
              </ul>
            </section>
          );
        })}
      </div>

      {safeRows.length === 0 && (
        <p
          className="text-center text-control text-mute py-8"
          data-testid="list-empty"
        >
          {view?.emptyState?.headline ??
            view?.empty ??
            "Nothing is out for signature or completion."}
        </p>
      )}
    </section>
  );
}
