import { Badge } from "@/lib/components/ui/badge.jsx";
import { Button } from "@/lib/components/ui/button.jsx";
import ErrorPanel from "@/lib/empty/ErrorPanel.jsx";

export default function SettingsSaveError({
  rows = [],
  reference = null,
  fields = {},
  onRetry = null,
  onRevert = null,
}) {
  // Construct the banner message from the refused row(s) — the first one that is refused.
  const refusedRow = rows.find((r) => r.state === "refused");
  const bannerText = refusedRow
    ? `That didn't save. ${refusedRow.label} is still ${JSON.stringify(refusedRow.stored)}, not ${JSON.stringify(refusedRow.attempted)}. Nothing else on this page was affected, and nothing is half-saved.`
    : "Changes didn't save.";

  return (
    <div className="flex flex-col gap-5" data-testid="settings-error" role="alert">
      <ErrorPanel
        error={{ message: bannerText, requestId: reference }}
        subject={null}
        variant="band"
        testId="settings-error"
        onRetry={onRetry}
        onTellSupport={null}
      />

      <div className="rounded-card border border-line bg-paper p-5">
        <div className="mb-1 text-heading font-medium text-ink">Money settings</div>
        <div className="mb-4 text-control text-mute">One change didn't go through.</div>

        <div className="mb-4 flex flex-col gap-3">
          {rows.map((row) => (
            <div
              key={row.key}
              className="flex items-center gap-4 rounded-lg border border-hair bg-surface p-3 h-10"
              data-testid={`error-row-${row.key}`}
            >
              <div className="flex-shrink-0 font-medium text-ink">{row.label}</div>
              <div className="flex-1 text-ui font-normal text-ink-2">
                {JSON.stringify(row.attempted ?? row.value)}
              </div>
              <div className="flex-shrink-0">
                {row.state === "refused" && (
                  <Badge variant="destructive">
                    Couldn't save. Reference {reference} — support can look it up.
                  </Badge>
                )}
                {row.state === "saved" && <Badge variant="outline">Saved.</Badge>}
              </div>
            </div>
          ))}
        </div>

        <div className="flex gap-[9px]">
          {onRetry && <Button onClick={onRetry}>Try again</Button>}
          {onRevert && (
            <Button variant="outline" onClick={onRevert}>
              Put it back to {refusedRow?.stored ?? "original"}
            </Button>
          )}
          <Button asChild variant="outline">
            <a href={`/help?ref=${reference}`}>Tell support</a>
          </Button>
        </div>
      </div>

      <div className="rounded-card bg-brand-soft px-4 py-3.5 text-control text-ink leading-[1.6] max-w-80">
        <strong>Nothing is half-saved.</strong> A settings change either lands completely or not at
        all — you will never end up with invoice terms that say one thing on screen and another in
        the email that goes out.
      </div>
    </div>
  );
}
