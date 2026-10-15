// ═══════════════════════════════════════════════════════════════════════════════════════════════
// MergeDialogMergePreviewModal — preview before merge, built on DecisionModal. Shows loading,
// two comparison cards (survivor/loser), what happens, and evidence.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import DecisionModal from "@/lib/forms/DecisionModal.jsx";
import { Badge } from "@/lib/components/ui/badge.jsx";
import { Skeleton } from "@/lib/components/ui/skeleton.jsx";

export default function MergeDialogMergePreviewModal({
  open,
  onOpenChange,
  onCancel,
  loading,
  busy,
  error,
  preview,
  formatDate,
  survivorName,
  loserName,
  emailField,
  phoneField,
  createdField,
  uiBusy,
  handleDismiss,
  handleMerge,
}) {
  return (
    <DecisionModal
      open={open}
      onOpenChange={onOpenChange}
      title={
        preview
          ? `Two records look like the same person — ${survivorName} and ${loserName}. Check before you merge.`
          : "Two records look like the same person"
      }
      subtitle={preview ? "Pick which details to keep. Everything else — sessions, invoices, documents, notes — moves across either way." : null}
      cancelLabel="Not the same person"
      confirmLabel="Merge them"
      busy={uiBusy}
      error={error}
      wide={true}
      testId="merge-preview"
      onCancel={handleDismiss}
      onConfirm={handleMerge}
    >
      {loading && (
        <div data-testid="merge-preview-loading" className="flex flex-col gap-3">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
      )}
      {!loading && preview && (
        <>
          <div data-testid="merge-preview-cards" className="flex gap-3 mb-4">
            <div
              data-testid="merge-preview-card-survivor"
              className="flex-1 border border-brand bg-brand-soft rounded-lg p-3.5"
            >
              <div className="flex items-center justify-between gap-2 mb-2">
                <b className="text-sm font-medium text-ink">{survivorName}</b>
                <Badge variant="default">Keep this one</Badge>
              </div>
              <div className="space-y-1.5 text-sm">
                <div className="flex justify-between">
                  <span className="text-mute">Email</span>
                  <span className="text-ink">{emailField?.survivorValue || "None"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-mute">Phone</span>
                  <span className="text-ink">{phoneField?.survivorValue || "None"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-mute">Added</span>
                  <span className="text-ink">{formatDate(createdField?.survivorValue)}</span>
                </div>
              </div>
            </div>

            <div
              data-testid="merge-preview-card-loser"
              className="flex-1 border border-line rounded-lg p-3.5 bg-white"
            >
              <div className="flex items-center justify-between gap-2 mb-2">
                <b className="text-sm font-medium text-ink">{loserName}</b>
                <Badge variant="outline">Fold into the other</Badge>
              </div>
              <div className="space-y-1.5 text-sm">
                <div className="flex justify-between">
                  <span className="text-mute">Email</span>
                  <span className="text-ink">{emailField?.loserValue || "None"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-mute">Phone</span>
                  <span className="text-ink">{phoneField?.loserValue || "None"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-mute">Added</span>
                  <span className="text-ink">{formatDate(createdField?.loserValue)}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-brand-soft rounded-lg px-4 py-3.5 text-sm mb-6 text-brand">
            <b>After this.</b> One person, combined data, all email addresses kept. Her portal login stays the one she already uses. You have 30 days to undo it.
          </div>

          <div className="space-y-6">
            <section data-testid="merge-preview-happens" className="space-y-2">
              <h3 className="font-medium text-ink text-sm">What happens if you merge</h3>
              {preview.whatHappens?.map((row, i) => (
                <div
                  key={i}
                  data-testid={`merge-preview-happens-${i}`}
                  className="flex items-center justify-between gap-2 py-2 border-b border-hair last:border-0"
                >
                  <div className="flex-1">
                    <b className="text-sm text-ink">{row.label}</b>
                    <span className="text-xs text-mute">{row.detail}</span>
                  </div>
                  <Badge variant={row.verdict === "kept" ? "default" : "outline"}>
                    {row.verdict === "kept" ? "Kept" : "Dropped"}
                  </Badge>
                </div>
              ))}
            </section>

            <section data-testid="merge-preview-evidence" className="space-y-2">
              <h3 className="font-medium text-ink text-sm">Why we think it's the same person</h3>
              {preview.evidence?.length > 0 ? (
                <>
                  {preview.evidence.map((row, i) => (
                    <div
                      key={i}
                      data-testid={`merge-preview-evidence-${i}`}
                      className="py-2 border-b border-hair last:border-0"
                    >
                      <b className="text-sm text-ink">{row.label}</b>
                      {row.detail && <span className="text-xs text-mute block mt-1">{row.detail}</span>}
                    </div>
                  ))}
                </>
              ) : (
                <p data-testid="merge-preview-evidence-none" className="text-sm text-mute py-2">
                  You searched for this pair yourself — nothing else matched.
                </p>
              )}
              <div
                data-testid="merge-preview-undo-until"
                className="py-2"
              >
                <b className="text-sm text-ink">
                  You can undo this until {formatDate(preview.undoUntil)}
                </b>
              </div>
            </section>
          </div>
        </>
      )}
    </DecisionModal>
  );
}
