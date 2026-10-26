import { api } from "@/lib/api.js";
import ConfirmAction from "@/lib/forms/ConfirmAction.jsx";

export default function DocumentActionsDocExecuteConfirm({
  open = false,
  onOpenChange = null,
  doc = null,
  busy = false,
  problem = null,
  run = null,
  named = "this document",
  forWhom = "",
}) {
  return (
    <ConfirmAction
      open={open}
      onOpenChange={onOpenChange}
      verb="Execute"
      object={`${named}${forWhom}`}
      consequence="This makes it final. After this nobody can change it."
      detail="The price and terms stay exactly as they are now."
      confirmLabel="Execute it"
      cancelLabel="Not yet"
      busy={busy}
      error={problem}
      testId="doc-execute"
      onConfirm={() => run?.(async () => {
        await api.executeDocument({ instanceId: doc?.id });
      })}
      onCancel={() => onOpenChange?.(false)}
    />
  );
}
