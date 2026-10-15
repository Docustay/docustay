// ═══════════════════════════════════════════════════════════════════════════════════════════════
// AppSpinner — THE full-screen loading state (Ruling R-41). One large, centred, animated ring, used by
// the route table's Suspense fallback, every archetype's `loading` slot and ScreenState phase="loading".
// Never built per screen. A frame that draws a SKELETON for a state keeps the skeleton (field 14 says so).
// ★ Centred in the CONTENT area (fills its parent), not the viewport: the sidebar stays put.
// ★ role=status + a visually hidden label; under prefers-reduced-motion the theme's blanket rule stops
//   the spin and the ring stays visible with its label.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
export default function AppSpinner({ label = "Loading", testId = "app-spinner" }) {
  return (
    <div role="status" aria-live="polite" data-testid={testId}
         className="flex min-h-[60vh] w-full flex-1 items-center justify-center">
      <span aria-hidden="true"
            className="block size-(--size-spinner) animate-spin rounded-pill border-4 border-brand-soft border-t-brand [animation-duration:var(--motion-spinner-period)]" />
      <span className="sr-only">{label}</span>
    </div>
  );
}
