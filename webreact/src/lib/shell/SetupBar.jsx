// The slim setup meter under the practice name (R3.013, SetupBar.svelte; SidebarV2.frame.html `.meter`).
// ★ Removes ITSELF at 100%, while loading, on error, or with nothing to count. The raw count shows beside the bar —
//   "2 of 5" is a to-do list, a bare percentage is a mood — and 0 renders as 0, never blank.
// ★ Its main trigger opens the setup SHEET in place (no argument); the next-step shortcut navigates (an href).
import { ChevronRight } from "lucide-react";
import { Progress } from "@/lib/components/ui/progress";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/lib/components/ui/collapsible";
import { Button } from "@/lib/components/ui/button";

export default function SetupBar({ summary = null, nextStep = null, loading = false, error = null, onOpen = null }) {
  const total = Number(summary?.total) || 0;
  const done = Number(summary?.done) || 0;
  if (loading || error || !summary || total <= 0 || summary.allDone) return null;
  const pct = Math.max(0, Math.min(100, Math.round((done / total) * 100)));
  return (
    <div className="mt-2.75" data-testid="setup-bar" data-pct={pct} data-done={done} data-total={total}>
      <Collapsible>
        <div className="flex items-center gap-2.25 text-caption text-ink-2">
          <button type="button" className="flex min-w-0 flex-1 items-center gap-2.25 text-left" data-testid="setup-bar-open" onClick={() => onOpen?.()}>
            <span className="shrink-0">Complete your setup</span>
            <Progress value={pct} className="h-1 flex-1 bg-mute-bg [&>div]:bg-brand" aria-label={`Setup ${pct}% complete, ${done} of ${total} steps done`} />
            <span className="shrink-0 tabular-nums" data-testid="setup-bar-count">{done}/{total}</span>
          </button>
          {nextStep ? (
            <CollapsibleTrigger className="grid size-5 place-items-center rounded-sm text-chevron hover:text-ink data-[state=open]:rotate-90" data-testid="setup-bar-more" aria-label="Show the next setup step">
              <ChevronRight className="size-3.5" aria-hidden="true" />
            </CollapsibleTrigger>
          ) : null}
        </div>
        {nextStep ? (
          <CollapsibleContent className="mt-2 flex flex-col gap-2" data-testid="setup-bar-next">
            <p className="m-0 text-caption text-ink-2">{nextStep.label}</p>
            {nextStep.href ? <Button size="sm" data-testid="setup-bar-next-go" onClick={() => onOpen?.(nextStep.href)}>{nextStep.action ?? "Do this"}</Button> : null}
          </CollapsibleContent>
        ) : null}
      </Collapsible>
    </div>
  );
}
