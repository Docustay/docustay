import { api } from "@/lib/api.js";
import ActionSurface from "@/lib/forms/ActionSurface.jsx";
import { Input } from "@/lib/components/ui/input.jsx";

export default function AccountActionsAdvanceFormSheet({
  open = false,
  onOpenChange = null,
  account = null,
  busy = false,
  problem = null,
  stage = "",
  setStage = null,
  run = null,
}) {
  if (!open) return null;

  return (
    <ActionSurface
      kind="dialog"
      title="Move to the next stage"
      testId="advance-form"
      busy={busy}
      error={problem}
      submitLabel="Move it"
      submitDisabled={!stage.trim()}
      onCancel={() => onOpenChange?.(false)}
      onSubmit={() =>
        run?.(() =>
          api.advanceAccountStage({ pipelineId: account.pipeline_id, stage: stage.trim() })
        )
      }
    >
      <label className="flex flex-col gap-1.5">
        <span className="text-meta font-medium text-ink">Next stage</span>
        <Input
          data-testid="advance-stage"
          value={stage}
          onChange={(e) => setStage?.(e.target.value)}
          maxLength={80}
        />
      </label>
      {/* ★★ IT TAKES A `pipelineId`, NOT AN `accountId` — and I very nearly shipped a SECOND client
           method for this route that took the wrong one. `advanceAccountStage` already existed.
           ★★★ TWO CLIENT METHODS FOR ONE WRITE IS THE DEFECT `api.js` ALREADY RECORDS ABOUT
           `createBooking`, and the duplicate would have been the one with the wrong parameter: the
           server's WHERE clause is `kind = 'build' AND state = 'active'`, so a body naming an account
           matches nothing and returns a 404 whose one message covers four conditions. That refusal is
           the most informative text in the feature — and it would have been reporting MY bug. */}
      <p className="text-meta text-mute">
        Build pipelines only. A run pipeline has no stage to advance.
      </p>
    </ActionSurface>
  );
}
