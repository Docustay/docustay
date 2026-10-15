// ═══════════════════════════════════════════════════════════════════════════════════════════════
// R5.018.T1 — OnlineBookingScreen › OnlineBookingScreenOnlineBookingPageTable: the table as its
// own component, built on LedgerPage inside ScreenState. Ported from
// webui/src/lib/screens/engagements/OnlineBookingScreen.svelte:253-326 — same structure, behavior.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { Badge } from "@/lib/components/ui/badge.jsx";
import { Switch } from "@/lib/components/ui/switch.jsx";
import PromptCard from "@/lib/prompts/PromptCard.jsx";
import LastChanged from "@/lib/shared/LastChanged.jsx";

export default function OnlineBookingScreenOnlineBookingPageTable({
  onNavigate,
  phase,
  error,
  services,
  lastChanged,
  onlineEnabled,
  prompts,
  dismissPromptNow,
  summary,
  bookedLabel,
  openService,
  openPreview,
  ruleRows,
}) {
  if (phase !== "ready") {
    return null;
  }

  return (
    <div className="flex flex-col gap-4.5 w-full" data-testid="online-booking-body">
      {/* Services block */}
      <div className="rounded-card border border-line bg-surface" data-testid="online-booking-services-block">
        <div className="flex items-center gap-[var(--gap)] border-b border-hair px-[var(--spacing-sm)] py-[14px]">
          <b className="font-medium">What strangers can book</b>
          <span className="flex-1"></span>
          {lastChanged && (
            <LastChanged at={lastChanged.at} by={lastChanged.by} testId="online-booking-last-changed" />
          )}
        </div>
        <div className="flex flex-col px-[var(--spacing-sm)] pb-[14px] pt-[6px]">
          {services.map((svc) => (
            <div key={svc.id} className="flex items-center gap-3 border-b border-hair py-[11px]" data-testid={`online-booking-row-${svc.id}`}>
              <span className="flex flex-1 flex-col min-w-0 gap-0.5">
                <span className="text-field truncate" title={svc.name}>
                  {svc.name}
                </span>
                <span className="text-meta text-mute" data-testid={`online-booking-sentence-${svc.id}`}>
                  {svc.sentence}
                </span>
              </span>
              {svc.publicBookable ? (
                <Badge className="h-5 px-2.25 text-xs font-medium bg-[var(--chip-ok-bg)] text-[var(--chip-ok-ink)]" data-testid={`online-booking-booked-${svc.id}`}>
                  {bookedLabel(svc.bookedCount)}
                </Badge>
              ) : (
                <Badge className="h-5 px-2.25 text-xs font-medium bg-[var(--chip-neutral-bg)] text-[var(--chip-neutral-ink)]" data-testid={`online-booking-hidden-${svc.id}`}>
                  Hidden
                </Badge>
              )}
              <Switch
                checked={svc.publicBookable}
                aria-label={`${svc.name} is public on your booking page — change this from Services`}
                title="Change this from the service, in Services"
                data-testid={`online-booking-toggle-${svc.id}`}
                onCheckedChange={openService}
              />
            </div>
          ))}
        </div>
      </div>

      {/* Two-column layout: Rules and Prompts */}
      <div className="flex gap-[22px] items-start">
        {/* Left column: Rules */}
        <div className="flex-1 min-w-0">
          <div className="rounded-card border border-line bg-surface">
            <div className="flex items-center gap-[var(--gap)] border-b border-hair px-[var(--spacing-sm)] py-[14px]">
              <b className="font-medium">Rules for everyone booking online</b>
            </div>
            <div className="flex flex-col px-[var(--spacing-sm)] pb-[14px] pt-[6px]">
              {ruleRows.map((r) => (
                <div key={r.id} className="flex flex-col gap-[3px] border-b border-hair py-[11px]" data-testid={`online-booking-rule-${r.id}`}>
                  <span className="text-field text-ink">{r.headline}</span>
                  <span className="text-meta text-mute">{r.sub}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right column: Prompts */}
        <div className="w-80 flex-shrink-0">
          <div className="rounded-card border border-line bg-surface">
            <div className="flex items-center gap-[var(--gap)] border-b border-hair px-[var(--spacing-sm)] py-[14px]">
              <b className="font-medium">Worth knowing</b>
            </div>
            <div className="flex flex-col px-[var(--spacing-sm)] pb-[14px] pt-[6px]" data-testid="online-booking-prompts">
              {prompts.length === 0 ? (
                <p className="m-0 my-2 text-sm text-mute" data-testid="online-booking-prompts-empty">
                  Nothing needs you here right now.
                </p>
              ) : (
                prompts.map((p) => (
                  <PromptCard
                    key={p.dismissKey}
                    icon={p.icon}
                    tone={p.tone}
                    headline={p.headline}
                    why={p.why}
                    action={p.action}
                    kind={p.kind}
                    onDismiss={() => dismissPromptNow(p)}
                    testId={`online-booking-prompt-${p.dismissKey}`}
                  />
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
