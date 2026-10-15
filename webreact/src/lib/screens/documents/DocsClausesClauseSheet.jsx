// ═══════════════════════════════════════════════════════════════════════════════════════════════
// R6.007.M1 — DocsClausesClauseSheet. Modal form for creating/editing a clause.
// Props: { open, onOpenChange, testId, KIND_VALUES, KIND_LABEL, error, rows, sheetMode,
//          sheetName, sheetGist, sheetKind, sheetBody, sheetBusy, sheetError, closeSheet, submitSheet }
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import SideSheet from "@/lib/forms/SideSheet.jsx";
import { Field, FieldLabel, FieldContent } from "@/lib/components/ui/field.jsx";
import { Input } from "@/lib/components/ui/input.jsx";
import { Textarea } from "@/lib/components/ui/textarea.jsx";
import { NativeSelect } from "@/lib/components/ui/native-select.jsx";

export default function DocsClausesClauseSheet({
  open = false,
  onOpenChange = null,
  testId = "clause-sheet",
  KIND_VALUES = [],
  KIND_LABEL = {},
  error = null,
  rows = [],
  sheetMode = "create",
  sheetName = "",
  sheetGist = "",
  sheetKind = "yours",
  sheetBody = "",
  sheetBusy = false,
  sheetError = null,
  closeSheet = null,
  submitSheet = null,
  onNameChange = null,
  onGistChange = null,
  onKindChange = null,
  onBodyChange = null,
}) {
  if (!open) return null;

  const handleCancel = () => {
    closeSheet?.();
    onOpenChange?.(false);
  };

  const handleSave = async (e) => {
    e?.preventDefault?.();
    await submitSheet?.(e);
  };

  return (
    <SideSheet
      title={sheetMode === "create" ? "New clause" : "Edit clause"}
      onCancel={handleCancel}
      onSave={handleSave}
      busy={sheetBusy}
      dirty={!!(sheetName.trim() || sheetGist.trim() || sheetBody.trim())}
      error={sheetError}
      saveLabel="Save"
      testId={testId}
    >
      <div className="flex flex-col">
        <Field orientation="horizontal">
          <FieldLabel htmlFor="clause-name">Name</FieldLabel>
          <FieldContent>
            <Input
              id="clause-name"
              value={sheetName}
              onChange={(e) => onNameChange?.(e.target.value)}
              data-testid="clause-sheet-name"
              required
              maxLength="200"
              autoComplete="off"
              disabled={sheetBusy}
            />
          </FieldContent>
        </Field>

        <Field orientation="horizontal">
          <FieldLabel htmlFor="clause-gist">One-line gist</FieldLabel>
          <FieldContent>
            <Input
              id="clause-gist"
              value={sheetGist}
              onChange={(e) => onGistChange?.(e.target.value)}
              data-testid="clause-sheet-gist"
              required
              maxLength="200"
              autoComplete="off"
              disabled={sheetBusy}
            />
          </FieldContent>
        </Field>

        <Field orientation="horizontal">
          <FieldLabel htmlFor="clause-kind">Kind</FieldLabel>
          <FieldContent>
            <NativeSelect
              id="clause-kind"
              value={sheetKind}
              onChange={(e) => onKindChange?.(e.target.value)}
              data-testid="clause-sheet-kind"
              disabled={sheetBusy}
            >
              {KIND_VALUES.map((k) => (
                <option key={k} value={k}>
                  {KIND_LABEL[k] || k}
                </option>
              ))}
            </NativeSelect>
          </FieldContent>
        </Field>

        {sheetMode === "create" && (
          <Field orientation="horizontal">
            <FieldLabel htmlFor="clause-body">What it says</FieldLabel>
            <FieldContent>
              <Textarea
                id="clause-body"
                value={sheetBody}
                onChange={(e) => onBodyChange?.(e.target.value)}
                data-testid="clause-sheet-body"
                required
                rows={6}
                disabled={sheetBusy}
              />
              <p className="mt-1.5 text-meta text-mute">
                Plain text only — no formatting is stored (P15C's schema).
              </p>
            </FieldContent>
          </Field>
        )}
      </div>
    </SideSheet>
  );
}
