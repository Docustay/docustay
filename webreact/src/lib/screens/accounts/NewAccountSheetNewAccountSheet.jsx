// ═══════════════════════════════════════════════════════════════════════════════════════════════
// R4.017.M1 — NewAccountSheetNewAccountSheet: the sheet component, extracted from lines 161-257.
// Built on SideSheet with label-left/field-right rows.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import SideSheet from "@/lib/forms/SideSheet.jsx";
import { Field, FieldLabel, FieldContent, FieldDescription } from "@/lib/components/ui/field.jsx";
import { Input } from "@/lib/components/ui/input.jsx";
import { NativeSelect } from "@/lib/components/ui/native-select.jsx";
import Combobox from "@/lib/components/kit/Combobox.jsx";
import { Textarea } from "@/lib/components/ui/textarea.jsx";
import { Button } from "@/lib/components/ui/button.jsx";

export default function NewAccountSheetNewAccountSheet({
  KIND_OPTIONS,
  KIND_HINT,
  onCancel,
  kind,
  setKind,
  name,
  setName,
  billingNote,
  setBillingNote,
  busy,
  error,
  contactId,
  setContactId,
  contactCreateName,
  setContactCreateName,
  contactCreateBusy,
  memberPick,
  setMemberPick,
  members,
  memberCreateName,
  setMemberCreateName,
  memberCreateBusy,
  peopleOptions,
  memberOptions,
  createContactInline,
  addMember,
  removeMember,
  createMemberInline,
  submit,
}) {
  return (
    <SideSheet
      title="New account"
      onCancel={onCancel}
      onSave={submit}
      busy={busy}
      error={error}
      saveLabel="Save"
      testId="new-account-sheet"
    >
      <div className="flex flex-col gap-[var(--stack)]">
        <Field orientation="horizontal" className="border-b border-hair pb-1.5 pt-1.5 last:border-b-0">
          <FieldLabel htmlFor="new-account-kind">Kind</FieldLabel>
          <FieldContent>
            <NativeSelect
              id="new-account-kind"
              value={kind}
              onChange={(e) => setKind(e.target.value)}
              data-testid="new-account-kind"
            >
              {KIND_OPTIONS.map((k) => (
                <option key={k.value} value={k.value}>{k.label}</option>
              ))}
            </NativeSelect>
            {KIND_HINT[kind] && (
              <FieldDescription className="mt-1.5" data-testid="new-account-kind-hint">
                {KIND_HINT[kind]}
              </FieldDescription>
            )}
          </FieldContent>
        </Field>

        <Field orientation="horizontal" className="border-b border-hair pb-1.5 pt-1.5 last:border-b-0">
          <FieldLabel htmlFor="new-account-name">Name</FieldLabel>
          <FieldContent>
            <Input
              id="new-account-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              data-testid="new-account-name"
              required
              maxLength="200"
              autoComplete="off"
            />
          </FieldContent>
        </Field>

        <Field orientation="horizontal" className="border-b border-hair pb-1.5 pt-1.5 last:border-b-0">
          <FieldLabel htmlFor="new-account-contact">Who we talk to</FieldLabel>
          <FieldContent>
            <Combobox
              id="new-account-contact"
              testId="new-account-contact"
              options={peopleOptions}
              value={contactId}
              onValueChange={setContactId}
              placeholder="Search people"
              emptyText="No people yet."
            />
            <div className="flex gap-[var(--gap)] mt-2">
              <Input
                placeholder="Or add a new person"
                value={contactCreateName}
                onChange={(e) => setContactCreateName(e.target.value)}
                data-testid="new-account-contact-create-name"
                autoComplete="off"
                className="flex-1"
              />
              <Button
                type="button"
                variant="outline"
                data-testid="new-account-contact-create"
                disabled={contactCreateBusy || !contactCreateName.trim()}
                onClick={createContactInline}
              >
                Add
              </Button>
            </div>
          </FieldContent>
        </Field>

        {kind === "third_party" && (
          <Field orientation="horizontal" className="border-b border-hair pb-1.5 pt-1.5 last:border-b-0">
            <FieldLabel htmlFor="new-account-billing-note">Billing note</FieldLabel>
            <FieldContent>
              <Textarea
                id="new-account-billing-note"
                value={billingNote}
                onChange={(e) => setBillingNote(e.target.value)}
                maxLength="200"
                data-testid="new-account-billing-note"
                placeholder="Referrals · invoiced monthly"
              />
            </FieldContent>
          </Field>
        )}

        <Field orientation="horizontal" className="border-b border-hair pb-1.5 pt-1.5 last:border-b-0">
          <FieldLabel htmlFor="new-account-members">Add people now</FieldLabel>
          <FieldContent>
            <Combobox
              id="new-account-members"
              testId="new-account-members"
              options={memberOptions}
              value={memberPick}
              onValueChange={addMember}
              placeholder="Search people"
              emptyText="No people yet."
            />
            <div className="flex gap-[var(--gap)] mt-2">
              <Input
                placeholder="Or add a new person"
                value={memberCreateName}
                onChange={(e) => setMemberCreateName(e.target.value)}
                data-testid="new-account-members-create-name"
                autoComplete="off"
                className="flex-1"
              />
              <Button
                type="button"
                variant="outline"
                data-testid="new-account-members-create"
                disabled={memberCreateBusy || !memberCreateName.trim()}
                onClick={createMemberInline}
              >
                Add
              </Button>
            </div>
            {members.length > 0 && (
              <ul className="flex flex-wrap gap-1.5 mt-2.5 p-0 list-none" data-testid="new-account-members-list">
                {members.map((m) => (
                  <li key={m.id} className="inline-flex items-center gap-1.5 px-2 py-1 rounded-sm bg-surface-sunken text-sm text-ink" data-testid={`new-account-member-${m.id}`}>
                    <span>{m.label}</span>
                    <button
                      type="button"
                      aria-label={`Remove ${m.label}`}
                      data-testid={`new-account-member-remove-${m.id}`}
                      onClick={() => removeMember(m.id)}
                      className="border-0 bg-none cursor-pointer text-mute text-base leading-none p-0 hover:text-ink"
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </FieldContent>
        </Field>
      </div>
    </SideSheet>
  );
}
