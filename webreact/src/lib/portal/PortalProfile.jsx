import React, { useState, useEffect } from "react";
import { request, ApiError } from "@/lib/api.js";
import PhoneCard from "../phone/PhoneCard.jsx";
import { PhoneRow as Row, PhoneSectionLabel as SectionLabel } from "../phone/PhoneRow.jsx";
import ScreenState from "@/lib/empty/ScreenState.jsx";
import ErrorPanel from "@/lib/empty/ErrorPanel.jsx";
import PushToggle from "@/lib/phone/PushToggle.jsx";

export default function PortalProfile({ data = null, role = null, terms = {}, onNavigate = null, practiceName = null, privacyUrl = null, termsUrl = null }) {
  // ★ All data flows from the profile endpoint
  const payload = data?.data ?? data ?? null;
  const profile = payload?.profile ?? {};
  const preferences = Array.isArray(payload?.preferences) ? payload.preferences : [];
  const family = payload?.family ?? { payers: [], payerSees: [] };
  const dependents = Array.isArray(payload?.dependents) ? payload.dependents : [];

  // ★ Screen state: loading, error, ready
  const phase = data?.error ? "error" : !data ? "loading" : "ready";

  // ★ Form state for editing
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [showPayerDetails, setShowPayerDetails] = useState(false);
  const [requestDataLoading, setRequestDataLoading] = useState(false);
  const [requestDataSuccess, setRequestDataSuccess] = useState(false);

  const [formData, setFormData] = useState({
    first_name: "",
    last_name: "",
    preferred_name: "",
    pronouns: "",
    mobile_phone: "",
    home_phone: "",
    secondary_email: "",
    preferred_contact_method: "",
    address_line1: "",
    address_line2: "",
    city: "",
    state_region: "",
    postcode: "",
    country: "",
    timezone: "",
  });

  // ★ Sync form data when profile changes
  useEffect(() => {
    if (profile && !editing) {
      setFormData({
        first_name: profile.first_name ?? "",
        last_name: profile.last_name ?? "",
        preferred_name: profile.preferred_name ?? "",
        pronouns: profile.pronouns ?? "",
        mobile_phone: profile.mobile_phone ?? "",
        home_phone: profile.home_phone ?? "",
        secondary_email: profile.secondary_email ?? "",
        preferred_contact_method: profile.preferred_contact_method ?? "",
        address_line1: profile.address_line1 ?? "",
        address_line2: profile.address_line2 ?? "",
        city: profile.city ?? "",
        state_region: profile.state_region ?? "",
        postcode: profile.postcode ?? "",
        country: profile.country ?? "",
        timezone: profile.timezone ?? "",
      });
    }
  }, [profile, editing]);

  // ★ Save profile changes
  async function handleSaveProfile() {
    setSaving(true);
    setSaveError(null);
    setSaveSuccess(false);

    try {
      await request("/api/app/profile", {
        method: "PUT",
        body: formData,
        idempotencyKey: crypto.randomUUID(),
      });

      setSaveSuccess(true);
      setEditing(false);

      setTimeout(() => {
        setSaveSuccess(false);
      }, 3000);
    } catch (e) {
      if (e instanceof ApiError) {
        setSaveError(e.message || "Failed to save profile");
      } else {
        setSaveError(e.message || "An error occurred");
      }
    } finally {
      setSaving(false);
    }
  }

  // ★ Cancel editing
  function handleCancel() {
    setFormData({
      first_name: profile?.first_name ?? "",
      last_name: profile?.last_name ?? "",
      preferred_name: profile?.preferred_name ?? "",
      pronouns: profile?.pronouns ?? "",
      mobile_phone: profile?.mobile_phone ?? "",
      home_phone: profile?.home_phone ?? "",
      secondary_email: profile?.secondary_email ?? "",
      preferred_contact_method: profile?.preferred_contact_method ?? "",
      address_line1: profile?.address_line1 ?? "",
      address_line2: profile?.address_line2 ?? "",
      city: profile?.city ?? "",
      state_region: profile?.state_region ?? "",
      postcode: profile?.postcode ?? "",
      country: profile?.country ?? "",
      timezone: profile?.timezone ?? "",
    });
    setEditing(false);
  }

  // ★ Request data export
  async function handleRequestData() {
    setRequestDataLoading(true);
    setRequestDataSuccess(false);

    try {
      await request("/api/app/profile/request-data", {
        method: "POST",
        idempotencyKey: crypto.randomUUID(),
      });
      setRequestDataSuccess(true);

      setTimeout(() => {
        setRequestDataSuccess(false);
      }, 5000);
    } catch (e) {
      console.error("Failed to request data:", e);
    } finally {
      setRequestDataLoading(false);
    }
  }

  // ★ Get preference for a topic/channel
  const getPreference = (topic, channel) => {
    const pref = preferences.find((p) => p.topic === topic && p.channel === channel);
    return pref?.enabled ?? false;
  };

  // ★ Derive payer names and first payer for explainer
  const payerFirstNames = family.payers.map((p) => p.firstName).filter(Boolean);
  const firstPayerName = payerFirstNames[0] ?? null;
  const hasPayers = family.payers && family.payers.length > 0;
  const hasMultiplePayers = family.payers && family.payers.length > 1;

  // ★ Get first name of the user
  const userFirstName = profile?.first_name ?? profile?.display_name?.split(" ")[0] ?? "";

  // ★ Build explainer text for different roles
  const explainerText = (() => {
    if (role === "adolescent_client" && hasPayers) {
      const payerName = firstPayerName;
      const siblings = hasMultiplePayers
        ? ` and ${payerFirstNames.slice(1).join(" and ")}`
        : "";
      return `${payerName} pays for your sessions${siblings ? ` and ${userFirstName}'s` : ""}. She can see what's owed and when you came — never your notes or what you talk about.`;
    }
    if (role === "adult_client" && hasPayers) {
      return `${firstPayerName} pays for your sessions. She can see what's owed and when you came — never your notes or what you talk about.`;
    }
    return null;
  })();

  const teenExplainerText =
    role === "adolescent_client" && hasPayers
      ? `${firstPayerName} can see that you turned up, and what ${firstPayerName.toLowerCase()} owes.`
      : null;

  return (
    <ScreenState
      phase={phase}
      error={data?.error}
      testIds={{ loading: "account-loading", error: "account-error" }}
    >
      <div className="flex flex-col gap-0 w-full" data-testid="portal-profile">
        {/* ★ the maintainer, 29 Sep 2026 (portal design critique #3) — the page's own header is gone: the
            practice logo + page title now come from PhoneShell (every phone screen), so this
            screen no longer needs its own, and never disagrees with it. */}

        {saveError && (
          <ErrorPanel error={saveError} testId="account-save-error" variant="band" />
        )}

        {saveSuccess && (
          <div
            className="p-4 rounded-lg mb-4 text-[14px] border"
            style={{
              background: "var(--color-success-50)",
              borderColor: "var(--color-success-300)",
              color: "var(--color-success-700)",
            }}
            data-testid="account-save-success"
          >
            Your changes have been saved.
          </div>
        )}

        {/* ★ FAMILY EXPLAINER CARD (only when payers exist) */}
        {hasPayers && role !== "parent" && (
          <>
            <PhoneCard
              variant="act"
              label={`The ${profile?.last_name ?? ""} family account`.trim()}
            >
              <div
                className="text-[13px] mt-1"
                style={{ color: "var(--color-structure-600)", lineHeight: 1.55 }}
              >
                {explainerText}
              </div>
              <div className="flex gap-2 mt-3">
                <button
                  className="px-[13px] h-8 text-[13px] font-medium rounded-[7px] border"
                  style={{
                    background: "var(--color-surface)",
                    borderColor: "var(--color-structure-200)",
                    color: "var(--color-structure-900)",
                    fontFamily: "var(--ks-font-text)",
                  }}
                  onClick={() => {
                    setShowPayerDetails(!showPayerDetails);
                  }}
                  data-testid="what-payer-can-see-btn"
                >
                  What {firstPayerName} can see
                </button>
              </div>
            </PhoneCard>

            {showPayerDetails && (
              <PhoneCard variant="plain">
                <div className="flex flex-col gap-0">
                  {family.payerSees.map((item, idx) => (
                    <div
                      key={idx}
                      className="flex gap-3 py-[13px] border-b"
                      style={{ borderColor: "var(--color-structure-150)" }}
                    >
                      <span className="flex-1 text-[14px]">{item}</span>
                    </div>
                  ))}
                </div>
              </PhoneCard>
            )}
          </>
        )}

        {/* ★ MONEY SECTION (only for adults and not teens) */}
        {role !== "adolescent_client" && role !== "parent" && (
          <>
            {hasPayers && (
              <>
                <div
                  className="text-[12.5px] font-medium m-0 my-[18px] mb-[6px]"
                  style={{ color: "var(--color-structure-600)" }}
                >
                  Money
                </div>
                <PhoneCard variant="plain">
                  <div
                    className="flex gap-3 py-[13px] border-b text-[14px]"
                    style={{ borderColor: "var(--color-structure-150)" }}
                  >
                    <span className="flex-1">View your money details</span>
                    <span style={{ color: "var(--color-structure-600)" }}>Coming soon</span>
                  </div>
                </PhoneCard>
              </>
            )}
          </>
        )}

        {/* ★ TEEN EXPLAINER (simple text, no figures) */}
        {role === "adolescent_client" && hasPayers && (
          <>
            <div
              className="text-[12.5px] font-medium m-0 my-[18px] mb-[6px]"
              style={{ color: "var(--color-structure-600)" }}
            >
              What {firstPayerName} can see
            </div>
            <PhoneCard variant="plain">
              <div
                className="text-[13px] mt-1"
                style={{ color: "var(--color-structure-600)", lineHeight: 1.55 }}
              >
                {teenExplainerText}
              </div>
            </PhoneCard>
          </>
        )}

        {/* ★ the maintainer, 29 Sep 2026 (portal critique #4/#5/#8) — "Your details", "What we send you" and
            push notifications are now ONE card (a group, not three loose bordered divs), and the
            section label reads as a heading instead of a fourth row. "Edit" (critique #2 — used to
            sit alone with nothing under it) is now the "Your details" row's own click target. */}
        <SectionLabel>You</SectionLabel>
        <PhoneCard variant="plain">
        {editing ? (
          // Edit form
            <form className="flex flex-col gap-6" data-testid="profile-form">
              {/* Name fieldset */}
              <fieldset>
                <legend
                  className="text-[15px] font-medium mb-4"
                  style={{ fontFamily: "var(--ks-font-text)" }}
                >
                  Name
                </legend>
                <div className="flex flex-col gap-2 mb-4">
                  <label htmlFor="first-name" className="text-[0.875rem] font-medium">
                    First name
                  </label>
                  <input
                    type="text"
                    id="first-name"
                    value={formData.first_name}
                    onChange={(e) =>
                      setFormData({ ...formData, first_name: e.target.value })
                    }
                    data-testid="first-name-input"
                    className="px-2 py-2 border rounded-lg text-[0.875rem]"
                    style={{ borderColor: "var(--color-structure-200)" }}
                  />
                </div>
                <div className="flex flex-col gap-2 mb-4">
                  <label htmlFor="last-name" className="text-[0.875rem] font-medium">
                    Last name
                  </label>
                  <input
                    type="text"
                    id="last-name"
                    value={formData.last_name}
                    onChange={(e) =>
                      setFormData({ ...formData, last_name: e.target.value })
                    }
                    data-testid="last-name-input"
                    className="px-2 py-2 border rounded-lg text-[0.875rem]"
                    style={{ borderColor: "var(--color-structure-200)" }}
                  />
                </div>
                <div className="flex flex-col gap-2 mb-4">
                  <label htmlFor="preferred-name" className="text-[0.875rem] font-medium">
                    Preferred name
                  </label>
                  <input
                    type="text"
                    id="preferred-name"
                    value={formData.preferred_name}
                    onChange={(e) =>
                      setFormData({ ...formData, preferred_name: e.target.value })
                    }
                    data-testid="preferred-name-input"
                    className="px-2 py-2 border rounded-lg text-[0.875rem]"
                    style={{ borderColor: "var(--color-structure-200)" }}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <label htmlFor="pronouns" className="text-[0.875rem] font-medium">
                    Pronouns
                  </label>
                  <input
                    type="text"
                    id="pronouns"
                    placeholder="e.g., she/her, they/them"
                    value={formData.pronouns}
                    onChange={(e) =>
                      setFormData({ ...formData, pronouns: e.target.value })
                    }
                    data-testid="pronouns-input"
                    className="px-2 py-2 border rounded-lg text-[0.875rem]"
                    style={{ borderColor: "var(--color-structure-200)" }}
                  />
                </div>
              </fieldset>

              {/* How to reach you fieldset */}
              <fieldset>
                <legend
                  className="text-[15px] font-medium mb-4"
                  style={{ fontFamily: "var(--ks-font-text)" }}
                >
                  How to reach you
                </legend>
                <div className="flex flex-col gap-2 mb-4">
                  <label htmlFor="mobile-phone" className="text-[0.875rem] font-medium">
                    Mobile
                  </label>
                  <input
                    type="tel"
                    id="mobile-phone"
                    value={formData.mobile_phone}
                    onChange={(e) =>
                      setFormData({ ...formData, mobile_phone: e.target.value })
                    }
                    data-testid="mobile-phone-input"
                    className="px-2 py-2 border rounded-lg text-[0.875rem]"
                    style={{ borderColor: "var(--color-structure-200)" }}
                  />
                </div>
                <div className="flex flex-col gap-2 mb-4">
                  <label htmlFor="home-phone" className="text-[0.875rem] font-medium">
                    Home phone
                  </label>
                  <input
                    type="tel"
                    id="home-phone"
                    value={formData.home_phone}
                    onChange={(e) =>
                      setFormData({ ...formData, home_phone: e.target.value })
                    }
                    data-testid="home-phone-input"
                    className="px-2 py-2 border rounded-lg text-[0.875rem]"
                    style={{ borderColor: "var(--color-structure-200)" }}
                  />
                </div>
                <div className="flex flex-col gap-2 mb-4">
                  <label htmlFor="secondary-email" className="text-[0.875rem] font-medium">
                    Secondary email
                  </label>
                  <input
                    type="email"
                    id="secondary-email"
                    value={formData.secondary_email}
                    onChange={(e) =>
                      setFormData({ ...formData, secondary_email: e.target.value })
                    }
                    data-testid="secondary-email-input"
                    className="px-2 py-2 border rounded-lg text-[0.875rem]"
                    style={{ borderColor: "var(--color-structure-200)" }}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <label htmlFor="preferred-contact" className="text-[0.875rem] font-medium">
                    Preferred contact method
                  </label>
                  <select
                    id="preferred-contact"
                    value={formData.preferred_contact_method}
                    onChange={(e) =>
                      setFormData({ ...formData, preferred_contact_method: e.target.value })
                    }
                    data-testid="preferred-contact-select"
                    className="px-2 py-2 border rounded-lg text-[0.875rem]"
                    style={{ borderColor: "var(--color-structure-200)" }}
                  >
                    <option value="">Not specified</option>
                    <option value="email">Email</option>
                    <option value="text">Text message</option>
                    <option value="call">Phone call</option>
                    <option value="none">Do not contact</option>
                  </select>
                </div>
              </fieldset>

              {/* Address fieldset */}
              <fieldset>
                <legend
                  className="text-[15px] font-medium mb-4"
                  style={{ fontFamily: "var(--ks-font-text)" }}
                >
                  Address
                </legend>
                <div className="flex flex-col gap-2 mb-4">
                  <label htmlFor="address-line1" className="text-[0.875rem] font-medium">
                    Address
                  </label>
                  <input
                    type="text"
                    id="address-line1"
                    value={formData.address_line1}
                    onChange={(e) =>
                      setFormData({ ...formData, address_line1: e.target.value })
                    }
                    data-testid="address-line1-input"
                    className="px-2 py-2 border rounded-lg text-[0.875rem]"
                    style={{ borderColor: "var(--color-structure-200)" }}
                  />
                </div>
                <div className="flex flex-col gap-2 mb-4">
                  <label htmlFor="address-line2" className="text-[0.875rem] font-medium">
                    Apt, suite, etc.
                  </label>
                  <input
                    type="text"
                    id="address-line2"
                    value={formData.address_line2}
                    onChange={(e) =>
                      setFormData({ ...formData, address_line2: e.target.value })
                    }
                    data-testid="address-line2-input"
                    className="px-2 py-2 border rounded-lg text-[0.875rem]"
                    style={{ borderColor: "var(--color-structure-200)" }}
                  />
                </div>
                <div className="flex flex-col gap-2 mb-4">
                  <label htmlFor="city" className="text-[0.875rem] font-medium">
                    City
                  </label>
                  <input
                    type="text"
                    id="city"
                    value={formData.city}
                    onChange={(e) =>
                      setFormData({ ...formData, city: e.target.value })
                    }
                    data-testid="city-input"
                    className="px-2 py-2 border rounded-lg text-[0.875rem]"
                    style={{ borderColor: "var(--color-structure-200)" }}
                  />
                </div>
                <div className="flex flex-col gap-2 mb-4">
                  <label htmlFor="state-region" className="text-[0.875rem] font-medium">
                    State/Region
                  </label>
                  <input
                    type="text"
                    id="state-region"
                    value={formData.state_region}
                    onChange={(e) =>
                      setFormData({ ...formData, state_region: e.target.value })
                    }
                    data-testid="state-region-input"
                    className="px-2 py-2 border rounded-lg text-[0.875rem]"
                    style={{ borderColor: "var(--color-structure-200)" }}
                  />
                </div>
                <div className="flex flex-col gap-2 mb-4">
                  <label htmlFor="postcode" className="text-[0.875rem] font-medium">
                    Postcode
                  </label>
                  <input
                    type="text"
                    id="postcode"
                    value={formData.postcode}
                    onChange={(e) =>
                      setFormData({ ...formData, postcode: e.target.value })
                    }
                    data-testid="postcode-input"
                    className="px-2 py-2 border rounded-lg text-[0.875rem]"
                    style={{ borderColor: "var(--color-structure-200)" }}
                  />
                </div>
                <div className="flex flex-col gap-2 mb-4">
                  <label htmlFor="country" className="text-[0.875rem] font-medium">
                    Country
                  </label>
                  <input
                    type="text"
                    id="country"
                    value={formData.country}
                    onChange={(e) =>
                      setFormData({ ...formData, country: e.target.value })
                    }
                    data-testid="country-input"
                    className="px-2 py-2 border rounded-lg text-[0.875rem]"
                    style={{ borderColor: "var(--color-structure-200)" }}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <label htmlFor="timezone" className="text-[0.875rem] font-medium">
                    Timezone
                  </label>
                  <input
                    type="text"
                    id="timezone"
                    placeholder="e.g., America/New_York"
                    value={formData.timezone}
                    onChange={(e) =>
                      setFormData({ ...formData, timezone: e.target.value })
                    }
                    data-testid="timezone-input"
                    className="px-2 py-2 border rounded-lg text-[0.875rem]"
                    style={{ borderColor: "var(--color-structure-200)" }}
                  />
                </div>
              </fieldset>

              {/* Form actions */}
              <div className="flex gap-3 mt-6">
                <button
                  type="button"
                  className="px-4 py-2 font-medium text-[14px] rounded-lg border disabled:opacity-50 disabled:cursor-not-allowed"
                  style={{
                    background: "var(--color-surface)",
                    color: "var(--color-structure-900)",
                    borderColor: "var(--color-structure-200)",
                    fontFamily: "var(--ks-font-text)",
                  }}
                  onClick={handleCancel}
                  disabled={saving}
                  data-testid="cancel-btn"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="px-4 py-2 font-medium text-[14px] rounded-lg border disabled:opacity-50 disabled:cursor-not-allowed"
                  style={{
                    background: "var(--color-action-600)",
                    color: "var(--color-surface)",
                    borderColor: "var(--color-action-600)",
                    fontFamily: "var(--ks-font-text)",
                  }}
                  onClick={handleSaveProfile}
                  disabled={saving}
                  data-testid="save-btn"
                >
                  {saving ? "Saving..." : "Save"}
                </button>
              </div>
            </form>
        ) : (
          // Display mode
          <>
            <Row
              title="Your details"
              detail="Name, email, phone, address"
              onClick={() => setEditing(true)}
              testId="account-details-row"
            />
            <Row
              title="What we send you"
              detail={
                getPreference("booking", "text") && getPreference("booking", "email")
                  ? "Reminders by text and everything else by email"
                  : getPreference("booking", "text")
                    ? "Reminders by text"
                    : getPreference("booking", "email")
                      ? "Everything by email"
                      : "Not receiving reminders"
              }
              testId="account-notifications-row"
            />
            <PushToggle app="client" />
          </>
        )}
        </PhoneCard>
        {/* ★ Critique #6 — "Signing in / Face ID is not yet available" was internal roadmap
            wording shown to a client. Removed rather than explained; PushToggle's own
            "not built yet" browser state is hidden the same way (see that file). */}

        {/* ★ the maintainer, 29 Sep 2026 (critique #7) — "Download everything" and "Request my data" were
            two separate controls for the ONE action the frame shows as a single row
            (AppClientAccount.frame.html: "Download everything / Sessions, invoices, documents
            and notes, as one file"). The bordered button was the loudest thing on the screen for
            the least-used action; it's gone, folded into the row itself, same quiet weight as
            every other row in this card. */}
        <SectionLabel>Your information</SectionLabel>
        <PhoneCard variant="plain">
          <Row
            title="Download everything"
            detail={requestDataLoading ? "Requesting…" : "Sessions, invoices, documents and notes, as one file"}
            onClick={requestDataLoading ? undefined : handleRequestData}
            testId="request-data-row"
          />
        </PhoneCard>

        {requestDataSuccess && (
          <div
            className="p-4 rounded-lg my-4 text-[14px] border"
            style={{
              background: "var(--color-success-50)",
              borderColor: "var(--color-success-300)",
              color: "var(--color-success-700)",
            }}
            data-testid="request-data-success"
          >
            Your data export request has been received. You will receive an email with your data.
          </div>
        )}

        {/* ★ FOOTER — [TY, RULED 1 Oct 2026] site-readiness brief, Part 3. Was hardcoded to
            "an example organisation" (wrong for every OTHER practice on the platform) with a dead
            "Privacy" button (onClick: () => {}, went nowhere). Now: the practice's own name, its
            own Privacy/Terms links when it has set one (practice.privacy_url/practice.terms_url,
            `null` for every tenant that hasn't — Docustay has, via migration 0555), and the platform's own
            three legal pages (src/routes/legal.mjs), always present regardless of what the
            practice has configured. */}
        <div
          className="mt-[18px] pt-[18px] border-t text-center text-[12.5px]"
          style={{
            borderColor: "var(--color-structure-150)",
            color: "var(--color-structure-600)",
            lineHeight: 1.6,
          }}
        >
          <span className="block">
            {practiceName || "Your practice"} ·{" "}
            <button
              className="bg-none border-none text-[inherit] p-0 hover:underline"
              onClick={() => {}}
              style={{ cursor: "pointer", color: "var(--color-action-600)" }}
            >
              Get help
            </button>
            {privacyUrl ? (
              <>
                {" "}·{" "}
                <a href={privacyUrl} target="_blank" rel="noopener noreferrer" className="hover:underline" style={{ color: "var(--color-action-600)" }}>
                  Privacy
                </a>
              </>
            ) : null}
            {termsUrl ? (
              <>
                {" "}·{" "}
                <a href={termsUrl} target="_blank" rel="noopener noreferrer" className="hover:underline" style={{ color: "var(--color-action-600)" }}>
                  Terms
                </a>
              </>
            ) : null}
          </span>
          <span className="mt-1.5 block">
            Powered by Workbench ·{" "}
            <a href="/legal/privacy" target="_blank" rel="noopener noreferrer" className="hover:underline" style={{ color: "var(--color-structure-600)" }}>
              Privacy
            </a>
            {" "}·{" "}
            <a href="/legal/terms" target="_blank" rel="noopener noreferrer" className="hover:underline" style={{ color: "var(--color-structure-600)" }}>
              Terms
            </a>
            {" "}·{" "}
            <a href="/legal/dpa" target="_blank" rel="noopener noreferrer" className="hover:underline" style={{ color: "var(--color-structure-600)" }}>
              DPA
            </a>
          </span>
        </div>
      </div>
    </ScreenState>
  );
}
