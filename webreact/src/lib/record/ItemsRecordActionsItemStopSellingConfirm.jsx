import ConfirmAction from "@/lib/forms/ConfirmAction.jsx";

export default function ItemsRecordActionsItemStopSellingConfirm({
  open = false,
  onOpenChange = null,
  item = null,
  busy = false,
  problem = null,
  stopSelling = null,
  bullets = [],
}) {
  return (
    <ConfirmAction
      open={open}
      onOpenChange={onOpenChange}
      verb="Stop selling"
      object={item?.name ?? "this item"}
      consequence="It disappears from your booking page within a minute. Nothing already arranged changes."
      detail="You can put it back any time, and it keeps its history when you do."
      confirmLabel="Stop selling it"
      cancelLabel="Keep selling it"
      busy={busy}
      error={problem}
      testId="item-stop-selling"
      onConfirm={stopSelling}
      onCancel={() => onOpenChange?.(false)}
    >
      {bullets.length > 0 && (
        <div
          className="flex flex-col gap-[var(--stack)] rounded-sm bg-surface-sunken p-[var(--pad-card)] text-sm text-mute"
          data-testid="item-stop-selling-facts"
        >
          {bullets.map((b, i) => (
            <span key={i}>· {b}</span>
          ))}
        </div>
      )}
    </ConfirmAction>
  );
}
