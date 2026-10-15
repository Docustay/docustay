import SideSheet from "@/lib/forms/SideSheet.jsx";
import { Field, FieldLabel, FieldContent } from "@/lib/components/ui/field.jsx";
import { Input } from "@/lib/components/ui/input.jsx";

export default function LoyaltyPageLoyaltyRewardSheet({
  open = false,
  onOpenChange = null,
  error = null,
  loyalty = null,
  rewardName = "",
  rewardPointsInput = "",
  rewardBusy = false,
  rewardError = null,
  closeRewardSheet = null,
  submitRewardSheet = null,
  onNameChange = null,
  onPointsChange = null,
}) {
  if (!open) return null;

  return (
    <SideSheet
      title="Add a reward"
      onCancel={closeRewardSheet}
      onSave={submitRewardSheet}
      busy={rewardBusy}
      error={rewardError ? `${rewardError.message}${rewardError.requestId ? ` (ref ${rewardError.requestId})` : ""}` : null}
      saveLabel="Save"
      testId="loyalty-reward-sheet"
    >
      <div className="flex flex-col gap-6 py-5 px-5.5">
        <Field orientation="horizontal">
          <FieldLabel htmlFor="loyalty-reward-name">Name</FieldLabel>
          <FieldContent>
            <Input
              id="loyalty-reward-name"
              type="text"
              value={rewardName}
              onChange={(e) => onNameChange?.(e.target.value)}
              data-testid="loyalty-reward-name"
              required
              maxLength={200}
              autoComplete="off"
            />
          </FieldContent>
        </Field>
        <Field orientation="horizontal">
          <FieldLabel htmlFor="loyalty-reward-points">Points cost</FieldLabel>
          <FieldContent>
            <Input
              id="loyalty-reward-points"
              type="number"
              min="1"
              step="1"
              value={rewardPointsInput}
              onChange={(e) => onPointsChange?.(e.target.value)}
              data-testid="loyalty-reward-points"
            />
          </FieldContent>
        </Field>
      </div>
    </SideSheet>
  );
}
