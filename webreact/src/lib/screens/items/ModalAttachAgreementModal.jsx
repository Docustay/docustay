// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ModalAttachAgreementModal — the main form modal for selecting templates and options
// Ported from webui/src/lib/screens/items/ModalAttachAgreement.svelte:187-257 (the form state)
// Built on DecisionModal archetype; uses Field, NativeSelect, Switch components
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useEffect, useState } from "react";
import DecisionModal from "@/lib/forms/DecisionModal.jsx";
import { Field, FieldLabel, FieldContent } from "@/lib/components/ui/field.jsx";
import { NativeSelect, NativeSelectOption } from "@/lib/components/ui/native-select.jsx";
import { Switch } from "@/lib/components/ui/switch.jsx";

export default function ModalAttachAgreementModal({
  open = false,
  onOpenChange,
  testId = "modal-attach-agreement",
  templates = [],
  templateId = "",
  firstBookingOnly = true,
  holdUntilSigned = false,
  teenTemplateId = "",
  busy = false,
  submitError = null,
  title,
  subtitle,
  cancel,
  submit,
  onTemplateChange,
  onFirstBookingOnlyChange,
  onHoldUntilSignedChange,
  onTeenTemplateChange,
  onCancel,
  onConfirm,
}) {
  return (
    <DecisionModal
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      subtitle={subtitle}
      cancelLabel="Cancel"
      confirmLabel="Attach it"
      confirmDisabled={!templateId}
      busy={busy}
      error={submitError}
      onCancel={onCancel}
      onConfirm={onConfirm}
      testId={testId}
    >
      <Field orientation="horizontal" data-testid={`${testId}-template-field`}>
        <FieldLabel htmlFor={`${testId}-template`}>Which one</FieldLabel>
        <FieldContent>
          <NativeSelect
            id={`${testId}-template`}
            data-testid={`${testId}-template-select`}
            value={templateId}
            onChange={(e) => onTemplateChange?.(e.target.value)}
            disabled={busy}
          >
            <NativeSelectOption value="">Choose a template…</NativeSelectOption>
            {templates.map((t) => (
              <NativeSelectOption key={t.id} value={t.id}>
                {t.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </FieldContent>
      </Field>

      <div className="flex items-start gap-2.5 py-2" data-testid={`${testId}-first-booking-only`}>
        <span className="flex-1 flex flex-col gap-0.5 text-ui text-ink">
          Only for a first booking
          <span className="text-meta text-mute">Someone who has already signed it isn't asked again.</span>
        </span>
        <Switch
          checked={firstBookingOnly}
          disabled={busy}
          onCheckedChange={onFirstBookingOnlyChange}
          data-testid={`${testId}-first-booking-only-switch`}
        />
      </div>

      <div className="flex items-start gap-2.5 py-2" data-testid={`${testId}-hold-until-signed`}>
        <span className="flex-1 flex flex-col gap-0.5 text-ui text-ink">
          Hold the session until it's signed
          <span className="text-meta text-mute">
            It stays pending, and they're reminded once a day. Use this for consent, not for
            anything you'd be relaxed about.
          </span>
        </span>
        <Switch
          checked={holdUntilSigned}
          disabled={busy}
          onCheckedChange={onHoldUntilSignedChange}
          data-testid={`${testId}-hold-until-signed-switch`}
        />
      </div>

      <Field orientation="horizontal" data-testid={`${testId}-teen-field`}>
        <FieldLabel htmlFor={`${testId}-teen`}>If they're under 18</FieldLabel>
        <FieldContent>
          <NativeSelect
            id={`${testId}-teen`}
            data-testid={`${testId}-teen-select`}
            value={teenTemplateId}
            onChange={(e) => onTeenTemplateChange?.(e.target.value)}
            disabled={busy}
          >
            <NativeSelectOption value="">Send the same agreement</NativeSelectOption>
            {templates.map((t) => (
              <NativeSelectOption key={t.id} value={t.id}>
                Send {t.name} instead, to them and a parent
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </FieldContent>
      </Field>

      <div className="bg-primary-wash border border-primary-edge rounded-sm px-4 py-3.5 text-sm text-ink" data-testid={`${testId}-what-they-get`}>
        <b className="font-semibold">What they get.</b> An email with a link. No account needed to read or sign it. You both get a PDF the moment it's done.
      </div>
    </DecisionModal>
  );
}
