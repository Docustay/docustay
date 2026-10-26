// RailSection — one expandable row of the rail (kit2 .rs). Ported from RailSection.svelte: same props/testids.
// With no children it renders a static row (label + summary), never a trigger that opens nothing.
import { ChevronDown } from "lucide-react";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/lib/components/ui/collapsible.jsx";

const TRIG = "flex w-full items-center gap-2 border-b border-hair py-3 text-left";
export default function RailSection({ label, summary = null, expanded = false, onToggle = null, children = null, testId = "rail-section" }) {
  // ★ ITEM 16 FIX, 30 Sep 2026 — "Who can buy it" (and any other multi-word rail label) wrapped one
  //   word per line: the label had `flex-1` opposite a long, unshrinkable summary, so flexbox handed
  //   the label whatever sliver was left over. The label is the fixed, short, authored string here —
  //   it should never wrap — and the summary is the variable data, so IT is the one that truncates.
  const head = (
    <>
      <span className="shrink-0 whitespace-nowrap text-ui text-ink">{label}</span>
      {summary && <span className="min-w-0 flex-1 truncate text-right text-meta text-mute" title={summary} data-testid={`${testId}-summary`}>{summary}</span>}
    </>
  );
  if (!children) {
    return <div data-testid={testId} data-has-content="false"><div className={TRIG}>{head}</div></div>;
  }
  return (
    <div data-testid={testId} data-has-content="true">
      <Collapsible open={expanded} onOpenChange={(next) => onToggle?.(next)}>
        <CollapsibleTrigger className={`group ${TRIG}`} data-testid={`${testId}-trigger`}>
          {head}<ChevronDown className="size-4 text-caret transition-transform group-data-[state=open]:rotate-180" aria-hidden="true" />
        </CollapsibleTrigger>
        <CollapsibleContent className="py-3" data-testid={`${testId}-content`}>{children}</CollapsibleContent>
      </Collapsible>
    </div>
  );
}
