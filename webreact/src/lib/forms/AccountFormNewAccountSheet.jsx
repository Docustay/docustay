// AccountFormNewAccountSheet — the create account sheet (lines 158-380 from the Svelte source)
// Built on SideSheet with label-left/field-right rows organized in sections
import { useRef, useEffect } from "react";
import SideSheet from "./SideSheet.jsx";
import SheetRow, { SheetSection } from "@/lib/components/kit/SheetRow.jsx";
import { Input } from "@/lib/components/ui/input.jsx";
import { FieldDescription } from "@/lib/components/ui/field.jsx";

export default function AccountFormNewAccountSheet({
  open,
  onOpenChange,
  ACCOUNT_TYPES,
  STATUSES,
  onCancel,
  name,
  setName,
  accountType,
  setAccountType,
  industry,
  setIndustry,
  employeeCount,
  setEmployeeCount,
  website,
  setWebsite,
  description,
  setDescription,
  primaryContactQuery,
  setPrimaryContactQuery,
  primaryContactOptions,
  primaryContactId,
  setPrimaryContactId,
  phone,
  setPhone,
  email,
  setEmail,
  billingCountry,
  setBillingCountry,
  billingLine1,
  setBillingLine1,
  billingLine2,
  setBillingLine2,
  billingCity,
  setBillingCity,
  billingStateRegion,
  setBillingStateRegion,
  billingPostcode,
  setBillingPostcode,
  ownerUserId,
  setOwnerUserId,
  coachOptions,
  parentAccountQuery,
  setParentAccountQuery,
  parentAccountOptions,
  parentAccountId,
  setParentAccountId,
  source,
  setSource,
  tags,
  setTags,
  accountNumber,
  setAccountNumber,
  status,
  setStatus,
  busy,
  error,
  requiredFields,
  isRequired,
  submit,
}) {
  const nameInputRef = useRef(null);

  // Focus the first field on open
  useEffect(() => {
    if (open && nameInputRef.current) {
      nameInputRef.current.focus();
    }
  }, [open]);

  if (!open) return null;

  return (
    <SideSheet
      title="New account"
      onCancel={onCancel}
      onSave={submit}
      busy={busy}
      error={error}
    >
      {/* Show "* required" header if any fields are required */}
      {requiredFields.length > 0 && <p className="mb-2 text-meta text-mute">* required</p>}

      {/* 1. WHO THEY ARE (open) */}
      <SheetSection title="Who they are">
        <SheetRow label={`Name${isRequired("name") ? " *" : ""}`}>
          <Input
            ref={nameInputRef}
            data-testid="account-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={200}
            autoComplete="off"
          />
        </SheetRow>

        <SheetRow label="Account type">
          <select
            data-testid="account-type"
            value={accountType}
            onChange={(e) => setAccountType(e.target.value)}
            className="h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20"
          >
            <option value="">—</option>
            {ACCOUNT_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </SheetRow>

        <SheetRow label="Industry">
          <Input
            data-testid="account-industry"
            type="text"
            value={industry}
            onChange={(e) => setIndustry(e.target.value)}
            maxLength={200}
            autoComplete="off"
          />
        </SheetRow>

        <SheetRow label="Employee count">
          <Input
            data-testid="account-employee-count"
            type="number"
            value={employeeCount}
            onChange={(e) => setEmployeeCount(e.target.value)}
            min={0}
            autoComplete="off"
          />
        </SheetRow>

        <SheetRow label="Website">
          <Input
            data-testid="account-website"
            type="url"
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
            autoComplete="off"
          />
        </SheetRow>

        <SheetRow label="Description">
          <textarea
            data-testid="account-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            autoComplete="off"
            className="h-auto w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20"
          />
        </SheetRow>
      </SheetSection>

      {/* 2. REACH THEM (open) */}
      <SheetSection title="Reach them">
        <SheetRow label="Primary contact">
          <div className="flex flex-col gap-2">
            <Input
              data-testid="account-primary-contact-search"
              type="text"
              placeholder="Search people by name"
              value={primaryContactQuery}
              onChange={(e) => setPrimaryContactQuery(e.target.value)}
              autoComplete="off"
            />
            {primaryContactOptions.length > 0 && (
              <select
                data-testid="account-primary-contact"
                value={primaryContactId}
                onChange={(e) => setPrimaryContactId(e.target.value)}
                className="h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20"
              >
                <option value="">Not linked</option>
                {primaryContactOptions.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            )}
            {primaryContactQuery.trim().length >= 2 && primaryContactOptions.length === 0 && (
              <p data-testid="account-primary-contact-empty" className="text-meta text-mute">
                No matching person found.
              </p>
            )}
          </div>
        </SheetRow>

        <SheetRow label="Phone">
          <Input
            data-testid="account-phone"
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            autoComplete="off"
          />
        </SheetRow>

        <SheetRow label={`Email${isRequired("email") ? " *" : ""}`}>
          <Input
            data-testid="account-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            maxLength={320}
            autoComplete="off"
          />
        </SheetRow>
      </SheetSection>

      {/* 3. BILLING ADDRESS (collapsed) */}
      <details className="border-b border-hair py-4 last:border-b-0 open:border-b-0">
        <summary className="cursor-pointer text-heading font-medium text-ink">Billing address</summary>
        <div className="mt-4 flex flex-col gap-2.5">
          <SheetRow label="Country">
            <Input
              data-testid="account-billing-country"
              type="text"
              value={billingCountry}
              onChange={(e) => setBillingCountry(e.target.value)}
              autoComplete="off"
            />
          </SheetRow>

          <SheetRow label="Address line 1">
            <Input
              data-testid="account-billing-line1"
              type="text"
              value={billingLine1}
              onChange={(e) => setBillingLine1(e.target.value)}
              autoComplete="off"
            />
          </SheetRow>

          <SheetRow label="Address line 2">
            <Input
              data-testid="account-billing-line2"
              type="text"
              value={billingLine2}
              onChange={(e) => setBillingLine2(e.target.value)}
              autoComplete="off"
            />
          </SheetRow>

          <SheetRow label="City">
            <Input
              data-testid="account-billing-city"
              type="text"
              value={billingCity}
              onChange={(e) => setBillingCity(e.target.value)}
              autoComplete="off"
            />
          </SheetRow>

          <SheetRow label="State/region">
            <Input
              data-testid="account-billing-state-region"
              type="text"
              value={billingStateRegion}
              onChange={(e) => setBillingStateRegion(e.target.value)}
              autoComplete="off"
            />
          </SheetRow>

          <SheetRow label="Postcode">
            <Input
              data-testid="account-billing-postcode"
              type="text"
              value={billingPostcode}
              onChange={(e) => setBillingPostcode(e.target.value)}
              autoComplete="off"
            />
          </SheetRow>
        </div>
      </details>

      {/* 4. IN YOUR PRACTICE (collapsed) */}
      <details className="border-b border-hair py-4 last:border-b-0 open:border-b-0">
        <summary className="cursor-pointer text-heading font-medium text-ink">In your practice</summary>
        <div className="mt-4 flex flex-col gap-2.5">
          <SheetRow label="Owner">
            <select
              data-testid="account-owner"
              value={ownerUserId}
              onChange={(e) => setOwnerUserId(e.target.value)}
              className="h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20"
            >
              <option value="">Unassigned</option>
              {coachOptions.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </SheetRow>

          <SheetRow label="Parent account">
            <div className="flex flex-col gap-2">
              <Input
                data-testid="account-parent-search"
                type="text"
                placeholder="Search accounts by name"
                value={parentAccountQuery}
                onChange={(e) => setParentAccountQuery(e.target.value)}
                autoComplete="off"
              />
              {parentAccountOptions.length > 0 && (
                <select
                  data-testid="account-parent"
                  value={parentAccountId}
                  onChange={(e) => setParentAccountId(e.target.value)}
                  className="h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20"
                >
                  <option value="">Not linked</option>
                  {parentAccountOptions.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              )}
              {parentAccountQuery.trim().length >= 2 && parentAccountOptions.length === 0 && (
                <p data-testid="account-parent-empty" className="text-meta text-mute">
                  No matching account found.
                </p>
              )}
            </div>
          </SheetRow>

          <SheetRow label="Source">
            <Input
              data-testid="account-source"
              type="text"
              placeholder="How you found them"
              value={source}
              onChange={(e) => setSource(e.target.value)}
              autoComplete="off"
            />
          </SheetRow>

          <SheetRow label="Tags">
            <Input
              data-testid="account-tags"
              type="text"
              placeholder="Comma-separated"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              autoComplete="off"
            />
          </SheetRow>

          <SheetRow label="Account number">
            <Input
              data-testid="account-number"
              type="text"
              value={accountNumber}
              onChange={(e) => setAccountNumber(e.target.value)}
              maxLength={200}
              autoComplete="off"
            />
          </SheetRow>

          <SheetRow label="Status">
            <select
              data-testid="account-status"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20"
            >
              {STATUSES.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </SheetRow>
        </div>
      </details>
    </SideSheet>
  );
}
