// Banner — DegradedBanner / ReadOnlyBanner (COMPONENTS.md §1): something upstream is down, or the practice
// is read-only; stated plainly, never a toast. Copy is the caller's.
const TONE = { degraded: "border-warm-border bg-warm-bg text-warn", readonly: "border-line bg-surface-2 text-ink-2", bad: "border-bad-border bg-bad-bg text-bad" };
export default function Banner({ variant = "degraded", children, action = null, testId = undefined }) {
  return (
    <div role="status" className={`flex items-center gap-3 rounded-card border px-4 py-3 text-ui ${TONE[variant] ?? TONE.degraded}`} data-variant={variant} data-testid={testId}>
      <div className="flex-1">{children}</div>
      {action}
    </div>
  );
}
