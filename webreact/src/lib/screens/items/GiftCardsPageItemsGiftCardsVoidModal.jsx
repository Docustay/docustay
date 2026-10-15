import DecisionModal from "@/lib/forms/DecisionModal.jsx";

export default function GiftCardsPageItemsGiftCardsVoidModal({
  open,
  onOpenChange,
  rows,
  formatMoney,
  hasMoneyColumns,
  voidTarget,
  voidBusy,
  voidError,
  closeVoidModal,
  confirmVoid,
}) {
  if (!open || !voidTarget) return null;

  const rows_data = [
    {
      headline: hasMoneyColumns
        ? `${formatMoney(voidTarget.remaining_minor, voidTarget.currency)} still on the card`
        : `${voidTarget.holder} still holds a balance`,
      detail: `${voidTarget.holder} will not be able to spend what's left on ${voidTarget.number} after this.`,
    },
  ];

  return (
    <DecisionModal
      open={open}
      onOpenChange={onOpenChange}
      title={`Void ${voidTarget.number} — ${voidTarget.holder}?`}
      subtitle="This can't be undone."
      rows={rows_data}
      cancelLabel="Keep it"
      confirmLabel="Void it"
      danger={true}
      busy={voidBusy}
      error={voidError}
      onCancel={closeVoidModal}
      onConfirm={confirmVoid}
      testId="items-gift-cards-void-modal"
    />
  );
}
