// ═══════════════════════════════════════════════════════════════════════════════════════════════
// PromptCard — a box that renders what the prompt ENGINE returned (src/prompts/engine.mjs). Nothing is
// composed here: icon · headline · "Why:" evidence · one action · dismiss. Ported from
// webui/src/lib/prompts/PromptCard.svelte: same props and testids; a prompt with no `why` THROWS
// (brand constant: every prompt carries its Why: sentence).
// ★ Tone → the icon tile's colours, kit2's prompt() tones: money · run · people · bad.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { Button } from "@/lib/components/ui/button.jsx";

const TONE = {
  money: "bg-warn-soft text-warn", run: "bg-brand-soft text-brand", people: "bg-ok-soft text-ok", bad: "bg-bad-soft text-bad",
  warn: "bg-warn-soft text-warn", act: "bg-brand-soft text-brand", ok: "bg-ok-soft text-ok",
};

export default function PromptCard({ icon, tone, headline, why, action, onDismiss, busy = false, testId = "prompt-card", kind = null }) {
  if (!why) throw new Error("PromptCard: \"why\" is required. A prompt without an evidence sentence is not a prompt.");
  return (
    <div className="flex gap-3.5 rounded-card border border-line bg-surface px-4.25 py-3.75" data-testid={testId} data-tone={tone} data-kind={kind ?? undefined}>
      <span className={`flex size-7.5 shrink-0 items-center justify-center rounded-control ${TONE[tone] ?? "bg-mute-bg text-ink-2"}`} aria-hidden="true">{icon}</span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-field font-medium text-ink">{headline}</span>
        <span className="mt-1 text-meta leading-relaxed text-mute"><b className="font-medium text-ink-2">Why:</b> {why}</span>
      </span>
      <span className="flex shrink-0 items-center gap-2 self-center">
        {action?.href ? (
          <Button size="sm" variant="outline" asChild data-testid={`${testId}-action`}><a href={action.href} onClick={action.onClick}>{action.label}</a></Button>
        ) : (
          <Button size="sm" variant="outline" onClick={action?.onClick} data-testid={`${testId}-action`}>{action?.label}</Button>
        )}
        {onDismiss && (
          <Button variant="ghost" size="icon-sm" className="self-start text-row-action" aria-label="Dismiss" disabled={busy} onClick={() => onDismiss()} data-testid={`${testId}-dismiss`}>✕</Button>
        )}
      </span>
    </div>
  );
}
