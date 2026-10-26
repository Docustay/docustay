// AccountForm — create account form wrapping AccountFormNewAccountSheet (port from webui/src/lib/forms/AccountForm.svelte)
import { useState, useEffect } from "react";
import { api, ApiError } from "@/lib/api.js";
import AccountFormNewAccountSheet from "./AccountFormNewAccountSheet.jsx";

const ACCOUNT_TYPES = [
  { value: "prospect", label: "Prospect" },
  { value: "customer", label: "Customer" },
  { value: "partner", label: "Partner" },
  { value: "vendor", label: "Vendor" },
  { value: "other", label: "Other" },
];

const STATUSES = [
  { value: "prospect", label: "Prospect" },
  { value: "active", label: "Active" },
  { value: "paused", label: "Paused" },
  { value: "closed", label: "Closed" },
];

export default function AccountForm({ onDone = null, onCancel = null }) {
  // Section 1: Who they are
  const [name, setName] = useState("");
  const [accountType, setAccountType] = useState("");
  const [industry, setIndustry] = useState("");
  const [employeeCount, setEmployeeCount] = useState("");
  const [website, setWebsite] = useState("");
  const [description, setDescription] = useState("");

  // Section 2: Reach them
  const [primaryContactQuery, setPrimaryContactQuery] = useState("");
  const [primaryContactOptions, setPrimaryContactOptions] = useState([]);
  const [primaryContactId, setPrimaryContactId] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");

  // Section 3: Billing address
  const [billingCountry, setBillingCountry] = useState("");
  const [billingLine1, setBillingLine1] = useState("");
  const [billingLine2, setBillingLine2] = useState("");
  const [billingCity, setBillingCity] = useState("");
  const [billingStateRegion, setBillingStateRegion] = useState("");
  const [billingPostcode, setBillingPostcode] = useState("");

  // Section 4: In your practice
  const [ownerUserId, setOwnerUserId] = useState("");
  const [coachOptions, setCoachOptions] = useState([]);
  const [parentAccountQuery, setParentAccountQuery] = useState("");
  const [parentAccountOptions, setParentAccountOptions] = useState([]);
  const [parentAccountId, setParentAccountId] = useState("");
  const [source, setSource] = useState("");
  const [tags, setTags] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [status, setStatus] = useState("active");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  // Required fields from the setting
  const [requiredFields, setRequiredFields] = useState([]);

  // Load required fields
  useEffect(() => {
    api.request("/api/settings/fields-required").then((data) => {
      const rules = data?.rules?.account;
      if (rules) setRequiredFields(rules.required || []);
    }).catch(() => { setRequiredFields([]); });
  }, []);

  // Helper to check if a field is required
  const isRequired = (fieldName) => requiredFields.includes(fieldName);

  // Load owner (staff) options
  useEffect(() => {
    api.teamRoster().then((r) => {
      setCoachOptions((r?.roster?.rows ?? [])
        .map((p) => ({ value: p.id, label: p.display_name ?? p.email ?? p.id })));
    }).catch(() => { setCoachOptions([]); });
  }, []);

  // Debounced search over `/api/list/people/all` for primary contact
  useEffect(() => {
    const q = primaryContactQuery.trim();
    if (q.length < 2) { setPrimaryContactOptions([]); return; }
    let live = true;
    const t = setTimeout(async () => {
      try {
        const r = await api.request(`/api/list/people/all?limit=8`);
        if (!live) return;
        const needle = q.toLowerCase();
        setPrimaryContactOptions((r?.rows ?? [])
          .filter((p) => (p.display_name ?? "").toLowerCase().includes(needle))
          .map((p) => ({ value: p.id, label: p.display_name ?? p.email ?? p.id })));
      } catch { if (live) setPrimaryContactOptions([]); }
    }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [primaryContactQuery]);

  // Debounced search over `/api/list/accounts` for parent account
  useEffect(() => {
    const q = parentAccountQuery.trim();
    if (q.length < 2) { setParentAccountOptions([]); return; }
    let live = true;
    const t = setTimeout(async () => {
      try {
        const r = await api.request(`/api/list/accounts?limit=8`);
        if (!live) return;
        const needle = q.toLowerCase();
        setParentAccountOptions((r?.rows ?? [])
          .filter((a) => (a.name ?? "").toLowerCase().includes(needle))
          .map((a) => ({ value: a.id, label: a.name ?? a.id })));
      } catch { if (live) setParentAccountOptions([]); }
    }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [parentAccountQuery]);

  async function handleSubmit(e) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const created = await api.createAccount({
        name: name.trim(),
        accountType: accountType || undefined,
        industry: industry.trim() || undefined,
        employeeCount: employeeCount ? parseInt(employeeCount) : undefined,
        website: website.trim() || undefined,
        description: description.trim() || undefined,
        primaryContactId: primaryContactId || undefined,
        phone: phone.trim() || undefined,
        email: email.trim() || undefined,
        billingCountry: billingCountry.trim() || undefined,
        billingLine1: billingLine1.trim() || undefined,
        billingLine2: billingLine2.trim() || undefined,
        billingCity: billingCity.trim() || undefined,
        billingStateRegion: billingStateRegion.trim() || undefined,
        billingPostcode: billingPostcode.trim() || undefined,
        ownerUserId: ownerUserId || undefined,
        parentAccountId: parentAccountId || undefined,
        source: source.trim() || undefined,
        tags: tags.trim() ? tags.split(",").map(t => t.trim()).filter(Boolean) : undefined,
        accountNumber: accountNumber.trim() || undefined,
        status: status || undefined,
      });
      onDone?.(created.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err?.message ?? err));
      setBusy(false);
    }
  }

  return (
    <AccountFormNewAccountSheet
      open={true}
      onOpenChange={(isOpen) => { if (!isOpen) onCancel?.(); }}
      ACCOUNT_TYPES={ACCOUNT_TYPES}
      STATUSES={STATUSES}
      onCancel={onCancel}
      name={name}
      setName={setName}
      accountType={accountType}
      setAccountType={setAccountType}
      industry={industry}
      setIndustry={setIndustry}
      employeeCount={employeeCount}
      setEmployeeCount={setEmployeeCount}
      website={website}
      setWebsite={setWebsite}
      description={description}
      setDescription={setDescription}
      primaryContactQuery={primaryContactQuery}
      setPrimaryContactQuery={setPrimaryContactQuery}
      primaryContactOptions={primaryContactOptions}
      primaryContactId={primaryContactId}
      setPrimaryContactId={setPrimaryContactId}
      phone={phone}
      setPhone={setPhone}
      email={email}
      setEmail={setEmail}
      billingCountry={billingCountry}
      setBillingCountry={setBillingCountry}
      billingLine1={billingLine1}
      setBillingLine1={setBillingLine1}
      billingLine2={billingLine2}
      setBillingLine2={setBillingLine2}
      billingCity={billingCity}
      setBillingCity={setBillingCity}
      billingStateRegion={billingStateRegion}
      setBillingStateRegion={setBillingStateRegion}
      billingPostcode={billingPostcode}
      setBillingPostcode={setBillingPostcode}
      ownerUserId={ownerUserId}
      setOwnerUserId={setOwnerUserId}
      coachOptions={coachOptions}
      parentAccountQuery={parentAccountQuery}
      setParentAccountQuery={setParentAccountQuery}
      parentAccountOptions={parentAccountOptions}
      parentAccountId={parentAccountId}
      setParentAccountId={setParentAccountId}
      source={source}
      setSource={setSource}
      tags={tags}
      setTags={setTags}
      accountNumber={accountNumber}
      setAccountNumber={setAccountNumber}
      status={status}
      setStatus={setStatus}
      busy={busy}
      error={error}
      requiredFields={requiredFields}
      isRequired={isRequired}
      submit={handleSubmit}
    />
  );
}
