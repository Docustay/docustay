import { Badge } from "@/lib/components/ui/badge.jsx";
import { Button } from "@/lib/components/ui/button.jsx";
import { plainReason } from "@/lib/settings/plainReason.js";

// A row from the server carries {key, state, reason}; the older demo rows carry label/stored/attempted. `fields` is the screen's field list.
const fieldOf = (fields, key) => (Array.isArray(fields) ? fields.find((f) => f.key === key) : null);
const shown = (v) => (typeof v === "string" ? v : JSON.stringify(v));

export default function SettingsSaveError({
  rows = [],
  reference = null,
  fields = {},
  title = null,
  onRetry = null,
  onRevert = null,
}) {
  // Construct the banner message from the refused row(s) — the first one that is refused.
  const refusedRow = rows.find((r) => r.state === "refused");
  const labelOf = (row) => row.label ?? fieldOf(fields, row.key)?.label ?? row.key;
  const refusedHasValues = refusedRow && refusedRow.attempted !== undefined && refusedRow.stored !== undefined;
  const bannerText = !refusedRow
    ? "Changes didn't save."
    : refusedHasValues
      ? `${labelOf(refusedRow)} is still ${shown(refusedRow.stored)}, not ${shown(refusedRow.attempted)}. Nothing else on this page was affected, and nothing is half-saved.`
      : `${labelOf(refusedRow)}: ${plainReason(fieldOf(fields, refusedRow.key) ?? { label: labelOf(refusedRow) }, refusedRow.reason)} Nothing was saved.`;

  return (
    <div className="flex flex-col gap-5" data-testid="settings-error" role="alert">
      {/* A refusal is the server telling the person what to change — not an outage — so it is not the "This didn't load / It's us" panel. */}
      <div className="flex flex-col gap-2 rounded-card border border-bad-border bg-bad-bg p-5" data-state="error" data-variant="band" data-testid="settings-error-band">
        <p className="m-0 text-heading font-medium text-ink">That didn't save.</p>
        <p className="m-0 text-ui text-ink-2">{bannerText}</p>
        {reference && <p className="m-0 text-meta text-mute">Reference: <code>{reference}</code></p>}
      </div>

      <div className="rounded-card border border-line bg-paper p-5">
        <div className="mb-1 text-heading font-medium text-ink">{title ?? "Settings"}</div>
        <div className="mb-4 text-control text-mute">One change didn't go through.</div>

        <div className="mb-4 flex flex-col gap-3">
          {rows.map((row) => (
            <div
              key={row.key}
              className="flex items-center gap-4 rounded-lg border border-hair bg-surface p-3 min-h-10"
              data-testid={`error-row-${row.key}`}
            >
              <div className="flex-shrink-0 font-medium text-ink">{labelOf(row)}</div>
              <div className="flex-1 text-ui font-normal text-ink-2">
                {row.state === "refused" && row.reason ? plainReason(fieldOf(fields, row.key) ?? { label: labelOf(row) }, row.reason) : (row.attempted ?? row.value) === undefined ? "" : shown(row.attempted ?? row.value)}
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
              {refusedRow?.stored !== undefined ? `Put it back to ${shown(refusedRow.stored)}` : "Put it back"}
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
