import ConfirmAction from "@/lib/forms/ConfirmAction.jsx";
import { Input } from "@/lib/components/ui/input.jsx";

export default function SetBillingBillingCancelConfirm({
  open = false,
  onOpenChange = null,
  cancelTyped = "",
  cancelBusy = false,
  cancelError = null,
  onCancelTypedChange = null,
  confirmCancel = null,
  onCancel = null,
}) {
  return (
    <ConfirmAction
      open={open}
      onOpenChange={onOpenChange}
      object="Workbench for this practice"
      verb="Cancel"
      consequence="This practice goes read-only for 90 days. You can export your data any time during that window. Nothing is deleted."
      confirmLabel="Cancel Workbench"
      busy={cancelBusy}
      error={cancelError}
      testId="billing-cancel-confirm"
      onConfirm={confirmCancel}
      onCancel={onCancel}
    >
      <label className="flex flex-col gap-1.5 text-sm font-medium text-foreground" htmlFor="billing-cancel-name">
        Type this practice's name to confirm
        <Input
          id="billing-cancel-name"
          data-testid="billing-cancel-name"
          value={cancelTyped}
          onChange={(e) => onCancelTypedChange?.(e.target.value)}
          autoComplete="off"
        />
      </label>
    </ConfirmAction>
  );
}
