import { LedgerPage } from "@/lib/components/kit/archetypes/index.js";
import ScreenState from "@/lib/empty/ScreenState.jsx";
import StatusBadge from "@/lib/components/kit/StatusBadge.jsx";

export default function OptionsPageOptionsPageTable({
  onNavigate,
  isCoach,
  phase,
  error,
  rows,
  displayPhase,
  emptyProp,
  handleEmptyNavigate,
  chipFor,
  descriptionFor,
  conditionalNote,
  rowActionable,
  question,
  openCreate,
  openEdit,
}) {
  return (
    <LedgerPage
      title="Options"
      summary="Choices that change nothing about the price. You just need to know."
      primary={isCoach ? null : { label: "New option", onClick: openCreate }}
      testId="options-page"
    >
      <ScreenState
        phase={displayPhase}
        error={phase === "error" ? error : null}
        reason={phase === "denied" ? (error?.message ?? null) : null}
        empty={emptyProp}
        onNavigate={handleEmptyNavigate}
      >
        {displayPhase === "ready" && (
          <div>
            <p className="text-sm text-mute leading-7 mb-5.5 max-w-70ch" data-testid="options-definition">
              An option is a question asked at booking whose answer you want on the day.
              <b className="font-medium text-ink"> If the answer changes the price, it is a modifier instead.</b>
            </p>

            <div className="flex gap-5.5 items-start">
              <div className="flex-1 min-w-0 flex flex-col gap-4.5">
                <div className="bg-surface border border-line rounded-card">
                  <div className="flex items-center gap-2.5 px-4.25 py-3.5 border-b border-hair font-medium">
                    <b>Asked at booking</b>
                  </div>
                  <div className="px-4.25 pb-3.5 pt-1.5">
                    {rows.map((row) => {
                      const chip = chipFor(row);
                      const note = conditionalNote(row);
                      return (
                        <button
                          key={row.id}
                          type="button"
                          className="flex items-center gap-3 min-h-9.5 py-2.75 px-0 border-b border-hair w-full bg-none text-left font-inherit color-inherit cursor-pointer disabled:cursor-default"
                          data-testid="options-row"
                          data-id={row.id}
                          disabled={!rowActionable(row)}
                          onClick={() => openEdit(row)}
                        >
                          <span className="flex-1 min-w-0 text-sm" data-testid={`options-question-${row.id}`}>
                            {row.question}
                            <span className="block text-xs text-mute mt-0.5">
                              {descriptionFor(row)}{note ? ` ${note}` : ""}
                            </span>
                          </span>
                          <StatusBadge label={chip.label} tone={chip.tone} testId={`options-chip-${row.id}`} />
                          {rowActionable(row) && (
                            <span className="text-mute text-sm" aria-hidden="true">›</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="bg-surface border border-line rounded-card">
                  <div className="flex items-center gap-2.5 px-4.25 py-3.5 border-b border-hair font-medium">
                    <b>Where the answers end up</b>
                  </div>
                  <div className="px-4.25 pb-3.5 pt-1.5">
                    <div className="flex items-center gap-3 min-h-9.5 py-2.75 px-0 border-b border-hair">
                      <span className="flex-1 min-w-0 text-sm">
                        On the session
                        <span className="block text-xs text-mute mt-0.5">The coach sees them before the client walks in</span>
                      </span>
                    </div>
                    <div className="flex items-center gap-3 min-h-9.5 py-2.75 px-0 border-b border-hair">
                      <span className="flex-1 min-w-0 text-sm">
                        On the client's record
                        <span className="block text-xs text-mute mt-0.5">The first answer is kept as a default for next time</span>
                      </span>
                    </div>
                    <div className="flex items-center gap-3 min-h-9.5 py-2.75 px-0">
                      <span className="flex-1 min-w-0 text-sm">
                        In reports
                        <span className="block text-xs text-mute mt-0.5">"How did you hear about us" is what the leads report is built on</span>
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="w-80 flex-none flex flex-col gap-4.5">
                <div className="bg-surface border border-line rounded-card">
                  <div className="flex items-center gap-2.5 px-4.25 py-3.5 border-b border-hair font-medium">
                    <b>Keep it short</b>
                  </div>
                  <div className="px-4.25 pb-3.5 pt-1.5">
                    <div className="flex items-center gap-3 min-h-9.5 py-2.75 px-0 border-b border-hair">
                      <span className="flex-1 min-w-0 text-sm">
                        Four is about the limit
                        <span className="block text-xs text-mute mt-0.5">Every question is one more reason to abandon a booking halfway</span>
                      </span>
                    </div>
                    <div className="flex items-center gap-3 min-h-9.5 py-2.75 px-0">
                      <span className="flex-1 min-w-0 text-sm">
                        Ask once, not every time
                        <span className="block text-xs text-mute mt-0.5">Anything you already know is not asked again</span>
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </ScreenState>
    </LedgerPage>
  );
}
