import ConfirmAction from "@/lib/forms/ConfirmAction.jsx";

export default function EmailSettingsPageEmailDisconnectConfirm({
  open = false,
  onOpenChange,
  mailbox,
  busy = false,
  problem = null,
  breaks = [],
  confirmDisconnect,
}) {
  const consequence = breaks.length
    ? `${breaks.map((b) => b.label.toLowerCase()).join(", ")} are sent from this mailbox and will STOP. They are not moved to another address — Workbench refuses to send from an address you did not choose.`
    : "Nothing is currently routed through this mailbox, so no mail is affected.";

  const detail = "Sign-in and password emails are unaffected — they never come from your mailbox.";

  return (
    <ConfirmAction
      open={open}
      onOpenChange={onOpenChange}
      verb="Disconnect"
      object={mailbox?.email ?? "this mailbox"}
      consequence={consequence}
      detail={detail}
      confirmLabel="Disconnect it"
      cancelLabel="Keep it connected"
      busy={busy}
      error={problem}
      testId="email-disconnect-confirm"
      onConfirm={confirmDisconnect}
      onCancel={() => onOpenChange?.(false)}
    />
  );
}
