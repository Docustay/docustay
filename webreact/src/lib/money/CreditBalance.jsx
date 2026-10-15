// ═══════════════════════════════════════════════════════════════════════════════════════════════
// CREDIT BALANCE — Reusable component showing session drawdown for a subscription
// Shows sessions included, used this month, and remaining with the "unused don't roll over" note
// ═══════════════════════════════════════════════════════════════════════════════════════════════

export default function CreditBalance({
  sessionsIncluded = 0,
  sessionsUsed = 0,
  sessionsRemaining = sessionsIncluded - sessionsUsed,
  serviceDescription = "",
  showDisclaimer = true,
}) {
  return (
    <div className="flex flex-col gap-0" data-testid="money-credit-balance">
      <div className="flex items-center gap-3 border-b border-line py-[11px] text-field">
        <div className="flex-1">Sessions included each month</div>
        <div className="shrink-0 font-medium text-ink">{sessionsIncluded}</div>
      </div>

      {serviceDescription && (
        <div className="flex items-center gap-3 border-b border-line py-[11px] text-field">
          <div className="flex-1">Service</div>
          <div className="shrink-0 font-medium text-ink">{serviceDescription}</div>
        </div>
      )}

      <div className="flex items-center gap-3 border-b border-line py-[11px] text-field">
        <div className="flex-1">Sessions used this month</div>
        <div className="shrink-0 font-medium text-ink">{sessionsUsed}</div>
      </div>

      <div className="flex items-center gap-3 py-[11px] text-field">
        <div className="flex-1">Sessions remaining</div>
        <div className="shrink-0 font-medium text-ink">{sessionsRemaining}</div>
      </div>

      {showDisclaimer && (
        <div className="flex flex-col gap-[3px] border-t border-line py-[11px] text-meta mt-[6px]">
          <span className="font-medium text-ink">Unused ones don't roll over</span>
          <span className="text-xs text-mute">Which is on the plan, and he agreed to it</span>
        </div>
      )}
    </div>
  );
}
