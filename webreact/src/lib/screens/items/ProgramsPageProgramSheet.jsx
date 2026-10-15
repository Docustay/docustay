// Mirrors CategoriesPageCategorySheet.jsx exactly — same create/rename sheet shape.
import { Field, FieldLabel, FieldContent } from "@/lib/components/ui/field.jsx";
import { Input } from "@/lib/components/ui/input.jsx";
import { NativeSelect } from "@/lib/components/ui/native-select.jsx";
import SideSheet from "@/lib/forms/SideSheet.jsx";

export default function ProgramsPageProgramSheet({
  open,
  onOpenChange,
  VISIBILITY_VALUES,
  VISIBILITY_LABEL,
  sheetMode,
  sheetName,
  onSheetNameChange,
  sheetVisibility,
  onSheetVisibilityChange,
  sheetBusy,
  sheetError,
  closeSheet,
  submitSheet,
}) {
  if (!open) return null;

  return (
    <SideSheet
      title={sheetMode === "create" ? "New program" : "Rename program"}
      onCancel={closeSheet}
      onSave={submitSheet}
      busy={sheetBusy}
      error={sheetError}
      saveLabel="Save"
      testId="program-sheet"
    >
      <div className="flex flex-col">
        <Field orientation="horizontal" className="border-b border-line-soft py-2.5 last:border-b-0">
          <FieldLabel htmlFor="program-name">Name</FieldLabel>
          <FieldContent>
            <Input
              id="program-name"
              value={sheetName}
              onChange={(e) => onSheetNameChange?.(e.target.value)}
              data-testid="program-sheet-name"
              required
              maxLength="200"
              autoComplete="off"
              disabled={sheetBusy}
            />
          </FieldContent>
        </Field>

        <Field orientation="horizontal" className="border-b border-line-soft py-2.5 last:border-b-0">
          <FieldLabel htmlFor="program-visibility">On the booking page</FieldLabel>
          <FieldContent>
            <NativeSelect
              id="program-visibility"
              value={sheetVisibility}
              onChange={(e) => onSheetVisibilityChange?.(e.target.value)}
              data-testid="program-sheet-visibility"
              disabled={sheetBusy}
            >
              {VISIBILITY_VALUES.map((v) => (
                <option key={v} value={v}>
                  {VISIBILITY_LABEL[v]}
                </option>
              ))}
            </NativeSelect>
          </FieldContent>
        </Field>
      </div>
    </SideSheet>
  );
}
