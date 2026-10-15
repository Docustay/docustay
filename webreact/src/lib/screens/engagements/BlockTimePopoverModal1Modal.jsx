// ═══════════════════════════════════════════════════════════════════════════════════════════════
// BlockTimePopoverModal1Modal — the modal for blocking time, extracted from BlockTimePopover.
// Ported from webui/src/lib/screens/engagements/BlockTimePopover.svelte:225-302
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/lib/components/ui/dialog.jsx";
import { Field, FieldLabel, FieldContent } from "@/lib/components/ui/field.jsx";
import { Input } from "@/lib/components/ui/input.jsx";
import { NativeSelect, NativeSelectOption } from "@/lib/components/ui/native-select.jsx";
import { Button } from "@/lib/components/ui/button.jsx";
import { Alert, AlertTitle, AlertDescription } from "@/lib/components/ui/alert.jsx";
import ScreenState from "@/lib/empty/ScreenState.jsx";
import ErrorPanel from "@/lib/empty/ErrorPanel.jsx";
import { ApiError } from "@/lib/api.js";

export default function BlockTimePopoverModal1Modal({
  open, onOpenChange, date, testId, WHAT_FOR_OPTIONS, REPEAT_OPTIONS, MINUTE_OPTIONS,
  clockLabel, phase, whatFor, customLabel, onDate, startMinuteStr, endMinuteStr, repeatKind,
  busy, problem, clashLead, clashRest, handleClose, submit,
  onWhatForChange, onCustomLabelChange, onDateChange, onStartMinuteChange, onEndMinuteChange, onRepeatKindChange,
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid={testId}
        style={{
          width: "min(var(--size-modal), 100vw)",
          maxWidth: "min(var(--size-modal), calc(100vw - 2rem))",
        }}
        showCloseButton={!busy}
      >
        <DialogHeader>
          <DialogTitle>Block some time</DialogTitle>
          <DialogDescription>
            Nobody can be booked into it, and it won't show on your booking page.
          </DialogDescription>
        </DialogHeader>

        {problem && problem instanceof ApiError && problem.status === 403 ? (
          <ScreenState phase="denied" reason={problem.message} testIds={{ denied: `${testId}-denied` }} />
        ) : phase === "form" ? (
          <div className="flex flex-col gap-4">
            <Field orientation="horizontal" data-testid={`${testId}-row-what`}>
              <FieldLabel htmlFor={`${testId}-what`}>What for</FieldLabel>
              <FieldContent>
                <NativeSelect
                  id={`${testId}-what`}
                  value={whatFor}
                  onChange={(e) => onWhatForChange?.(e.target.value)}
                  data-testid={`${testId}-what`}
                >
                  {WHAT_FOR_OPTIONS.map((o) => (
                    <NativeSelectOption key={o.value} value={o.value}>
                      {o.label}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
                {whatFor === "other" && (
                  <Input
                    data-testid={`${testId}-what-other`}
                    value={customLabel}
                    onChange={(e) => onCustomLabelChange?.(e.target.value)}
                    placeholder="Say what this is"
                    maxLength="200"
                  />
                )}
              </FieldContent>
            </Field>

            <Field orientation="horizontal" data-testid={`${testId}-row-when`}>
              <FieldLabel htmlFor={`${testId}-date`}>When</FieldLabel>
              <FieldContent className="!flex-row !flex-wrap gap-2">
                <Input
                  id={`${testId}-date`}
                  type="date"
                  value={onDate}
                  onChange={(e) => onDateChange?.(e.target.value)}
                  data-testid={`${testId}-date`}
                  required
                  className="flex-[1_1_120px]"
                />
                <NativeSelect
                  value={startMinuteStr}
                  onChange={(e) => onStartMinuteChange?.(e.target.value)}
                  data-testid={`${testId}-from`}
                  className="flex-[1_1_120px]"
                >
                  {MINUTE_OPTIONS.map((m) => (
                    <NativeSelectOption key={m} value={m}>
                      {clockLabel(m)}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
                <NativeSelect
                  value={endMinuteStr}
                  onChange={(e) => onEndMinuteChange?.(e.target.value)}
                  data-testid={`${testId}-to`}
                  className="flex-[1_1_120px]"
                >
                  {MINUTE_OPTIONS.map((m) => (
                    <NativeSelectOption key={m} value={m}>
                      {clockLabel(m)}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </FieldContent>
            </Field>

            <Field orientation="horizontal" data-testid={`${testId}-row-repeat`}>
              <FieldLabel htmlFor={`${testId}-repeat`}>Repeat</FieldLabel>
              <FieldContent>
                <NativeSelect
                  id={`${testId}-repeat`}
                  value={repeatKind}
                  onChange={(e) => onRepeatKindChange?.(e.target.value)}
                  data-testid={`${testId}-repeat`}
                >
                  {REPEAT_OPTIONS.map((o) => (
                    <NativeSelectOption key={o.value} value={o.value}>
                      {o.label}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
                {repeatKind !== "none" && (
                  <p className="text-xs text-muted-foreground mt-1.5">
                    Until you stop it. You can skip a single day later.
                  </p>
                )}
              </FieldContent>
            </Field>

            {problem && (
              <ErrorPanel error={problem} variant="band" testId={`${testId}-error`} />
            )}
          </div>
        ) : phase === "confirm" ? (
          <Alert
            className="border-warm-border bg-warm-bg text-warn"
            data-testid={`${testId}-clash`}
          >
            <AlertTitle>{clashLead}</AlertTitle>
            <AlertDescription>{clashRest}</AlertDescription>
          </Alert>
        ) : null}

        <DialogFooter>
          {phase === "form" ? (
            <>
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
                onClick={submit}
              >
                {busy ? "Blocking…" : "Block it"}
              </Button>
            </>
          ) : (
            <Button
              data-testid={`${testId}-done`}
              onClick={handleClose}
            >
              Done
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
