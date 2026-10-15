import { useState } from "react";
import SideSheet from "@/lib/forms/SideSheet.jsx";
import { Button } from "@/lib/components/ui/button.jsx";
import { Input } from "@/lib/components/ui/input.jsx";
import { Field, FieldLabel, FieldContent } from "@/lib/components/ui/field.jsx";
import { NativeSelect, NativeSelectOption } from "@/lib/components/ui/native-select.jsx";
import ProgramGate from "@/lib/components/ProgramGate.jsx";

export default function WaitlistScreenWaitlistAddSheet({
  open,
  onOpenChange,
  PREFERENCES,
  PREFERENCE_LABEL,
  error,
  services,
  hosts,
  addBusy,
  addError,
  addMode,
  addQuery,
  addResults,
  addSelectedPerson,
  addName,
  addEmail,
  addPhone,
  addServiceId,
  addHostId,
  addPreference,
  addNote,
  closeAdd,
  onAddQueryInput,
  pickPerson,
  submitAdd,
  setAddMode,
  setAddName,
  setAddEmail,
  setAddPhone,
  setAddServiceId,
  setAddHostId,
  setAddPreference,
  setAddNote,
}) {
  // ★ the maintainer, 29 Sep 2026 (life coaching brief) — asks Life/Recovery before the service list, same
  //   pattern as AddLineRow/CouponEditor. Local state: this sheet remounts each time it opens
  //   (WaitlistScreen.jsx renders it only `{addOpen && <...>}`).
  const [serviceGroup, setServiceGroup] = useState(null); // {id, name} | null

  return (
    <SideSheet
      title="Add someone"
      onCancel={closeAdd}
      onSave={submitAdd}
      busy={addBusy}
      error={addError}
      testId="waitlist-add-sheet"
    >
      <Field orientation="horizontal" data-testid="waitlist-add-row-mode">
        <FieldLabel>Who</FieldLabel>
        <FieldContent>
          <div style={{ display: "flex", gap: "8px" }}>
            <Button
              type="button"
              size="sm"
              variant={addMode === "existing" ? "default" : "outline"}
              data-testid="waitlist-add-mode-existing"
              onClick={() => setAddMode("existing")}
            >
              Existing person
            </Button>
            <Button
              type="button"
              size="sm"
              variant={addMode === "new" ? "default" : "outline"}
              data-testid="waitlist-add-mode-new"
              onClick={() => setAddMode("new")}
            >
              New person
            </Button>
          </div>
        </FieldContent>
      </Field>

      {addMode === "existing" ? (
        <Field orientation="horizontal" data-testid="waitlist-add-row-search">
          <FieldLabel htmlFor="waitlist-add-search">Search</FieldLabel>
          <FieldContent>
            <Input
              id="waitlist-add-search"
              data-testid="waitlist-add-search"
              value={addQuery}
              onChange={(e) => onAddQueryInput(e.target.value)}
              placeholder="Name or email"
            />
            {addResults.length > 0 && (
              <div data-testid="waitlist-add-search-results" style={{ marginTop: "8px" }}>
                {addResults.map((hit) => (
                  <button
                    key={hit.id}
                    type="button"
                    data-testid={`waitlist-add-search-hit-${hit.id}`}
                    onClick={() => pickPerson(hit)}
                    style={{
                      display: "block",
                      width: "100%",
                      padding: "8px",
                      marginBottom: "4px",
                      border: "1px solid var(--line)",
                      borderRadius: "6px",
                      background: "var(--paper)",
                      textAlign: "left",
                      cursor: "pointer",
                    }}
                  >
                    {hit.label} <span style={{ color: "var(--ink-muted)", fontSize: "12px" }}>{hit.detail}</span>
                  </button>
                ))}
              </div>
            )}
            {addSelectedPerson && (
              <p data-testid="waitlist-add-selected" style={{ margin: "8px 0 0 0", fontSize: "14px" }}>
                Selected: {addSelectedPerson.label} ({addSelectedPerson.detail})
              </p>
            )}
          </FieldContent>
        </Field>
      ) : (
        <>
          <Field orientation="horizontal" data-testid="waitlist-add-row-name">
            <FieldLabel htmlFor="waitlist-add-name">Name</FieldLabel>
            <FieldContent>
              <Input
                id="waitlist-add-name"
                data-testid="waitlist-add-name"
                value={addName}
                onChange={(e) => setAddName(e.target.value)}
                required
              />
            </FieldContent>
          </Field>
          <Field orientation="horizontal" data-testid="waitlist-add-row-email">
            <FieldLabel htmlFor="waitlist-add-email">Email</FieldLabel>
            <FieldContent>
              <Input
                id="waitlist-add-email"
                type="email"
                data-testid="waitlist-add-email"
                value={addEmail}
                onChange={(e) => setAddEmail(e.target.value)}
                required
              />
            </FieldContent>
          </Field>
          <Field orientation="horizontal" data-testid="waitlist-add-row-phone">
            <FieldLabel htmlFor="waitlist-add-phone">Phone</FieldLabel>
            <FieldContent>
              <Input
                id="waitlist-add-phone"
                type="tel"
                data-testid="waitlist-add-phone"
                value={addPhone}
                onChange={(e) => setAddPhone(e.target.value)}
                required
              />
            </FieldContent>
          </Field>
        </>
      )}

      <Field orientation="horizontal" data-testid="waitlist-add-row-service">
        <FieldLabel htmlFor="waitlist-add-service">Service</FieldLabel>
        <FieldContent>
          {services.length === 0 ? (
            <p style={{ fontSize: "14px", color: "var(--ink-muted)", margin: 0 }}>
              No services yet — add one under Items and services first.
            </p>
          ) : !serviceGroup ? (
            <ProgramGate onChoose={setServiceGroup} testId="waitlist-add-service-group-gate" />
          ) : (
            <>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs text-mute" data-testid="waitlist-add-service-group-label">
                  {serviceGroup.name}
                </span>
                <button
                  type="button"
                  className="text-xs text-brand underline"
                  onClick={() => { setServiceGroup(null); setAddServiceId(""); }}
                  data-testid="waitlist-add-service-group-change"
                >
                  Change
                </button>
              </div>
              <NativeSelect
                id="waitlist-add-service"
                data-testid="waitlist-add-service"
                value={addServiceId}
                onChange={(e) => setAddServiceId(e.target.value)}
                required
              >
                <NativeSelectOption value="">Select a service</NativeSelectOption>
                {services
                  .filter((s) => (s.program_id ?? null) === serviceGroup.id)
                  .map((s) => (
                    <NativeSelectOption key={s.id} value={s.id}>
                      {s.name}
                    </NativeSelectOption>
                  ))}
              </NativeSelect>
            </>
          )}
        </FieldContent>
      </Field>

      {hosts.length > 0 && (
        <Field orientation="horizontal" data-testid="waitlist-add-row-host">
          <FieldLabel htmlFor="waitlist-add-host">
            Host <span style={{ color: "var(--ink-muted)" }}>optional</span>
          </FieldLabel>
          <FieldContent>
            <NativeSelect
              id="waitlist-add-host"
              data-testid="waitlist-add-host"
              value={addHostId}
              onChange={(e) => setAddHostId(e.target.value)}
            >
              <NativeSelectOption value="">Not decided yet</NativeSelectOption>
              {hosts.map((h) => (
                <NativeSelectOption key={h.id} value={h.id}>
                  {h.displayName}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </FieldContent>
        </Field>
      )}

      <Field orientation="horizontal" data-testid="waitlist-add-row-preference">
        <FieldLabel>When suits them</FieldLabel>
        <FieldContent>
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            {PREFERENCES.map((p) => (
              <Button
                key={p}
                type="button"
                size="sm"
                variant={addPreference === p ? "default" : "outline"}
                data-testid={`waitlist-add-preference-${p}`}
                onClick={() => setAddPreference(p)}
              >
                {PREFERENCE_LABEL[p]}
              </Button>
            ))}
          </div>
        </FieldContent>
      </Field>

      <Field orientation="horizontal" data-testid="waitlist-add-row-note">
        <FieldLabel htmlFor="waitlist-add-note">
          Note <span style={{ color: "var(--ink-muted)" }}>optional</span>
        </FieldLabel>
        <FieldContent>
          <Input
            id="waitlist-add-note"
            data-testid="waitlist-add-note"
            value={addNote}
            onChange={(e) => setAddNote(e.target.value)}
            maxLength={200}
          />
        </FieldContent>
      </Field>
    </SideSheet>
  );
}
