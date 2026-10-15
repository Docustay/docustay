// ═══════════════════════════════════════════════════════════════════════════════════════════════
// UnitsPageItemsUnitsCreateSheet — R5.043.M1, the create sheet as its own component
// Built from webui/src/lib/screens/items/UnitsPage.svelte:319-344 (SideSheet with form fields)
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { Field, FieldLabel, FieldContent } from "@/lib/components/ui/field.jsx";
import { Input } from "@/lib/components/ui/input.jsx";
import SideSheet from "@/lib/forms/SideSheet.jsx";

export default function UnitsPageItemsUnitsCreateSheet({
  open,
  onOpenChange,
  error,
  units,
  createName,
  createPlural,
  createBusy,
  createError,
  closeCreate,
  submitCreate,
  onCreateNameChange,
  onCreatePluralChange,
}) {
  if (!open) return null;

  return (
    <SideSheet
      title="New unit"
      onCancel={closeCreate}
      onSave={submitCreate}
      busy={createBusy}
      error={createError}
      saveLabel="Save"
      testId="items-units-create-sheet"
    >
      <div className="flex flex-col gap-stack p-5">
        <Field orientation="horizontal" className="py-[6px] border-b border-line-soft last:border-b-0">
          <FieldLabel htmlFor="items-units-create-name">Name</FieldLabel>
          <FieldContent>
            <Input
              id="items-units-create-name"
              value={createName}
              onChange={(e) => onCreateNameChange(e.target.value)}
              data-testid="items-units-create-name"
              maxLength="40"
              autoComplete="off"
            />
          </FieldContent>
        </Field>
        <Field orientation="horizontal" className="py-[6px] border-b border-line-soft last:border-b-0">
          <FieldLabel htmlFor="items-units-create-plural">Plural</FieldLabel>
          <FieldContent>
            <Input
              id="items-units-create-plural"
              value={createPlural}
              onChange={(e) => onCreatePluralChange(e.target.value)}
              data-testid="items-units-create-plural"
              maxLength="40"
              autoComplete="off"
            />
          </FieldContent>
        </Field>
      </div>
    </SideSheet>
  );
}
