// ═══════════════════════════════════════════════════════════════════════════════════════════════
// DecisionModal — ONE decision; every option carries a sentence of consequence (COMPONENTS.md §3).
// Ported from webui/src/lib/forms/DecisionModal.svelte: same props (bind:open → open + onOpenChange),
// the same fourteen testids built from `testId` (TESTID-CONTRACT §3), same refusal (an option with no
// consequence THROWS — that would be a plain radio picker, not a decision).
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription,
  AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from "@/lib/components/ui/alert-dialog.jsx";
import { RadioGroup, RadioGroupItem } from "@/lib/components/ui/radio-group.jsx";
import { Switch } from "@/lib/components/ui/switch.jsx";
import { useBindableOpen } from "@/lib/hooks/useBindableOpen.js";

export default function DecisionModal({
  open = false, onOpenChange, title, subtitle = null, rows = [], options = null, selected = null, onSelect = null,
  toggle = null, cancelLabel, confirmLabel, onCancel = null, onConfirm, danger = false, wide = false, busy = false,
  confirmDisabled = false, error = null, children = null, testId = "decision-modal",
}) {
  if (options && options.some((o) => !o.consequence)) {
    throw new Error("DecisionModal: every option needs a consequence sentence — an option list without one is a plain radio picker, not a decision.");
  }
  const [isOpen, setOpen] = useBindableOpen(open, onOpenChange);
  return (
    <AlertDialog open={isOpen} onOpenChange={setOpen}>
      <AlertDialogContent className={`${wide ? "w-(--size-modal-wide)" : "w-(--size-modal)"} max-w-[calc(100vw-2rem)] sm:max-w-none gap-0 rounded-modal p-0 shadow-modal`}
                          data-testid={testId} data-wide={wide ? "true" : undefined}>
        <AlertDialogHeader className="px-6 pt-5.5 pb-1.5 text-left">
          <AlertDialogTitle className="text-modal-title font-medium text-ink" data-testid={`${testId}-title`}>{title}</AlertDialogTitle>
          {subtitle && <AlertDialogDescription className="mt-2 text-control leading-relaxed text-mute" data-testid={`${testId}-subtitle`}>{subtitle}</AlertDialogDescription>}
        </AlertDialogHeader>
        <div className="px-6 pt-3 pb-1.5" data-testid={`${testId}-body`}>
          {rows.length > 0 && (
            <div className="flex flex-col gap-2.5" data-testid={`${testId}-rows`}>
              {rows.map((row, i) => (
                <div key={i} className="flex flex-col gap-0.5" data-testid={`${testId}-row-${i}`}>
                  <b className="text-ui font-medium text-ink">{row.headline}</b>
                  <span className="text-meta text-mute">{row.detail}</span>
                </div>
              ))}
            </div>
          )}
          {options && (
            <RadioGroup className="gap-2.5" data-testid={`${testId}-options`} value={selected ?? ""} onValueChange={(v) => onSelect?.(v)}>
              {options.map((opt) => (
                <label key={opt.key} className="flex cursor-pointer gap-3.5 rounded-option border border-line p-3.5 has-[[data-state=checked]]:border-brand has-[[data-state=checked]]:bg-brand-soft"
                       data-testid={`${testId}-option-${opt.key}`} data-selected={selected === opt.key ? "true" : undefined}>
                  <RadioGroupItem value={opt.key} className="mt-0.5" data-testid={`${testId}-option-${opt.key}-radio`} />
                  <span className="flex flex-col">
                    <b className="text-field font-medium text-ink">{opt.label}</b>
                    <span className="mt-1 text-meta leading-relaxed text-mute">{opt.consequence}</span>
                  </span>
                </label>
              ))}
            </RadioGroup>
          )}
          {toggle && (
            <div className="mt-3 flex items-center gap-3" data-testid={`${testId}-toggle`}>
              <span className="flex flex-1 flex-col text-ui text-ink">{toggle.label}<span className="text-meta text-mute">{toggle.why}</span></span>
              <Switch checked={!!toggle.checked} disabled={busy} data-testid={`${testId}-toggle-switch`} onCheckedChange={(v) => toggle.onToggle?.(v)} />
            </div>
          )}
          {children}
        </div>
        {error && <p className="mx-6 mt-3 rounded-sm border border-bad-border bg-bad-bg px-3 py-2.5 text-meta text-bad" data-testid={`${testId}-error`} role="alert">{error}</p>}
        <AlertDialogFooter className="flex-row justify-end gap-2.5 px-6 pt-4.5 pb-5.5">
          <AlertDialogCancel data-testid={`${testId}-cancel`} disabled={busy} onClick={() => onCancel?.()}>{cancelLabel}</AlertDialogCancel>
          <AlertDialogAction variant={danger ? "destructive" : "default"} data-testid={`${testId}-confirm`} disabled={busy || confirmDisabled}
                             onClick={(e) => { e.preventDefault(); onConfirm?.(); }}>{confirmLabel}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
