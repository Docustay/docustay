// ═══════════════════════════════════════════════════════════════════════════════════════════════
// R8.009.M1 — IntegrationsScreenIntegrationDisconnectConfirm.
//
// The confirm dialog for disconnecting an integration, built on ConfirmAction.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import ConfirmAction from "@/lib/forms/ConfirmAction.jsx";

export default function IntegrationsScreenIntegrationDisconnectConfirm({
  open = false,
  onOpenChange = null,
  connected = [],
  busy = false,
  problem = null,
  disconnectTarget = null,
  DISCONNECT_TEXT = {},
  confirmDisconnect = null,
}) {
  return (
    <ConfirmAction
      open={open}
      onOpenChange={onOpenChange}
      verb="Disconnect"
      object={disconnectTarget?.name ?? "this service"}
      consequence={DISCONNECT_TEXT[disconnectTarget?.key] ?? "The service will be disconnected."}
      confirmLabel="Disconnect it"
      cancelLabel="Keep it connected"
      busy={busy}
      error={problem}
      testId="integration-disconnect-confirm"
      onConfirm={confirmDisconnect}
      onCancel={() => { onOpenChange?.(false); }}
    />
  );
}
