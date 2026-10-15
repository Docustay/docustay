import { Field, FieldLabel, FieldContent } from "@/lib/components/ui/field.jsx";
import { Input } from "@/lib/components/ui/input.jsx";
import { NativeSelect } from "@/lib/components/ui/native-select.jsx";
import SideSheet from "@/lib/forms/SideSheet.jsx";

export default function CategoriesPageCategorySheet({
  open,
  onOpenChange,
  VISIBILITY_VALUES,
  VISIBILITY_LABEL,
  error,
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
      title={sheetMode === "create" ? "New category" : "Rename category"}
      onCancel={closeSheet}
      onSave={submitSheet}
      busy={sheetBusy}
      error={sheetError}
      saveLabel="Save"
      testId="category-sheet"
    >
      <div className="flex flex-col">
        <Field orientation="horizontal" className="border-b border-line-soft py-2.5 last:border-b-0">
          <FieldLabel htmlFor="category-name">Name</FieldLabel>
          <FieldContent>
            <Input
              id="category-name"
              value={sheetName}
              onChange={(e) => onSheetNameChange?.(e.target.value)}
              data-testid="category-sheet-name"
              required
              maxLength="200"
              autoComplete="off"
              disabled={sheetBusy}
            />
          </FieldContent>
        </Field>

        <Field orientation="horizontal" className="border-b border-line-soft py-2.5 last:border-b-0">
          <FieldLabel htmlFor="category-visibility">On the booking page</FieldLabel>
          <FieldContent>
            <NativeSelect
              id="category-visibility"
              value={sheetVisibility}
              onChange={(e) => onSheetVisibilityChange?.(e.target.value)}
              data-testid="category-sheet-visibility"
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
