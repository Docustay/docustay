import { useEffect } from "react";
import SideSheet from "./SideSheet.jsx";
import DisabledWithReason from "./DisabledWithReason.jsx";
import { FieldDescription } from "@/lib/components/ui/field.jsx";
import { Input } from "@/lib/components/ui/input.jsx";
import { NativeSelect } from "@/lib/components/ui/native-select.jsx";
import { Button } from "@/lib/components/ui/button.jsx";
import Combobox from "@/lib/components/kit/Combobox.jsx";
import { Skeleton } from "@/lib/components/ui/skeleton.jsx";
import DatePicker from "@/lib/components/kit/DatePicker.jsx";
import SheetRow, { SheetSection } from "@/lib/components/kit/SheetRow.jsx";
import ProgramPicker from "@/lib/programs/ProgramPicker.jsx";
import { term } from "@/lib/terminology/terms.js";
import NewAccountSheet from "../screens/accounts/NewAccountSheet.jsx";

export default function PersonFormPersonSheet({
  open = true, onOpenChange = null, person = null, onDone = null, onCancel = null, editing = false,
  displayName = "", email = "", mobilePhone = "", dateOfBirth = "",
  busy = false, error = null, firstField = null, referredById = "", whoPaysGroupId = "",
  payerGroups = [], groupsLoading = false, showNewAccountSheet = false, sendTemplateId = "",
  contractTemplates = [], templatesLoading = false, howHeardValue = "", networkParties = [],
  onNewAccountDone = null, onNewAccountCancel = null, peopleOptions = [], howHeardIsParty = false,
  referredByFilled = false, REFERRER_REASON = "", showDuplicateWarning = false,
  possibleDuplicate = null, proceedWithCreate = false, dobRequired = false, dobHelper = "",
  submit = null, onDuplicateProceed = null, onDisplayNameChange = null, onEmailChange = null, onMobilePhoneChange = null,
  onDateOfBirthChange = null, onReferredByIdChange = null, onWhoPaysGroupIdChange = null,
  onSendTemplateIdChange = null, onHowHeardValueChange = null,
  // ★ the maintainer, 29 Sep 2026 — CREATE-ONLY: Adult/Adolescent + Lead + link-children/parent.
  role = "adult_client", onRoleChange = null, isLead = false, onIsLeadChange = null,
  childUserIds = [], onChildUserIdsChange = null, parentUserId = "", onParentUserIdChange = null,
  adolescentOptions = [], adultOptions = [],
  sendPortalInvite = false, onSendPortalInviteChange = null,
  programIds = [], onProgramIdsChange = null,
}) {
  // Focus the first field on open
  useEffect(() => {
    if (open) {
      const firstInput = document.querySelector("[data-testid='person-name']");
      if (firstInput) {
        setTimeout(() => firstInput.focus(), 0);
      }
    }
  }, [open]);

  if (!open) return null;

  // Custom footer for CREATE mode with DisabledWithReason wrapper
  const createFooter = () => (
    <footer className="sticky bottom-0 flex shrink-0 justify-end gap-2.5 border-t border-line bg-surface px-5.5 py-4">
      <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
        Cancel
      </Button>
      <DisabledWithReason disabled={createInvalid} reason={createInvalidReason} testId="person-save">
        {({ disabled }) => (
          <Button
            type="submit"
            disabled={disabled || busy}
            data-testid="person-save-btn"
          >
            {busy ? "Saving…" : "Add them"}
          </Button>
        )}
      </DisabledWithReason>
    </footer>
  );

  // Validation for create mode (computed here for footer use). ★ the maintainer, 29 Sep 2026 — an adolescent
  //   needs a parent linked before Save enables; this must mirror PersonForm.jsx's own
  //   `createInvalid` exactly, or the button shows enabled while `submit()` still (correctly)
  //   refuses to fire — the "control that fails for the viewer looking at it" defect class.
  const needsParent = role === "adolescent_client" && !parentUserId;
  const createInvalid = !displayName.trim() || !email.trim() || (dobRequired && !dateOfBirth) || needsParent;
  const createInvalidReason =
    !displayName.trim()
      ? "Add a name first."
      : !email.trim()
        ? "Add an email first."
        : dobRequired && !dateOfBirth
          ? "Add a date of birth first."
          : needsParent
            ? "Link a parent first."
            : "";

  return (
    <SideSheet
      title={editing ? "Edit person" : "New client"}
      subtitle={null}
      onCancel={onCancel}
      onSave={submit}
      busy={busy}
      saveLabel={editing ? "Save changes" : "Add them"}
      error={error}
      footer={!editing ? createFooter() : undefined}
      testId="person-sheet"
    >
        {editing ? (
          // EDIT PATH: unchanged Name/Email/Role, PLUS the new Referred by picker.
          <SheetSection title="Details">
            <SheetRow label="Name" htmlFor="person-name" required>
              <Input
                id="person-name"
                value={displayName}
                onChange={(e) => onDisplayNameChange?.(e.target.value)}
                placeholder="First and last"
                required
                maxLength="200"
                autoComplete="off"
                data-testid="person-name"
              />
            </SheetRow>

            <SheetRow label="Email" htmlFor="person-email" required>
              <Input
                id="person-email"
                type="email"
                value={email}
                onChange={(e) => onEmailChange?.(e.target.value)}
                maxLength="320"
                autoComplete="off"
                data-testid="person-email"
              />
            </SheetRow>

            <SheetRow label="Role">
              <p data-testid="person-role-static">{person?.role}</p>
              <FieldDescription>A person's role is set when they are created and is not changed here.</FieldDescription>
            </SheetRow>

            <SheetRow label="Referred by" htmlFor="person-referred-by" optional>
              <Combobox
                id="person-referred-by"
                testId="person-referred-by"
                options={peopleOptions}
                value={referredById}
                onValueChange={onReferredByIdChange}
                placeholder="Search people"
                emptyText="No people yet."
              />
              <FieldDescription>Someone here who sent them your way.</FieldDescription>
            </SheetRow>

            <SheetRow label="Programs" optional>
              <ProgramPicker label={null} value={programIds} onChange={onProgramIdsChange} disabled={busy} testId="person-programs" />
            </SheetRow>
          </SheetSection>
        ) : (
          // CREATE PATH: PersonSheet.frame.html, ported field for field.
          <>
            <SheetSection title="Who they are">
              <SheetRow label="Kind" required>
                <div className="flex gap-4" data-testid="person-role-group">
                  <label className="flex items-center gap-1.5 text-ui text-ink">
                    <input
                      type="radio"
                      name="person-role"
                      value="adult_client"
                      checked={role === "adult_client"}
                      onChange={() => onRoleChange?.("adult_client")}
                      data-testid="person-role-adult"
                    />
                    {term("userType.adult")}
                  </label>
                  <label className="flex items-center gap-1.5 text-ui text-ink">
                    <input
                      type="radio"
                      name="person-role"
                      value="adolescent_client"
                      checked={role === "adolescent_client"}
                      onChange={() => onRoleChange?.("adolescent_client")}
                      data-testid="person-role-adolescent"
                    />
                    {term("userType.adolescent")}
                  </label>
                </div>
                <FieldDescription>{term("userType.adult")} or {term("userType.adolescent").toLowerCase()} — this cannot change later.</FieldDescription>
              </SheetRow>

              <SheetRow label={term("userType.lead")}>
                <label className="flex items-center gap-1.5 text-ui text-ink">
                  <input
                    type="checkbox"
                    checked={isLead}
                    onChange={(e) => onIsLeadChange?.(e.target.checked)}
                    data-testid="person-is-lead"
                  />
                  This is a lead, not a client yet
                </label>
                <FieldDescription>Leads become clients automatically once they book.</FieldDescription>
              </SheetRow>

              <SheetRow label="Name" htmlFor="person-name" required>
                <Input
                  id="person-name"
                  value={displayName}
                  onChange={(e) => onDisplayNameChange?.(e.target.value)}
                  placeholder="First and last"
                  required
                  maxLength="200"
                  autoComplete="off"
                  data-testid="person-name"
                />
              </SheetRow>

              <SheetRow label="Email" htmlFor="person-email" required>
                <Input
                  id="person-email"
                  type="email"
                  value={email}
                  onChange={(e) => onEmailChange?.(e.target.value)}
                  placeholder="So they can be sent things"
                  maxLength="320"
                  autoComplete="off"
                  data-testid="person-email"
                />
              </SheetRow>

              <SheetRow label="Phone" htmlFor="person-mobile" optional>
                <Input
                  id="person-mobile"
                  type="tel"
                  value={mobilePhone}
                  onChange={(e) => onMobilePhoneChange?.(e.target.value)}
                  placeholder="(831)"
                  autoComplete="off"
                  data-testid="person-mobile"
                />
              </SheetRow>

              <SheetRow label="Date of birth" htmlFor="person-dob" required={dobRequired} optional={!dobRequired}>
                <DatePicker
                  id="person-dob"
                  testId="person-dob"
                  value={dateOfBirth}
                  onValueChange={onDateOfBirthChange}
                />
                <FieldDescription data-testid="person-dob-hint">{dobHelper}</FieldDescription>
              </SheetRow>

              <SheetRow label="Programs" optional>
                <ProgramPicker label={null} value={programIds} onChange={onProgramIdsChange} disabled={busy} testId="person-programs" />
              </SheetRow>
            </SheetSection>

            {role === "adult_client" && adolescentOptions.length > 0 && (
              <SheetSection title="Family">
                <SheetRow label="Children" optional>
                  <div className="flex flex-col gap-1.5" data-testid="person-children-group">
                    {adolescentOptions.map((c) => (
                      <label key={c.id} className="flex items-center gap-1.5 text-ui text-ink">
                        <input
                          type="checkbox"
                          checked={childUserIds.includes(c.id)}
                          onChange={(e) =>
                            onChildUserIdsChange?.(
                              e.target.checked
                                ? [...childUserIds, c.id]
                                : childUserIds.filter((id) => id !== c.id)
                            )
                          }
                          data-testid={`person-child-${c.id}`}
                        />
                        {c.name}
                      </label>
                    ))}
                  </div>
                  <FieldDescription>Linking a child here gives this person the Parent tag.</FieldDescription>
                </SheetRow>
              </SheetSection>
            )}

            {role === "adolescent_client" && (
              <SheetSection title="Family">
                <SheetRow label={term("userType.parent")} htmlFor="person-parent" required>
                  <Combobox
                    id="person-parent"
                    testId="person-parent"
                    options={adultOptions}
                    value={parentUserId}
                    onValueChange={onParentUserIdChange}
                    placeholder="Search adults"
                    emptyText="No adults yet — add the parent first."
                  />
                  <FieldDescription>Under-18s need a parent linked before they can be booked.</FieldDescription>
                </SheetRow>
              </SheetSection>
            )}

            <SheetSection title="Money">
              <SheetRow label="Who pays" htmlFor="person-who-pays" required>
                {groupsLoading ? (
                  <Skeleton className="h-10 w-full rounded-lg" data-testid="person-who-pays-loading" />
                ) : (
                  <NativeSelect
                    id="person-who-pays"
                    value={whoPaysGroupId}
                    onChange={(e) => onWhoPaysGroupIdChange?.(e.target.value)}
                    data-testid="person-who-pays"
                  >
                    <option value="">They do</option>
                    {payerGroups.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                    <option value="__new__">New family account…</option>
                  </NativeSelect>
                )}
                <FieldDescription>A parent, an employer or a family account can pay instead.</FieldDescription>
              </SheetRow>
            </SheetSection>

            <SheetSection title="Getting started">
              {/* ★ the maintainer, 29 Sep 2026 — "A 'Send portal invite' tick box on the create form." Teen
                  copy names the parent, since that is who actually receives it. */}
              <SheetRow label="Portal access">
                <label className="flex items-center gap-1.5 text-ui text-ink">
                  <input
                    type="checkbox"
                    checked={sendPortalInvite}
                    onChange={(e) => onSendPortalInviteChange?.(e.target.checked)}
                    data-testid="person-send-portal-invite"
                  />
                  Send a portal invite
                </label>
                <FieldDescription>
                  {role === "adolescent_client"
                    ? "Goes to the parent you linked above, not to them directly."
                    : "A one-use link to set a password and sign in. Goes out the moment you save."}
                </FieldDescription>
              </SheetRow>

              <SheetRow label="Send them" htmlFor="person-send-them" optional>
                {templatesLoading ? (
                  <Skeleton className="h-10 w-full rounded-lg" data-testid="person-send-them-loading" />
                ) : (
                  <NativeSelect
                    id="person-send-them"
                    value={sendTemplateId}
                    onChange={(e) => onSendTemplateIdChange?.(e.target.value)}
                    data-testid="person-send-them"
                  >
                    <option value="">Nothing yet</option>
                    {contractTemplates.map((tpl) => (
                      <option key={tpl.id} value={tpl.id}>
                        {tpl.name}
                      </option>
                    ))}
                  </NativeSelect>
                )}
                <FieldDescription>Goes out the moment you save.</FieldDescription>
              </SheetRow>

              <SheetRow label="How they heard about you" htmlFor="person-how-heard" optional>
                <DisabledWithReason
                  disabled={referredByFilled}
                  reason={REFERRER_REASON}
                  testId="person-how-heard-disabled"
                >
                  {({ disabled, describedBy }) => (
                    <NativeSelect
                      id="person-how-heard"
                      value={howHeardValue}
                      onChange={(e) => onHowHeardValueChange?.(e.target.value)}
                      disabled={disabled}
                      aria-describedby={disabled ? describedBy : undefined}
                      data-testid="person-how-heard"
                    >
                      <option value="">Not set</option>
                      {networkParties.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                      <option value="word_of_mouth">Word of mouth</option>
                      <option value="found_online">Found you online</option>
                    </NativeSelect>
                  )}
                </DisabledWithReason>
                <FieldDescription>Not required, but it's the only way to know what's working.</FieldDescription>
              </SheetRow>

              <SheetRow label="Referred by" htmlFor="person-referred-by" optional>
                <DisabledWithReason
                  disabled={howHeardIsParty}
                  reason={REFERRER_REASON}
                  testId="person-referred-by-disabled"
                >
                  {({ disabled, describedBy }) => (
                    <Combobox
                      id="person-referred-by"
                      testId="person-referred-by"
                      options={peopleOptions}
                      value={referredById}
                      onValueChange={onReferredByIdChange}
                      placeholder="Search people"
                      emptyText="No people yet."
                      disabled={disabled}
                    />
                  )}
                </DisabledWithReason>
                <FieldDescription>Someone here who sent them your way.</FieldDescription>
              </SheetRow>
            </SheetSection>

            {showDuplicateWarning && possibleDuplicate && (
              <div
                className="mx-5.5 mb-4 flex flex-wrap items-center gap-1.5 rounded-sm bg-bad-subtle px-3 py-2.5 text-meta text-bad"
                data-testid="person-duplicate-notice"
                role="alert"
              >
                <span>Someone with this email exists —</span>
                <button
                  type="button"
                  className="border-0 bg-none p-0 text-primary underline cursor-pointer text-meta"
                  data-testid="person-duplicate-open"
                  onClick={() => onDone?.(possibleDuplicate.id)}
                >
                  Open {possibleDuplicate.display_name}
                </button>
                <span>·</span>
                <button
                  type="button"
                  className="border-0 bg-none p-0 text-primary underline cursor-pointer text-meta"
                  data-testid="person-duplicate-proceed"
                  onClick={() => onDuplicateProceed?.()}
                >
                  add anyway
                </button>
              </div>
            )}

            {showNewAccountSheet && (
              <NewAccountSheet presetKind="family" onDone={onNewAccountDone} onCancel={onNewAccountCancel} />
            )}
          </>
        )}
      </SideSheet>
  );
}
