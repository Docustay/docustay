// ═══════════════════════════════════════════════════════════════════════════════════════════════
// R4.018.M1 — NetworkListScreenNetworkAddSheet — the "Add a practice" sheet
// Ported from webui/src/lib/screens/network/NetworkListScreen.svelte:350-418 (the SideSheet element
// and everything inside it). Built on SideSheet (kit2 archetype).
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import SideSheet from "@/lib/forms/SideSheet.jsx";
import { Field, FieldLabel, FieldContent } from "@/lib/components/ui/field.jsx";
import { Input } from "@/lib/components/ui/input.jsx";
import Combobox from "@/lib/components/kit/Combobox.jsx";
import { Switch } from "@/lib/components/ui/switch.jsx";
import DisabledWithReason from "@/lib/forms/DisabledWithReason.jsx";
import { Button } from "@/lib/components/ui/button.jsx";

export default function NetworkListScreenNetworkAddSheet({
  open = false,
  onOpenChange = null,
  data = null,
  name = "",
  whatTheyDo = "",
  email = "",
  contactId = "",
  contactCreateName = "",
  contactCreateBusy = false,
  busy = false,
  error = null,
  peopleOptions = [],
  closeSheet = null,
  createContactInline = null,
  submitSheet = null,
  onNameChange = null,
  onWhatTheyDoChange = null,
  onEmailChange = null,
  onContactIdChange = null,
  onContactCreateNameChange = null,
}) {
  return open ? (
    <SideSheet
      title="Add a practice"
      onCancel={closeSheet}
      onSave={submitSheet}
      busy={busy}
      dirty={!!(name.trim() || whatTheyDo.trim() || email.trim())}
      error={error}
      saveLabel="Save"
      testId="network-add-sheet"
    >
      <div className="flex flex-col gap-5 px-0">
        <Field orientation="horizontal">
          <FieldLabel htmlFor="network-add-name">Name</FieldLabel>
          <FieldContent>
            <Input
              id="network-add-name"
              value={name}
              onChange={(e) => onNameChange?.(e.target.value)}
              data-testid="network-add-name"
              required
              maxLength="200"
              autoComplete="off"
            />
          </FieldContent>
        </Field>

        <Field orientation="horizontal">
          <FieldLabel htmlFor="network-add-what">What they do</FieldLabel>
          <FieldContent>
            <Input
              id="network-add-what"
              value={whatTheyDo}
              onChange={(e) => onWhatTheyDoChange?.(e.target.value)}
              data-testid="network-add-what"
              maxLength="60"
              autoComplete="off"
            />
          </FieldContent>
        </Field>

        <Field orientation="horizontal">
          <FieldLabel htmlFor="network-add-email">Email</FieldLabel>
          <FieldContent>
            <Input
              id="network-add-email"
              type="email"
              value={email}
              onChange={(e) => onEmailChange?.(e.target.value)}
              data-testid="network-add-email"
              autoComplete="off"
            />
          </FieldContent>
        </Field>

        <Field orientation="horizontal">
          <FieldLabel htmlFor="network-add-contact">Contact</FieldLabel>
          <FieldContent>
            <Combobox
              id="network-add-contact"
              testId="network-add-contact"
              options={peopleOptions}
              value={contactId}
              onValueChange={onContactIdChange}
              placeholder="Search people"
              emptyText="No people yet."
            />
            <div className="mt-2 flex gap-2">
              <Input
                placeholder="Or add a new person"
                value={contactCreateName}
                onChange={(e) => onContactCreateNameChange?.(e.target.value)}
                data-testid="network-add-contact-create-name"
                autoComplete="off"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                data-testid="network-add-contact-create"
                disabled={contactCreateBusy || !contactCreateName.trim()}
                onClick={createContactInline}
              >
                Add
              </Button>
            </div>
          </FieldContent>
        </Field>

        <Field orientation="horizontal">
          <FieldLabel htmlFor="network-add-both-ways">Referring both ways?</FieldLabel>
          <FieldContent>
            <DisabledWithReason
              disabled={true}
              reason="Worked out from what you send and receive."
              testId="network-add-both-ways"
            >
              {({ disabled, describedBy }) => (
                <Switch
                  id="network-add-both-ways"
                  checked={false}
                  disabled={disabled}
                  aria-describedby={describedBy}
                  data-testid="network-add-both-ways-switch"
                />
              )}
            </DisabledWithReason>
          </FieldContent>
        </Field>
      </div>
    </SideSheet>
  ) : null;
}
