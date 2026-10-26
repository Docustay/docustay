import { api } from "@/lib/api.js";
import ConfirmAction from "@/lib/forms/ConfirmAction.jsx";

export default function DocumentActionsDocVersionConfirm({
  open = false,
  onOpenChange = null,
  doc = null,
  template = null,
  busy = false,
  problem = null,
  run = null,
}) {
  const newVersion = (template?.version ?? 0) + 1;
  const templateName = template?.name ?? "this template";

  return (
    <ConfirmAction
      open={open}
      onOpenChange={onOpenChange}
      verb="Create version"
      object={`${newVersion} of ${templateName}`}
      consequence="Everything sent from now on uses the new version. Instruments already sent keep the wording they were sent with — a sent instrument never re-picks up its template."
      detail="That is why an edit is refused once anything has been sent: it would show you the correction and change none of them."
      confirmLabel="Create the new version"
      cancelLabel="Cancel"
      busy={busy}
      error={problem}
      testId="doc-version"
      onConfirm={() => run?.(async () => {
        await api.newTemplateVersion({ templateId: template?.id });
      })}
      onCancel={() => onOpenChange?.(false)}
    />
  );
}
