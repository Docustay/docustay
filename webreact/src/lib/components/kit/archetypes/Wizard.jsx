// Wizard + WizardStepNav — the multi-step shape (COMPONENTS.md §3): connect, import, reader onboarding,
// first run. The left step list shows where you are; Back / Continue sit in the footer. Copy is the caller's.
import { Button } from "@/lib/components/ui/button.jsx";
import PageTitle from "@/lib/components/kit/PageTitle.jsx";
import AppSpinner from "@/lib/components/kit/AppSpinner.jsx";

export function WizardStepNav({ steps, activeStep, onStep = null, testId = "wizard-steps" }) {
  const at = steps.findIndex((s) => s.key === activeStep);
  return (
    <ol className="m-0 flex list-none flex-col gap-1 p-0" data-testid={testId}>
      {steps.map((s, i) => (
        <li key={s.key}>
          <button type="button" disabled={!onStep || i > at} onClick={() => onStep?.(s.key)} aria-current={s.key === activeStep ? "step" : undefined}
                  className="flex w-full items-center gap-2.5 rounded-control px-2.5 py-2 text-left text-ui text-ink-2 aria-[current=step]:bg-brand-soft aria-[current=step]:font-medium aria-[current=step]:text-brand disabled:cursor-default"
                  data-testid={`${testId}-${s.key}`} data-done={i < at ? "true" : undefined}>
            <span className="flex size-5.5 items-center justify-center rounded-pill border border-line text-caption">{i < at ? "✓" : i + 1}</span>{s.label}
          </button>
        </li>
      ))}
    </ol>
  );
}

export default function Wizard({ title, steps, activeStep, onStep = null, onBack = null, onNext = null, nextLabel = "Continue", backLabel = "Back", nextDisabled = false, busy = false, loading = false, children, testId = "wizard" }) {
  return (
    <div className="flex h-full min-h-0 flex-col" data-testid={testId}>
      <div className="border-b border-line bg-surface px-7.5 py-5"><PageTitle testId={`${testId}-title`}>{title}</PageTitle></div>
      <div className="flex min-h-0 flex-1">
        <aside className="w-60 shrink-0 border-r border-line bg-surface p-4"><WizardStepNav steps={steps} activeStep={activeStep} onStep={onStep} testId={`${testId}-steps`} /></aside>
        <main className="min-w-0 flex-1 overflow-auto px-7.5 py-6.5">{loading ? <AppSpinner /> : children}</main>
      </div>
      <footer className="flex justify-end gap-2.5 border-t border-line bg-surface px-7.5 py-4">
        {onBack && <Button type="button" variant="outline" onClick={onBack} disabled={busy} data-testid={`${testId}-back`}>{backLabel}</Button>}
        {onNext && <Button type="button" onClick={onNext} disabled={busy || nextDisabled} data-testid={`${testId}-next`}>{busy ? "Working…" : nextLabel}</Button>}
      </footer>
    </div>
  );
}
