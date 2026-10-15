// ═══════════════════════════════════════════════════════════════════════════════════════════════
// EmptyState — ported from webui/src/lib/empty/EmptyState.svelte. Same props, kinds, testids, refusals.
// ★ The six KINDS (phase.js, R-18) must look and read differently: a person who filtered to nothing is
//   never told to create their first record. An unknown kind, or no words at all, THROWS.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription, EmptyContent, EmptyMedia } from "@/lib/components/ui/empty.jsx";
import { Button } from "@/lib/components/ui/button.jsx";
import { KINDS } from "./phase.js";
import { iconFor, ICON_STROKE } from "./icons.js";

export default function EmptyState({
  kind = "first-run", icon = null, headline = "", line = "", action = null,
  onClearFilters = null, reason = null, testId = null, onNavigate = null,
}) {
  if (!KINDS.includes(kind)) {
    throw new Error(
      `EmptyState: "${kind}" is not one of the five kinds (${KINDS.join(", ")}). ` +
      `A screen that cannot say WHY it is empty will tell a power user who filtered to nothing ` +
      `to create their first record.`);
  }
  if (!headline && !line && !reason) {
    throw new Error(
      "EmptyState: needs a headline and a line saying what this space is for and what would put " +
      "something in it. A bare \"No records\" tells a person nothing they can act on.");
  }
  const Icon = typeof icon === "string" ? iconFor(icon) : icon;
  const go = (href) => { if (!href) return; if (onNavigate) onNavigate(href); else window.location.assign(href); };
  // ★ Found live, 28 Sep 2026 — every action here was a navigation. WeekView's "Book someone" is
  //   not: it opens the shared BookSessionDialog via app.bookOpen, no URL of its own to land on.
  //   `action.onClick` is additive — every existing caller still only passes `href` and is unaffected.
  const runAction = () => { if (action.onClick) action.onClick(); else go(action.href); };
  return (
    <Empty
      className="rounded-card border border-line bg-surface px-6 py-14"
      data-kind={kind}
      data-state={kind === "not-built" ? "not-built" : "empty"}
      data-testid={testId ?? `empty-${kind}`}
      role="status"
    >
      {Icon && (
        <EmptyMedia variant="icon" className="text-mute"><Icon strokeWidth={ICON_STROKE} /></EmptyMedia>
      )}
      <EmptyHeader>
        {headline && <EmptyTitle className="text-empty-title font-medium text-ink">{headline}</EmptyTitle>}
        {(line || reason) && <EmptyDescription className="mx-auto max-w-[46ch] text-ui text-mute">{reason ?? line}</EmptyDescription>}
      </EmptyHeader>
      {(action || onClearFilters) && (
        <EmptyContent className="flex-row justify-center gap-2">
          {action && (
            <Button data-testid="empty-action" autoFocus={kind === "first-run"} onClick={runAction}>{action.label}</Button>
          )}
          {onClearFilters && kind === "filtered" && (
            <Button variant="outline" data-testid="empty-clear-filters" onClick={onClearFilters}>Clear filters</Button>
          )}
        </EmptyContent>
      )}
    </Empty>
  );
}
