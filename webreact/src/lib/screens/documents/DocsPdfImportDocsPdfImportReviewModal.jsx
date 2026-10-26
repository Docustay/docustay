// ═══════════════════════════════════════════════════════════════════════════════════════════════
// R6.011.M1 — DocsPdfImport › DocsPdfImportDocsPdfImportReviewModal: the modal as its own component
// Built on DecisionModal from webui/src/lib/screens/documents/DocsPdfImport.svelte:504-581
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useMemo } from "react";
import { Card, CardContent } from "@/lib/components/ui/card.jsx";
import { Field, FieldLabel, FieldContent } from "@/lib/components/ui/field.jsx";
import { Checkbox } from "@/lib/components/ui/checkbox.jsx";
import { NativeSelect, NativeSelectOption } from "@/lib/components/ui/native-select.jsx";
import DecisionModal from "@/lib/forms/DecisionModal.jsx";
import StatusBadge from "@/lib/components/kit/StatusBadge.jsx";
import BlockerBanner from "@/lib/components/editor/BlockerBanner.jsx";
import { VARIABLES } from "@keystone/documents/variableCatalogue.mjs";

export default function DocsPdfImportDocsPdfImportReviewModal({
  open,
  onOpenChange,
  numberWord,
  error,
  fields,
  confirmBusy,
  confirmError,
  fieldStatusTone,
  fieldStatusLabel,
  foundCount,
  keptFields,
  skippedCount,
  blockingFields,
  closeReview,
  submitConfirm,
  updateField,
}) {
  const rows = useMemo(() => [
    {
      headline: `${keptFields.length} will be filled in`,
      detail: "These become blanks the client fills in when they sign.",
    },
    {
      headline: `${skippedCount} skipped`,
      detail: "Left as plain text in the document, unchanged.",
    },
  ], [keptFields.length, skippedCount]);

  return (
    <DecisionModal
      open={open}
      onOpenChange={onOpenChange}
      title={`Check the ${numberWord(foundCount)} thing${foundCount === 1 ? "" : "s"} we found`}
      subtitle="You'll check each one before anything is used."
      rows={rows}
      cancelLabel="Cancel"
      confirmLabel="Build the draft"
      onCancel={closeReview}
      onConfirm={submitConfirm}
      busy={confirmBusy}
      confirmDisabled={blockingFields.length > 0}
      error={confirmError}
      wide
      testId="docs-pdf-import-review"
    >
      {blockingFields.length > 0 && (
        <BlockerBanner
          count={blockingFields.length}
          items={blockingFields.map((f) => f.label)}
          testId="docs-pdf-import-blocker"
        />
      )}
      <div className="flex flex-col gap-6" data-testid="docs-pdf-import-field-list">
        {fields.map((f, idx) => (
          <Card key={f.localId} data-testid={`docs-pdf-import-field-${f.localId}`}>
            <CardContent className="flex flex-col gap-6">
              <div className="flex items-center justify-between gap-4">
                <span className="text-ink font-medium">{f.label}</span>
                <StatusBadge
                  label={fieldStatusLabel(f)}
                  tone={fieldStatusTone(f)}
                  testId={`docs-pdf-import-field-${f.localId}-status`}
                />
              </div>
              {f.snippet && (
                <p className="text-sm text-ink-muted italic leading-relaxed m-0">
                  &ldquo;{f.snippet}&rdquo;
                </p>
              )}
              <Field orientation="horizontal" className="gap-4">
                <FieldLabel htmlFor={`pdfimport-keep-${f.localId}`}>Keep it</FieldLabel>
                <FieldContent>
                  <Checkbox
                    id={`pdfimport-keep-${f.localId}`}
                    checked={f.keep}
                    onCheckedChange={(v) => {
                      updateField(idx, { keep: !!v });
                    }}
                    data-testid={`docs-pdf-import-field-${f.localId}-keep`}
                  />
                </FieldContent>
              </Field>
              {f.kind !== "signature" && (
                <Field orientation="horizontal" className="gap-4">
                  <FieldLabel htmlFor={`pdfimport-variable-${f.localId}`}>Fills in with</FieldLabel>
                  <FieldContent>
                    <NativeSelect
                      id={`pdfimport-variable-${f.localId}`}
                      value={f.variable ?? ""}
                      onChange={(e) => {
                        updateField(idx, { variable: e.currentTarget.value || null });
                      }}
                      data-testid={`docs-pdf-import-field-${f.localId}-variable`}
                    >
                      <NativeSelectOption value="">Leave it out</NativeSelectOption>
                      {VARIABLES.map((v) => (
                        <NativeSelectOption key={v.name} value={v.name}>
                          {v.label}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                  </FieldContent>
                </Field>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </DecisionModal>
  );
}
