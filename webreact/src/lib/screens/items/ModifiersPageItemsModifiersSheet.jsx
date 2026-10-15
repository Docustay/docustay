// ═══════════════════════════════════════════════════════════════════════════════════════════════
// R5.035.M1 — ModifiersPage › ModifiersPageItemsModifiersSheet: the sheet as its own component
// Built on SideSheet from webui/src/lib/screens/items/ModifiersPage.svelte:426-500
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useState } from "react";
import { Field, FieldLabel, FieldContent } from "@/lib/components/ui/field.jsx";
import { Input } from "@/lib/components/ui/input.jsx";
import { NativeSelect } from "@/lib/components/ui/native-select.jsx";
import SideSheet from "@/lib/forms/SideSheet.jsx";
import FieldMoney from "@/lib/components/editor/FieldMoney.jsx";
import FieldDuration from "@/lib/components/editor/FieldDuration.jsx";
import ProgramGate from "@/lib/components/ProgramGate.jsx";

export default function ModifiersPageItemsModifiersSheet({
  open,
  onOpenChange,
  data,
  serviceOptions,
  currency,
  editingId,
  name,
  onNameChange,
  priceDeltaMinor,
  onPriceDeltaMinorChange,
  minutesDelta,
  onMinutesDeltaChange,
  applies,
  onAppliesChange,
  serviceIds,
  onServiceIdsChange,
  afterTimeInput,
  onAfterTimeInputChange,
  busy,
  error,
  closeSheet,
  submitSheet,
}) {
  // ★ the maintainer, 29 Sep 2026 (life coaching brief) — "Specific services" asks which program first, same
  //   pattern as AddLineRow/CouponEditor (ProgramGate; "No program" is a choice, id null). Local state: this component remounts each time the sheet
  //   opens (ModifiersPage.jsx renders it only `{sheetOpen && <...>}`).
  const [servicesGroup, setServicesGroup] = useState(null);

  if (!open) return null;

  return (
    <SideSheet
      title={editingId ? "Edit modifier" : "New modifier"}
      onCancel={closeSheet}
      onSave={submitSheet}
      busy={busy}
      error={error}
      saveLabel="Save"
      testId="items-modifiers-sheet"
    >
      <form onSubmit={submitSheet} className="flex flex-col gap-6">
        <Field orientation="horizontal" className="border-b border-line-soft py-1.5">
          <FieldLabel htmlFor="mod-name">Name</FieldLabel>
          <FieldContent>
            <Input
              id="mod-name"
              value={name}
              onChange={(e) => onNameChange(e.target.value)}
              data-testid="items-modifiers-name"
              required
              maxLength="200"
              autoComplete="off"
              disabled={busy}
            />
          </FieldContent>
        </Field>

        <FieldMoney
          valueMinor={priceDeltaMinor}
          onValueMinorChange={onPriceDeltaMinorChange}
          currency={currency}
          allowNegative
          label="Price delta"
          helper="What this adds to the price. A negative amount (e.g. -45.00) reduces it."
          testId="items-modifiers-price-delta"
          disabled={busy}
        />

        <FieldDuration
          minutes={minutesDelta}
          onMinutesChange={onMinutesDeltaChange}
          allowNegative
          label="Minutes delta"
          helper="What this adds to the length. A negative number (e.g. -15) shortens it."
          testId="items-modifiers-minutes-delta"
          disabled={busy}
        />

        <Field orientation="horizontal" className="border-b border-line-soft py-1.5">
          <FieldLabel htmlFor="mod-applies">Applies to</FieldLabel>
          <FieldContent>
            <NativeSelect
              id="mod-applies"
              value={applies}
              onChange={(e) => onAppliesChange(e.target.value)}
              data-testid="items-modifiers-applies"
              disabled={busy}
            >
              <option value="all">All services</option>
              <option value="one_to_one">All 1:1 services</option>
              <option value="list">Specific services</option>
            </NativeSelect>
          </FieldContent>
        </Field>

        {applies === "list" && !servicesGroup && (
          <Field orientation="horizontal" className="border-b border-line-soft py-1.5">
            <FieldLabel>Which services</FieldLabel>
            <FieldContent>
              <ProgramGate onChoose={setServicesGroup} testId="items-modifiers-services-group-gate" />
            </FieldContent>
          </Field>
        )}

        {applies === "list" && servicesGroup && (
          <Field orientation="horizontal" className="border-b border-line-soft py-1.5">
            <FieldLabel htmlFor="mod-services">Which services</FieldLabel>
            <FieldContent>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs text-mute" data-testid="items-modifiers-services-group-label">
                  {servicesGroup.name}
                </span>
                <button
                  type="button"
                  className="text-xs text-brand underline"
                  onClick={() => setServicesGroup(null)}
                  data-testid="items-modifiers-services-group-change"
                >
                  Change
                </button>
              </div>
              <NativeSelect
                id="mod-services"
                multiple
                size={Math.min(6, Math.max(3, serviceOptions.filter((s) => (s.program_id ?? null) === servicesGroup.id).length))}
                value={serviceIds}
                onChange={(e) => {
                  const selected = Array.from(e.target.selectedOptions, option => option.value);
                  onServiceIdsChange(selected);
                }}
                data-testid="items-modifiers-services"
                disabled={busy}
              >
                {serviceOptions
                  .filter((s) => (s.program_id ?? null) === servicesGroup.id)
                  .map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
              </NativeSelect>
            </FieldContent>
          </Field>
        )}

        <Field orientation="horizontal" className="border-b border-line-soft py-1.5">
          <FieldLabel htmlFor="mod-after-time">After time</FieldLabel>
          <FieldContent>
            <Input
              id="mod-after-time"
              type="time"
              value={afterTimeInput}
              onChange={(e) => onAfterTimeInputChange(e.target.value)}
              data-testid="items-modifiers-after-time"
              disabled={busy}
            />
            <p className="text-xs text-mute mt-1.5">Only offered from this time of day onward. Leave blank for any time.</p>
          </FieldContent>
        </Field>
      </form>
    </SideSheet>
  );
}
