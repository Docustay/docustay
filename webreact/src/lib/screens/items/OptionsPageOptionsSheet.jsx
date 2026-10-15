import { Field, FieldLabel, FieldContent } from "@/lib/components/ui/field.jsx";
import { Input } from "@/lib/components/ui/input.jsx";
import { NativeSelect } from "@/lib/components/ui/native-select.jsx";
import { Switch } from "@/lib/components/ui/switch.jsx";
import { Button } from "@/lib/components/ui/button.jsx";
import SideSheet from "@/lib/forms/SideSheet.jsx";
import InlineValidation from "@/lib/components/editor/InlineValidation.jsx";

export default function OptionsPageOptionsSheet({
  open,
  onOpenChange,
  error,
  sheetMode,
  sheetBusy,
  sheetError,
  sheetErrorRequestId,
  question,
  onQuestionChange,
  kind,
  onKindChange,
  choices,
  required,
  onRequiredChange,
  closeSheet,
  addChoice,
  removeChoice,
  setChoice,
  submitSheet,
  dirty,
}) {
  if (!open) return null;

  return (
    <SideSheet
      title={sheetMode === "edit" ? "Edit option" : "New option"}
      onCancel={closeSheet}
      onSave={submitSheet}
      busy={sheetBusy}
      dirty={dirty}
      testId="options-sheet"
    >
      <InlineValidation message={sheetError} requestId={sheetErrorRequestId} testId="options-sheet-error" />

      <Field orientation="horizontal" data-testid="options-sheet-row-question">
        <FieldLabel htmlFor="options-sheet-question">Question</FieldLabel>
        <FieldContent>
          <Input
            id="options-sheet-question"
            data-testid="options-sheet-question"
            value={question}
            onChange={(e) => onQuestionChange?.(e.target.value)}
            required
            disabled={sheetBusy}
          />
        </FieldContent>
      </Field>

      <Field orientation="horizontal" data-testid="options-sheet-row-kind">
        <FieldLabel htmlFor="options-sheet-kind">Type</FieldLabel>
        <FieldContent>
          <NativeSelect
            id="options-sheet-kind"
            data-testid="options-sheet-kind"
            value={kind}
            onChange={(e) => onKindChange?.(e.target.value)}
            disabled={sheetBusy}
          >
            <option value="choice">Choice — pick from a list</option>
            <option value="text">Text — a box they type in</option>
          </NativeSelect>
        </FieldContent>
      </Field>

      {kind === "choice" && (
        <Field orientation="horizontal" data-testid="options-sheet-row-choices">
          <FieldLabel>Answers</FieldLabel>
          <FieldContent>
            <div className="flex flex-col gap-1.5">
              {choices.map((choice, i) => (
                <div key={i} className="flex items-center gap-1.5 mb-1.5">
                  <Input
                    value={choice}
                    data-testid={`options-sheet-choice-${i}`}
                    onChange={(e) => setChoice(i, e.target.value)}
                    disabled={sheetBusy}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    data-testid={`options-sheet-choice-remove-${i}`}
                    disabled={sheetBusy}
                    onClick={() => removeChoice(i)}
                  >
                    Remove
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                data-testid="options-sheet-choice-add"
                disabled={sheetBusy}
                onClick={addChoice}
              >
                Add an answer
              </Button>
            </div>
          </FieldContent>
        </Field>
      )}

      <Field orientation="horizontal" data-testid="options-sheet-row-required">
        <FieldLabel htmlFor="options-sheet-required">Required</FieldLabel>
        <FieldContent>
          <Switch
            id="options-sheet-required"
            checked={required}
            disabled={sheetBusy}
            data-testid="options-sheet-required"
            onCheckedChange={(v) => onRequiredChange?.(v)}
          />
        </FieldContent>
      </Field>
    </SideSheet>
  );
}
