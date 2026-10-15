import DecisionModal from "@/lib/forms/DecisionModal.jsx";
import { Field, FieldLabel, FieldContent } from "@/lib/components/ui/field.jsx";
import { Textarea } from "@/lib/components/ui/textarea.jsx";

export default function CalendarFlagModalCalendarFlagModal({
  open = false,
  onOpenChange,
  OPTIONS,
  subtitle,
  selected,
  onSelect,
  why,
  onWhyChange,
  busy,
  error,
  confirmDisabled,
  cancel,
  submit,
}) {
  return (
    <DecisionModal
      open={open}
      onOpenChange={onOpenChange}
      title="Flag this session"
      subtitle={subtitle}
      options={OPTIONS}
      selected={selected}
      onSelect={onSelect}
      cancelLabel="Cancel"
      confirmLabel="Flag it"
      busy={busy}
      confirmDisabled={confirmDisabled}
      error={error}
      onCancel={cancel}
      onConfirm={submit}
      testId="calendar-flag"
    >
      <Field data-testid="calendar-flag-why-field">
        <FieldLabel htmlFor="calendar-flag-why">Why</FieldLabel>
        <FieldContent>
          <Textarea
            id="calendar-flag-why"
            data-testid="calendar-flag-why"
            maxLength={500}
            placeholder="A line for your team."
            value={why}
            onChange={(e) => onWhyChange?.(e.target.value)}
          />
        </FieldContent>
      </Field>
    </DecisionModal>
  );
}
