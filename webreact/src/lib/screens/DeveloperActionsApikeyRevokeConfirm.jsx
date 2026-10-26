// ═══════════════════════════════════════════════════════════════════════════════════════════════
// DeveloperActionsApikeyRevokeConfirm — the confirm dialog for revoking an API key.
// Ported from webui/src/lib/screens/DeveloperActions.svelte:186-199 (the <ConfirmAction> element).
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import ConfirmAction from "@/lib/forms/ConfirmAction.jsx";

export default function DeveloperActionsApikeyRevokeConfirm({
  open = false,
  onOpenChange = null,
  revoking = null,
  created = null,
  busy = false,
  problem = null,
  revoke = null,
}) {
  return (
    <ConfirmAction
      open={open}
      onOpenChange={onOpenChange}
      verb="Revoke"
      object={revoking?.name ?? "this key"}
      consequence="Anything using this key stops working immediately. It cannot be un-revoked — a replacement has to be created and swapped in."
      detail={revoking?.fingerprint ? `Fingerprint ${revoking.fingerprint}.` : null}
      confirmLabel="Revoke it"
      cancelLabel="Keep it"
      busy={busy}
      error={problem}
      testId="apikey-revoke"
      onConfirm={revoke}
      onCancel={() => onOpenChange?.(false)}
    />
  );
}
