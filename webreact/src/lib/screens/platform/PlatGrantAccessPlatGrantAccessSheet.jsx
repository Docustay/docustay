// ═══════════════════════════════════════════════════════════════════════════════════════════════
// PlatGrantAccessPlatGrantAccessSheet — the sheet for asking to look at a practice's account.
// Ported from webui/src/lib/screens/platform/PlatGrantAccess.svelte:80-149.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import SideSheet from "@/lib/forms/SideSheet.jsx";
import { SheetSection } from "@/lib/components/kit/SheetRow.jsx";
import SheetRow from "@/lib/components/kit/SheetRow.jsx";
import { Button } from "@/lib/components/ui/button.jsx";

export default function PlatGrantAccessPlatGrantAccessSheet({
  open,
  onOpenChange,
  practiceName,
  why,
  durationMinutes,
  isLoading,
  fieldError,
  conflictError,
  durationOptions,
  handleClose,
  handleSubmit,
  onWhyChange,
  onDurationMinutesChange,
}) {
  if (!open) return null;

  return (
    <SideSheet
      title={`Ask to look at ${practiceName}'s account`}
      subtitle="They get an email straight away, and it shows in their activity log whether they read it or not."
      onCancel={handleClose}
      onSave={handleSubmit}
      cancelLabel="Cancel"
      busy={isLoading}
      dirty={!!(why && why.trim())}
      testId="plat-grant-access-sheet"
      footer={(
        <footer className="sticky bottom-0 flex shrink-0 justify-end gap-2.5 border-t border-line bg-surface px-5.5 py-4">
          <Button
            type="button"
            variant="outline"
            onClick={handleClose}
            disabled={isLoading}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={!why.trim().length || why.trim().length < 10 || isLoading}
            data-testid="plat-grant-access-sheet-save"
            onClick={handleSubmit}
          >
            {isLoading ? "Asking…" : "Ask for access"}
          </Button>
        </footer>
      )}
    >
      <SheetSection>
        {/* Why field */}
        <SheetRow label="Why" required>
          <textarea
            className="w-full min-h-[100px] resize-vertical rounded-lg border border-line bg-surface px-3 py-2.5 text-field font-normal placeholder-placeholder focus:border-primary focus:outline-none focus:ring-3 focus:ring-primary-subtle disabled:opacity-50"
            value={why}
            onChange={(e) => onWhyChange?.(e.target.value)}
            placeholder=""
            disabled={isLoading}
            rows="4"
          />
          <p className="mt-1.5 text-meta leading-normal text-mute">
            They see this. Write it as though they're reading it, because they are.
          </p>
          {fieldError && (
            <div className="mt-1.5 text-meta text-bad" role="alert">
              {fieldError}
            </div>
          )}
          {conflictError && (
            <div className="mt-1.5 text-meta text-bad" role="alert">
              {conflictError}
            </div>
          )}
        </SheetRow>

        {/* For how long field */}
        <SheetRow label="For how long" required>
          <select
            className="w-full h-10 rounded-lg border border-line bg-surface px-3 py-0 text-field font-normal focus:border-primary focus:outline-none focus:ring-3 focus:ring-primary-subtle disabled:opacity-50"
            value={durationMinutes}
            onChange={(e) => onDurationMinutesChange?.(e.target.value)}
            disabled={isLoading}
          >
            {durationOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <p className="mt-1.5 text-meta leading-normal text-mute">
            It ends on its own. You can end it sooner.
          </p>
        </SheetRow>

        {/* Read only row (no control) */}
        <div className="flex items-start gap-3 py-2.5">
          <div className="flex-1 min-w-0">
            <div className="text-ui text-ink-2">
              Read only
              <div className="mt-0.75 text-caption text-mute">
                You'll see what they see and change nothing. Turning this off has to be justified separately.
              </div>
            </div>
          </div>
          <div className="w-9 h-5.25 rounded-full bg-primary flex-shrink-0 relative mt-0.25">
            <div className="absolute right-0.75 top-0.75 w-3.75 h-3.75 rounded-full bg-surface" />
          </div>
        </div>

        {/* Logging paragraph */}
        <div className="rounded-lg bg-warn-soft px-4 py-3.25 mt-3 text-caption leading-normal text-warn">
          <b className="font-semibold">Everything you do is logged.</b> Every screen you open and every record you read appears in their log with your name on it. That is the point — it is their business and their clients' information.
        </div>
      </SheetSection>
    </SideSheet>
  );
}
