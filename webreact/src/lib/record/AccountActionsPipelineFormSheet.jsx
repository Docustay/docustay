import { api } from "@/lib/api.js";
import ActionSurface from "@/lib/forms/ActionSurface.jsx";

export default function AccountActionsPipelineFormSheet({
  open = false,
  onOpenChange = null,
  account = null,
  busy = false,
  problem = null,
  run = null,
}) {
  if (!open) return null;

  return (
    <ActionSurface
      kind="dialog"
      title="Start a pipeline"
      testId="pipeline-form"
      busy={busy}
      error={problem}
      submitLabel="Start it"
      onCancel={() => onOpenChange?.(false)}
      onSubmit={() => run?.(() => api.createAccountPipeline({ accountId: account.id }))}
    >
      <p className="text-control text-mute">
        This starts the onboarding pipeline for <strong>{account?.name}</strong>.
      </p>
    </ActionSurface>
  );
}
