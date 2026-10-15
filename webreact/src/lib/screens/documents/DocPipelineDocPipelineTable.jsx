import StatusBadge from "@/lib/components/kit/StatusBadge.jsx";

export default function DocPipelineDocPipelineTable({
  onNavigate,
  go,
  openRecord,
  fetchError,
  load,
  phase,
  typeLabel,
  draftBand,
  sentBand,
  openedBand,
  signedBand,
  displayPhase,
  summaryText,
  ageChip,
  remindersChip,
  openedChip,
  signedLine,
}) {
  return (
    <div className="flex gap-5.5 items-start" data-testid="pipeline-bands">
      {/* Drafted Band */}
      <div className="flex-1 min-w-0" data-testid="pipeline-band-drafted">
        <div className="flex items-center gap-2 mb-2.5">
          <b className="text-sm font-medium text-ink">Drafted</b>
          <span className="inline-flex items-center h-[21px] px-[9px] rounded-[5px] text-xs font-medium bg-mute-bg text-mute">
            {draftBand.length}
          </span>
        </div>
        <div className="flex flex-col gap-[9px]">
          {draftBand.map((row) => (
            <button
              key={row.id}
              type="button"
              className="flex flex-col items-start gap-1 w-full bg-surface border border-line rounded-[11px] p-[13px] text-left hover:bg-paper transition-colors"
              data-testid={`pipeline-row-${row.id}`}
              onClick={() => openRecord(row)}
            >
              <b className="text-sm font-medium text-ink">{row.subject ?? "—"}</b>
              <span className="text-xs text-mute leading-relaxed">{row.title}
                <br />
                {typeLabel(row)}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Sent Band */}
      <div className="flex-1 min-w-0" data-testid="pipeline-band-sent">
        <div className="flex items-center gap-2 mb-2.5">
          <b className="text-sm font-medium text-ink">Sent</b>
          <span className="inline-flex items-center h-[21px] px-[9px] rounded-[5px] text-xs font-medium bg-mute-bg text-mute">
            {sentBand.length}
          </span>
        </div>
        <div className="flex flex-col gap-[9px]">
          {sentBand.map((row) => (
            <button
              key={row.id}
              type="button"
              className="flex flex-col items-start gap-1 w-full bg-surface border border-line rounded-[11px] p-[13px] text-left hover:bg-paper transition-colors"
              data-testid={`pipeline-row-${row.id}`}
              onClick={() => openRecord(row)}
            >
              <b className="text-sm font-medium text-ink">{row.subject ?? "—"}</b>
              <span className="text-xs text-mute leading-relaxed">{row.title}
                <br />
                {ageChip(row) ?? "—"}
              </span>
              {remindersChip(row) && (
                <div className="mt-[9px]">
                  <StatusBadge label={remindersChip(row)} tone="warn" testId={`pipeline-reminders-${row.id}`} />
                </div>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Opened, Not Signed Band */}
      <div className="flex-1 min-w-0" data-testid="pipeline-band-opened">
        <div className="flex items-center gap-2 mb-2.5">
          <b className="text-sm font-medium text-ink">Opened, not signed</b>
          <span className="inline-flex items-center h-[21px] px-[9px] rounded-[5px] text-xs font-medium bg-mute-bg text-mute">
            {openedBand.length}
          </span>
        </div>
        <div className="flex flex-col gap-[9px]">
          {openedBand.map((row) => (
            <button
              key={row.id}
              type="button"
              className="flex flex-col items-start gap-1 w-full bg-surface border border-line rounded-[11px] p-[13px] text-left hover:bg-paper transition-colors"
              data-testid={`pipeline-row-${row.id}`}
              onClick={() => openRecord(row)}
            >
              <b className="text-sm font-medium text-ink">{row.subject ?? "—"}</b>
              <span className="text-xs text-mute leading-relaxed">{row.title}
                <br />
                {openedChip(row) ?? "—"}
              </span>
              <div className="mt-[9px]">
                <StatusBadge label="Read it, didn't sign" tone="warn" testId={`pipeline-readnotsigned-${row.id}`} />
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Signed Band */}
      <div className="flex-1 min-w-0" data-testid="pipeline-band-signed">
        <div className="flex items-center gap-2 mb-2.5">
          <b className="text-sm font-medium text-ink">Signed</b>
          <span className="inline-flex items-center h-[21px] px-[9px] rounded-[5px] text-xs font-medium bg-mute-bg text-mute">
            {signedBand.length}
          </span>
        </div>
        <div className="flex flex-col gap-[9px]">
          {signedBand.map((row) => (
            <button
              key={row.id}
              type="button"
              className="flex flex-col items-start gap-1 w-full bg-surface border border-line rounded-[11px] p-[13px] text-left hover:bg-paper transition-colors"
              data-testid={`pipeline-row-${row.id}`}
              onClick={() => openRecord(row)}
            >
              <b className="text-sm font-medium text-ink">{row.subject ?? "—"}</b>
              <span className="text-xs text-mute leading-relaxed">{row.title}
                <br />
                {signedLine(row)}
              </span>
              <div className="mt-[9px]">
                <StatusBadge label="Done" tone="ok" testId={`pipeline-done-${row.id}`} />
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
