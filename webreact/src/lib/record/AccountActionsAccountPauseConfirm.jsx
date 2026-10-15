import { api } from "@/lib/api.js";
import ConfirmAction from "@/lib/forms/ConfirmAction.jsx";

export default function AccountActionsAccountPauseConfirm({
  open = false,
  onOpenChange = null,
  account = null,
  runningCount = 0,
  busy = false,
  problem = null,
  run = null,
}) {
  return (
    <ConfirmAction
      open={open}
      onOpenChange={onOpenChange}
      verb="Pause work for"
      object={account?.name ?? "this account"}
      consequence={`${runningCount} scheduled item${runningCount === 1 ? "" : "s"} stop running. Nothing is deleted, and Resume puts them back.`}
      detail="This is a choice to stop, not a failure — it stays paused until somebody resumes it."
      confirmLabel="Pause it"
      cancelLabel="Keep it running"
      busy={busy}
      error={problem}
      testId="account-pause"
      onConfirm={() => run?.(() => api.pauseAccountRun({ accountId: account.id }))}
      onCancel={() => onOpenChange?.(false)}
    />
  );
}
