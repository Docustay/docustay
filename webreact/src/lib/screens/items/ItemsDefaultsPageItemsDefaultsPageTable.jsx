// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ItemsDefaultsPageItemsDefaultsPageTable — the table/form content rendered inside LedgerPage.
// Ported from webui/src/lib/screens/items/ItemsDefaultsPage.svelte:255-440.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import LedgerPage from "@/lib/lists/LedgerPage.jsx";
import ScreenState from "@/lib/empty/ScreenState.jsx";
import SettingsHubRow from "@/lib/shared/SettingsHubRow.jsx";
import LastChanged from "@/lib/shared/LastChanged.jsx";
import { Field, FieldLabel, FieldContent } from "@/lib/components/ui/field.jsx";
import { Input } from "@/lib/components/ui/input.jsx";
import { NativeSelect } from "@/lib/components/ui/native-select.jsx";
import { Switch } from "@/lib/components/ui/switch.jsx";

export default function ItemsDefaultsPageItemsDefaultsPageTable({
  onNavigate, go, phase, error, defaults, durationInput, priceInput, unitInput, deliveryInput,
  bookableOnline, taxCodeInput, agreementIdInput, unitUnset, taxCodeUnset, agreementUnset, load,
  DELIVERY_OPTIONS, unitSelectOptions, changes, saving, saveError, handleSave,
  setDurationInput, setPriceInput, setUnitInput, setDeliveryInput, setBookableOnline,
  setTaxCodeInput, setAgreementIdInput,
}) {
  return (
    <LedgerPage
      title="What a new service starts as"
      summary="Set these once and stop answering the same questions."
      primary={{
        label: saving ? "Saving…" : "Save",
        onClick: handleSave,
        disabled: changes.length === 0 || saving,
      }}
      testId="items-defaults-page"
    >
      <ScreenState
        phase={phase}
        error={phase === "error" ? error : null}
        reason={phase === "denied" ? (error?.message ?? null) : null}
        onNavigate={go}
        onRetry={load}
        testIds={{ error: "items-defaults-error", denied: "items-defaults-denied" }}
      >
        <div className="flex flex-col gap-6 w-full" data-testid="items-defaults-body">
          <p className="m-0 text-ui text-ink2 leading-relaxed max-w-[70ch]">
            Every new service starts with these. <b className="font-medium">Any service can still do its own thing</b>
            {" "}— changing it here only changes what the next one begins as, never what already exists.
          </p>

          {saveError && (
            <p role="alert" className="m-0 p-4 rounded-md bg-chip-bad-bg text-chip-bad-ink text-ui" data-testid="items-defaults-save-error">
              {saveError.message}
              {saveError.requestId && <span className="ml-1.5 text-ink-faint">(ref: {saveError.requestId})</span>}
            </p>
          )}

          <div className="flex gap-6">
            <div className="flex-1 flex flex-col gap-4">
              {/* The basics */}
              <div className="bg-surface border border-line rounded-lg">
                <div className="flex items-center gap-2.5 px-5 py-3.5 border-b border-line-soft">
                  <b className="font-medium text-sm">The basics</b>
                  <span className="flex-1"></span>
                  <LastChanged at={null} by={null} testId="items-defaults-last-changed-basics" />
                </div>
                <div className="flex flex-col px-5 py-3.5">
                  {/* How long */}
                  <Field orientation="horizontal" className="pb-2.5 border-b border-line-soft last:border-0 last:pb-0">
                    <FieldLabel htmlFor="items-defaults-duration">How long</FieldLabel>
                    <FieldContent>
                      <div className="flex items-center gap-1.5">
                        <Input
                          id="items-defaults-duration"
                          type="number"
                          min="5"
                          max="600"
                          value={durationInput}
                          onChange={(e) => setDurationInput(e.target.value)}
                          data-testid="items-defaults-duration"
                        />
                        <span className="text-xs text-ink-muted">minutes</span>
                      </div>
                    </FieldContent>
                  </Field>

                  {/* Price */}
                  <Field orientation="horizontal" className="py-2.5 border-b border-line-soft">
                    <FieldLabel htmlFor="items-defaults-price">Price</FieldLabel>
                    <FieldContent>
                      <div>
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs text-ink-muted">$</span>
                          <Input
                            id="items-defaults-price"
                            type="text"
                            inputMode="decimal"
                            value={priceInput}
                            onChange={(e) => setPriceInput(e.target.value)}
                            data-testid="items-defaults-price"
                          />
                        </div>
                        <p className="m-0 mt-1.5 text-xs text-ink-muted leading-normal">The most common price you charge. You will change it often.</p>
                      </div>
                    </FieldContent>
                  </Field>

                  {/* Sold by */}
                  <Field orientation="horizontal" className="py-2.5 border-b border-line-soft">
                    <FieldLabel htmlFor="items-defaults-unit">Sold by</FieldLabel>
                    <FieldContent>
                      <NativeSelect
                        id="items-defaults-unit"
                        value={unitInput}
                        onChange={(e) => setUnitInput(e.target.value)}
                        data-testid="items-defaults-unit"
                      >
                        {unitUnset && <option value="">Not set</option>}
                        {unitSelectOptions.map((o) => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </NativeSelect>
                      {unitUnset && <p className="m-0 mt-1 text-xs text-ink-faint italic" data-testid="items-defaults-unit-unset">Not set</p>}
                    </FieldContent>
                  </Field>

                  {/* Where it happens */}
                  <Field orientation="horizontal" className="py-2.5">
                    <FieldLabel htmlFor="items-defaults-delivery">Where it happens</FieldLabel>
                    <FieldContent>
                      <NativeSelect
                        id="items-defaults-delivery"
                        value={deliveryInput}
                        onChange={(e) => setDeliveryInput(e.target.value)}
                        data-testid="items-defaults-delivery"
                      >
                        {DELIVERY_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </NativeSelect>
                    </FieldContent>
                  </Field>
                </div>
              </div>

              {/* Booking */}
              <div className="bg-surface border border-line rounded-lg">
                <div className="flex items-center px-5 py-3.5 border-b border-line-soft">
                  <b className="font-medium text-sm">Booking</b>
                </div>
                <div className="flex flex-col px-5 py-3.5">
                  {/* Can be booked online */}
                  <Field orientation="horizontal" className="py-2.5 border-b border-line-soft">
                    <FieldLabel htmlFor="items-defaults-bookable">Can be booked online</FieldLabel>
                    <FieldContent>
                      <div className="flex items-center gap-2">
                        <Switch
                          id="items-defaults-bookable"
                          checked={bookableOnline}
                          onCheckedChange={setBookableOnline}
                          data-testid="items-defaults-bookable"
                        />
                        <span className="text-sm text-ink">{bookableOnline ? "Yes" : "No"}</span>
                      </div>
                      <p className="m-0 mt-1.5 text-xs text-ink-muted leading-normal">New services appear on your booking page straight away.</p>
                    </FieldContent>
                  </Field>

                  {/* Notice needed */}
                  <SettingsHubRow
                    label="Notice needed"
                    where="Set with your booking policy"
                    href="/engagements/booking"
                    onNavigate={go}
                    testId="items-defaults-notice"
                  />

                  {/* Cancellation window */}
                  <SettingsHubRow
                    label="Cancellation window"
                    where="Set with your booking policy"
                    href="/engagements/booking"
                    onNavigate={go}
                    testId="items-defaults-cancellation"
                  />

                  <p className="m-0 -mt-2 mb-2 pl-0 text-xs text-ink-muted leading-normal">Two of your services override this. That is fine and deliberate.</p>

                  {/* Gap after */}
                  <SettingsHubRow
                    label="Gap after"
                    where="Set with your booking policy"
                    href="/engagements/booking"
                    onNavigate={go}
                    testId="items-defaults-gap"
                  />
                </div>
              </div>

              {/* Money and paperwork */}
              <div className="bg-surface border border-line rounded-lg">
                <div className="flex items-center px-5 py-3.5 border-b border-line-soft">
                  <b className="font-medium text-sm">Money and paperwork</b>
                </div>
                <div className="flex flex-col px-5 py-3.5">
                  {/* Tax */}
                  <Field orientation="horizontal" className="py-2.5 border-b border-line-soft">
                    <FieldLabel htmlFor="items-defaults-tax">Tax</FieldLabel>
                    <FieldContent>
                      <div>
                        <Input
                          id="items-defaults-tax"
                          type="text"
                          maxLength="40"
                          value={taxCodeInput}
                          onChange={(e) => setTaxCodeInput(e.target.value)}
                          data-testid="items-defaults-tax"
                        />
                        <p className="m-0 mt-1.5 text-xs text-ink-muted leading-normal">From Stripe Tax. A physical item would need a different category.</p>
                        {taxCodeUnset && <p className="m-0 mt-1 text-xs text-ink-faint italic" data-testid="items-defaults-tax-unset">Not set</p>}
                      </div>
                    </FieldContent>
                  </Field>

                  {/* Agreement */}
                  <Field orientation="horizontal" className="py-2.5">
                    <FieldLabel htmlFor="items-defaults-agreement">Agreement</FieldLabel>
                    <FieldContent>
                      <div>
                        <Input
                          id="items-defaults-agreement"
                          type="text"
                          value={agreementIdInput}
                          onChange={(e) => setAgreementIdInput(e.target.value)}
                          data-testid="items-defaults-agreement"
                        />
                        <p className="m-0 mt-1.5 text-xs text-ink-muted leading-normal">Sent automatically when somebody books.</p>
                        {agreementUnset && <p className="m-0 mt-1 text-xs text-ink-faint italic" data-testid="items-defaults-agreement-unset">Not set</p>}
                      </div>
                    </FieldContent>
                  </Field>
                </div>
              </div>
            </div>

            {/* Right column */}
            <div className="w-80 flex-shrink-0 flex flex-col gap-4">
              {/* What this saves you */}
              <div className="bg-surface border border-line rounded-lg">
                <div className="flex items-center px-5 py-3.5 border-b border-line-soft">
                  <b className="font-medium text-sm">What this saves you</b>
                </div>
                <div className="flex flex-col px-5 py-3.5">
                  <div className="flex flex-col gap-0.5 py-3 border-b border-line-soft last:border-0">
                    <span className="text-sm text-ink">Eleven fields down to three</span>
                    <span className="text-xs text-ink-muted leading-normal">A new service needs a name, a price and a length. Everything else is already right.</span>
                  </div>
                  <div className="flex flex-col gap-0.5 py-3 border-b border-line-soft last:border-0">
                    <span className="text-sm text-ink">Your seven services use these</span>
                    <span className="text-xs text-ink-muted leading-normal">Two override the cancellation window. Nothing else differs.</span>
                  </div>
                </div>
              </div>

              {/* Changing these */}
              <div className="bg-surface border border-line rounded-lg">
                <div className="flex items-center px-5 py-3.5 border-b border-line-soft">
                  <b className="font-medium text-sm">Changing these</b>
                </div>
                <div className="flex flex-col px-5 py-3.5">
                  <div className="flex flex-col gap-0.5 py-3 border-b border-line-soft last:border-0">
                    <span className="text-sm text-ink">Nothing that exists changes</span>
                    <span className="text-xs text-ink-muted leading-normal">Not one booking, not one price, not one agreement</span>
                  </div>
                  <div className="flex flex-col gap-0.5 py-3 border-b border-line-soft last:border-0">
                    <span className="text-sm text-ink">Only the next one</span>
                    <span className="text-xs text-ink-muted leading-normal">And you can override it there too</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </ScreenState>
    </LedgerPage>
  );
}
