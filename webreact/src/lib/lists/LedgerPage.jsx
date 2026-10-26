// ═══════════════════════════════════════════════════════════════════════════════════════════════
// LedgerPage — the LEDGER archetype (COMPONENTS.md §2): rows you scan and filter. Ported from
// webui/src/lib/lists/LedgerPage.svelte — same props and testids; the table arrives as children.
// ★ R-41: `loading` renders the ONE full-screen spinner in the body (no per-screen loading UI).
// ★ The title is the page's Fraunces moment (kit2 .h1) — one of the ≤2 on the screen.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { Button } from "@/lib/components/ui/button.jsx";
import PageTitle from "@/lib/components/kit/PageTitle.jsx";
import AppSpinner from "@/lib/components/kit/AppSpinner.jsx";

export default function LedgerPage({
  title, summary = null, primary = null, headerAction = null, views = null, activeView = null, onView = null,
  controls = null, children = null, archetype = "ledger", testId = "ledger-page", loading = false,
}) {
  return (
    <div className="flex min-h-full flex-col" data-testid={testId} data-archetype={archetype}>
      <div className="mb-4.5 flex flex-wrap items-end gap-x-4 gap-y-2" data-testid={`${testId}-header`}>
        <div className="min-w-[11rem] flex-1">
          <PageTitle testId={`${testId}-title`}>{title}</PageTitle>
          {summary && <p className="mt-1.25 text-control text-mute" data-testid={`${testId}-summary`}>{summary}</p>}
        </div>
        {primary && (
          <div className="flex flex-col items-end gap-1">
            <Button disabled={primary.disabled ?? false} onClick={() => primary.onClick?.()} data-testid={`${testId}-primary`}>{primary.label}</Button>
            {primary.disabled && primary.disabledReason && <p className="m-0 text-meta text-mute" data-testid={`${testId}-primary-reason`}>{primary.disabledReason}</p>}
          </div>
        )}
        {headerAction && <Button variant="ghost" onClick={() => headerAction.onClick?.()} data-testid={`${testId}-header-action`}>{headerAction.label}</Button>}
      </div>
      {views && (
        <div className="mb-3.5 flex gap-4.5 border-b border-line" data-testid={`${testId}-views`} role="tablist">
          {views.map((v) => (
            <button key={v.key} type="button" role="tab" aria-selected={activeView === v.key}
                    className="-mb-px border-b-2 border-transparent pb-2.5 text-ui text-mute data-[active=true]:border-brand data-[active=true]:font-medium data-[active=true]:text-ink"
                    data-testid={`${testId}-view-${v.key}`} data-active={activeView === v.key ? "true" : undefined}
                    onClick={() => onView?.(v.key)}>{v.label}</button>
          ))}
        </div>
      )}
      {controls && <div className="mb-3.5 flex flex-wrap items-center gap-2" data-testid={`${testId}-controls`}>{controls}</div>}
      <div className="flex flex-1 flex-col" data-testid={`${testId}-body`}>{loading ? <AppSpinner /> : children}</div>
    </div>
  );
}
