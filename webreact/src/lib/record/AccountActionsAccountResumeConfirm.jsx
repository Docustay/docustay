import { api } from "@/lib/api.js";
import ConfirmAction from "@/lib/forms/ConfirmAction.jsx";

export default function AccountActionsAccountResumeConfirm({
  open = false,
  onOpenChange = null,
  account = null,
  pausedCount = 0,
  blocked = [],
  busy = false,
  problem = null,
  run = null,
}) {
  return (
    <ConfirmAction
      open={open}
      onOpenChange={onOpenChange}
      verb="Resume work for"
      object={account?.name ?? "this account"}
      consequence={`${pausedCount} paused item${pausedCount === 1 ? "" : "s"} start running again from now.`}
      detail={
        blocked.length
          ? `${blocked.length} other item${blocked.length === 1 ? " is" : "s are"} blocked rather than paused, and this will not affect ${blocked.length === 1 ? "it" : "them"}.`
          : null
      }
      confirmLabel="Resume it"
      cancelLabel="Leave it paused"
      busy={busy}
      error={problem}
      testId="account-resume"
      onConfirm={() => run?.(() => api.resumeAccountRun({ accountId: account.id }))}
      onCancel={() => onOpenChange?.(false)}
    />
  );
}
