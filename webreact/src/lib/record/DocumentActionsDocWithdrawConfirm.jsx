import { api } from "@/lib/api.js";
import ConfirmAction from "@/lib/forms/ConfirmAction.jsx";

export default function DocumentActionsDocWithdrawConfirm({
  open = false,
  onOpenChange = null,
  doc = null,
  busy = false,
  problem = null,
  run = null,
}) {
  return (
    <ConfirmAction
      open={open}
      onOpenChange={onOpenChange}
      verb="Withdraw"
      object="consent to sign electronically"
      consequence="Nothing can be signed electronically after this. Documents already signed keep their signatures — withdrawing consent is not a way to undo one."
      confirmLabel="Withdraw consent"
      cancelLabel="Keep consent"
      busy={busy}
      error={problem}
      testId="doc-withdraw"
      onConfirm={() => run?.(async () => {
        await api.withdrawDisclosure({});
      })}
      onCancel={() => onOpenChange?.(false)}
    />
  );
}
