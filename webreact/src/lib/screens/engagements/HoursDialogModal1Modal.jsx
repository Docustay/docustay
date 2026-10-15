// ═══════════════════════════════════════════════════════════════════════════════════════════════
// HoursDialogModal1Modal — the modal for working hours, extracted from HoursDialog.
// Ported from webui/src/lib/screens/engagements/HoursDialog.svelte:160-229
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/lib/components/ui/dialog.jsx";
import { NativeSelect, NativeSelectOption } from "@/lib/components/ui/native-select.jsx";
import { Switch } from "@/lib/components/ui/switch.jsx";
import { Button } from "@/lib/components/ui/button.jsx";
import { Alert, AlertDescription } from "@/lib/components/ui/alert.jsx";
import ScreenState from "@/lib/empty/ScreenState.jsx";
import ErrorPanel from "@/lib/empty/ErrorPanel.jsx";

export default function HoursDialogModal1Modal({
  open, onOpenChange, testId, DISPLAY_ORDER, DAY_NAMES, MINUTE_OPTIONS,
  clockLabel, phase, problem, draftDays, busy, changed, listingMismatchText,
  handleClose, save, onDayWorkingChange, onDayStartMinuteChange, onDayEndMinuteChange,
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid={testId}
        style={{
          width: "min(var(--size-modal-wide), 100vw)",
          maxWidth: "min(var(--size-modal-wide), calc(100vw - 2rem))",
        }}
        showCloseButton={!busy}
      >
        <DialogHeader>
          <DialogTitle>Your working hours</DialogTitle>
          <DialogDescription>
            Bookable times live inside these. Nothing can be booked outside them, by anyone.
          </DialogDescription>
        </DialogHeader>

        {phase === "loading" ? (
          <ScreenState phase="loading" testIds={{ loading: `${testId}-loading` }} />
        ) : phase === "denied" ? (
          <ScreenState phase="denied" reason={problem?.message} testIds={{ denied: `${testId}-denied` }} />
        ) : phase === "error" ? (
          <ErrorPanel error={problem} variant="band" testId={`${testId}-error`} />
        ) : (
          <div className="flex flex-col">
            {DISPLAY_ORDER.map((dow) => {
              const day = draftDays.find((d) => d.dayOfWeek === dow);
              if (!day) return null;
              return (
                <div
                  key={dow}
                  className="flex items-center gap-3 py-2.75 border-b border-hair last:border-b-0"
                  data-testid={`${testId}-row-${dow}`}
                >
                  <span className="w-[100px] flex-none text-sm">{DAY_NAMES[dow]}</span>
                  <Switch
                    checked={day.working}
                    onCheckedChange={(checked) => {
                      onDayWorkingChange?.(dow, checked);
                    }}
                    data-testid={`${testId}-toggle-${dow}`}
                  />
                  {day.working ? (
                    <div className="flex gap-3 flex-1">
                      <NativeSelect
                        value={String(day.startMinute)}
                        onChange={(e) => {
                          onDayStartMinuteChange?.(dow, Number(e.target.value));
                        }}
                        data-testid={`${testId}-from-${dow}`}
                      >
                        {MINUTE_OPTIONS.map((m) => (
                          <NativeSelectOption key={m} value={m}>
                            {clockLabel(m)}
                          </NativeSelectOption>
                        ))}
                      </NativeSelect>
                      <NativeSelect
                        value={String(day.endMinute)}
                        onChange={(e) => {
                          onDayEndMinuteChange?.(dow, Number(e.target.value));
                        }}
                        data-testid={`${testId}-to-${dow}`}
                      >
                        {MINUTE_OPTIONS.map((m) => (
                          <NativeSelectOption key={m} value={m}>
                            {clockLabel(m)}
                          </NativeSelectOption>
                        ))}
                      </NativeSelect>
                    </div>
                  ) : (
                    <span
                      className="flex-1 text-sm text-mute"
                      data-testid={`${testId}-off-${dow}`}
                    >
                      Not working
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {listingMismatchText && (
          <Alert
            className="mt-1.5 border-warm-border bg-warm-bg text-warn"
            data-testid={`${testId}-listing-mismatch`}
          >
            <AlertDescription>{listingMismatchText}</AlertDescription>
          </Alert>
        )}

        {problem && phase === "ready" && (
          <ErrorPanel error={problem} variant="band" testId={`${testId}-save-error`} />
        )}

        {phase === "ready" && (
          <DialogFooter>
            <Button
              variant="outline"
              data-testid={`${testId}-cancel`}
              disabled={busy}
              onClick={handleClose}
            >
              Cancel
            </Button>
            <Button
              data-testid={`${testId}-save`}
              disabled={busy}
              onClick={() => save(false)}
            >
              {busy ? "Saving…" : "Save"}
            </Button>
            {changed && (
              <Button
                data-testid={`${testId}-save-fix-google`}
                disabled={busy}
                onClick={() => save(true)}
              >
                {busy ? "Saving…" : "Save, and ask Run to fix Google too"}
              </Button>
            )}
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
