// ═══════════════════════════════════════════════════════════════════════════════════════════════
// PAYMENT METHOD ROW — Reusable component for "In person" payment method rows
// (Tap to Pay, card reader, virtual terminal)
// ═══════════════════════════════════════════════════════════════════════════════════════════════

export default function PaymentMethodRow({
  label = "",
  description = "",
  iconBg = "#635BFF",
  icon = "S",
  feeText = "",
  actionLabel = "",
  actionHref = null,
  onAction = null,
  disabled = false,
  disabledReason = "",
  children = null,
  testId = "payment-method-row",
}) {
  function handleClick() {
    if (onAction) {
      onAction();
    }
  }

  return (
    <div className="flex items-center gap-[15px] py-[17px] border-b border-line-soft last:border-b-0" data-testid={testId}>
      <div
        className="h-[38px] w-[38px] flex-shrink-0 flex items-center justify-center rounded-[9px] font-semibold text-[15px] text-white"
        style={{ backgroundColor: iconBg }}
      >
        {icon}
      </div>

      <div className="flex-1">
        <div className="font-medium text-[14.5px] text-ink">{label}</div>
        {description && (
          <div className="text-[13px] text-mute mt-[3px] leading-[1.5]">{description}</div>
        )}
      </div>

      <div className="flex items-center gap-[10px] flex-shrink-0">
        {feeText && (
          <div className="text-[13px] text-mute font-tabular-nums min-w-[110px] text-right">{feeText}</div>
        )}
        {actionLabel && (
          <>
            {actionHref ? (
              <a
                href={actionHref}
                className="h-8 px-[13px] rounded-[7px] text-[13px] font-medium border border-line-soft bg-white text-mute no-underline cursor-pointer inline-flex items-center justify-center hover:bg-brand-soft hover:text-brand"
              >
                {actionLabel}
              </a>
            ) : onAction ? (
              <button
                className="h-8 px-[13px] rounded-[7px] text-[13px] font-medium border border-line-soft bg-white text-mute cursor-pointer inline-flex items-center justify-center hover:bg-brand-soft hover:text-brand disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={handleClick}
                disabled={disabled}
              >
                {actionLabel}
              </button>
            ) : null}
          </>
        )}
        {children}
      </div>
    </div>
  );
}
