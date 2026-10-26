import { api } from "@/lib/api.js";
import { Input } from "@/lib/components/ui/input.jsx";
import ConfirmAction from "@/lib/forms/ConfirmAction.jsx";

export default function DocumentActionsDocDeclineConfirm({
  open = false,
  onOpenChange = null,
  document = null,
  doc = null,
  declineReason = "",
  onDeclineReasonChange = null,
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
      verb="Decline"
      object={`${named}${forWhom}`}
      consequence="The document stops here. It cannot be signed afterwards, and sending it again means issuing a new one."
      confirmLabel="Decline it"
      cancelLabel="Keep it open"
      busy={busy}
      error={problem}
      testId="doc-decline"
      onConfirm={() =>
        run?.(async () => {
          await api.declineDocument({
            instanceId: doc?.id,
            reason: declineReason.trim() || undefined,
          });
          onDeclineReasonChange?.("");
        })
      }
      onCancel={() => onOpenChange?.(false)}
    >
      <label className="flex flex-col gap-2">
        <span className="text-sm font-medium text-ink">
          Why was it declined? (optional, recorded)
        </span>
        <Input
          type="text"
          data-testid="doc-decline-reason"
          value={declineReason}
          onChange={(e) => onDeclineReasonChange?.(e.target.value)}
          maxLength={500}
          autoComplete="off"
          placeholder="The fee schedule needs changing"
        />
      </label>
    </ConfirmAction>
  );
}
