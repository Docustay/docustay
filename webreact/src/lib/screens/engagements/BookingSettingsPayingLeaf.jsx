// ═══════════════════════════════════════════════════════════════════════════════════════════════
// R5.010 — BookingSettingsPayingLeaf: rebuild from specs/mockups/BookingSettingsPaying.frame.html
// on `none (part — composes kit components)`. Ported from
// webui/src/lib/screens/engagements/BookingSettingsPayingLeaf.svelte (498 lines, 74 of them <style>):
// same props, testids and copy; markup/data/handlers ported; styles become Tailwind utilities + tokens.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useState, useEffect } from "react";
import { request, ApiError } from "@/lib/api.js";
import ScreenState from "@/lib/empty/ScreenState.jsx";
import { Tabs, TabsList, TabsTrigger } from "@/lib/components/ui/tabs";
import { Field, FieldLabel, FieldDescription, FieldContent } from "@/lib/components/ui/field.jsx";
import { NativeSelect, NativeSelectOption } from "@/lib/components/ui/native-select.jsx";
import { Input } from "@/lib/components/ui/input.jsx";
import { Textarea } from "@/lib/components/ui/textarea.jsx";
import { Switch } from "@/lib/components/ui/switch.jsx";
import { Button } from "@/lib/components/ui/button.jsx";
import DisabledWithReason from "@/lib/forms/DisabledWithReason.jsx";
import { policySentence } from "../../../../../src/booking/policySentence.mjs";

const TABS = [
  { key: "calendar", label: "Calendar and booking", href: "/engagements/booking/settings/calendar" },
  { key: "team", label: "Team and website", href: "/engagements/booking/settings/team" },
  { key: "paying", label: "Paying and cancelling", href: "/engagements/booking/settings/paying" },
  { key: "sending", label: "What we send", href: "/engagements/booking/settings/sending" },
  { key: "history", label: "History", href: "/engagements/booking/settings/history" },
];

const LATE_CANCEL_OPTIONS = [
  { value: "free", label: "It's still free" },
  { value: "credit_back", label: "Comes out of their block" },
  { value: "charge_percent", label: "Charge a percentage" },
];

const NUMBER_WORDS = [null, "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"];

function numberWord(n) {
  return n >= 1 && n <= 10 ? NUMBER_WORDS[n] : String(n);
}

export default function BookingSettingsPayingLeaf({ onNavigate = null }) {
  const [phase, setPhase] = useState("loading");
  const [error, setError] = useState(null);
  const [view, setView] = useState(null);
  const [savingKey, setSavingKey] = useState(null);
  const [writeError, setWriteError] = useState(null);
  const [editingPolicyText, setEditingPolicyText] = useState(false);
  const [policyTextDraft, setPolicyTextDraft] = useState("");

  function go(href) {
    if (onNavigate) onNavigate(href);
    else window.location.assign(href);
  }

  function onTabChange(value) {
    const tab = TABS.find((t) => t.key === value);
    if (tab && tab.key !== "paying") go(tab.href);
  }

  async function load() {
    setPhase("loading");
    setError(null);
    try {
      const data = await request("/api/engagements/booking-settings");
      setView(data);
      setPhase("ready");
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setPhase("denied");
        setError(err);
      } else {
        setPhase("error");
        setError(
          err instanceof ApiError
            ? { message: err.message, requestId: err.requestId }
            : { message: String(err?.message ?? err) }
        );
      }
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function save(key, value) {
    setWriteError(null);
    setSavingKey(key);
    try {
      await request("/api/settings", { method: "POST", body: { key, value } });
      await load();
    } catch (err) {
      setWriteError(err instanceof ApiError ? err.message : String(err?.message ?? err));
    } finally {
      setSavingKey(null);
    }
  }

  const keys = view?.keys ?? {};
  const overrides = view?.overrides ?? [];

  const cardOverrideCount = overrides.filter((o) => o.fields.includes("card_required_at_booking")).length;
  const cardOverrideNote =
    cardOverrideCount === 0
      ? null
      : `${numberWord(cardOverrideCount)} ${cardOverrideCount === 1 ? "service overrides" : "services override"} it.`;

  const cancelOverrideCount = overrides.filter((o) => o.fields.includes("cancellation_notice_minutes")).length;
  const cancelWindowSummary =
    cancelOverrideCount === 0
      ? "Every service uses the practice's 24-hour window."
      : `${numberWord(cancelOverrideCount)} ${cancelOverrideCount === 1 ? "service sets" : "services set"} its own window.`;

  const PRACTICE_BASELINE_CANCELLATION_NOTICE_MINUTES = 1440;
  const generatedPolicySentence = (() => {
    if (!view) return "";
    return policySentence({
      client_may_reschedule: keys["booking.client_may_reschedule"],
      client_may_cancel: keys["booking.client_may_cancel"],
      cancellation_notice_minutes: PRACTICE_BASELINE_CANCELLATION_NOTICE_MINUTES,
      late_cancel_behaviour: keys["booking.late_cancel_behaviour"],
      late_cancel_charge_percent: keys["booking.late_cancel_charge_percent"],
    }).sentence;
  })();

  const policyTextValue =
    typeof keys["booking.policy_text"] === "string" && keys["booking.policy_text"].trim() !== ""
      ? keys["booking.policy_text"]
      : null;
  const policyTextDisplay = policyTextValue ?? generatedPolicySentence;

  function startEditPolicyText() {
    setPolicyTextDraft(policyTextValue ?? "");
    setEditingPolicyText(true);
  }

  function cancelEditPolicyText() {
    setEditingPolicyText(false);
    setPolicyTextDraft("");
  }

  async function savePolicyText() {
    const trimmed = policyTextDraft.trim();
    await save("booking.policy_text", trimmed === "" ? null : trimmed);
    setEditingPolicyText(false);
  }

  return (
    <div className="w-full" data-testid="booking-settings-paying">
      {/* Header */}
      <div style={{ marginBottom: "6px" }}>
        <h1 className="m-0 text-[24px] font-medium text-ink" style={{ letterSpacing: "-0.01em" }}>
          Booking settings
        </h1>
        <p className="m-0" style={{ margin: "5px 0 18px" }}>
          <span className="text-sm text-ink-muted">
            How booking works for the whole practice. Any service can differ.
          </span>
        </p>
      </div>

      {/* Tabs */}
      <Tabs value="paying" onValueChange={onTabChange} data-testid="booking-settings-tabs">
        <TabsList className="border-b border-line" style={{ marginBottom: "22px" }} variant="line">
          {TABS.map((tab) => (
            <TabsTrigger key={tab.key} value={tab.key} data-testid={`booking-settings-tab-${tab.key}`}>
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {/* Content */}
      <ScreenState
        phase={phase}
        error={phase === "error" ? error : null}
        reason={phase === "denied" ? error?.message ?? null : null}
        testIds={{ error: "paying-error", denied: "paying-denied" }}
      >
        {writeError && (
          <p className="m-0 mb-4 p-2.5 rounded-sm bg-chip-bad-bg text-chip-bad-ink text-sm" role="alert" data-testid="paying-write-error">
            {writeError}
          </p>
        )}

        {/* ═══ Before they book ═════════════════════════════════════════════ */}
        <section className="bg-surface border border-line rounded-card" style={{ marginBottom: "18px" }} data-testid="paying-block-before">
          <div className="border-b border-line-soft text-sm font-medium text-ink" style={{ padding: "14px 17px" }}>
            Before they book
          </div>
          <div style={{ padding: "2px 17px 6px" }}>
            {/* What has to happen first */}
            <div className="flex gap-5 items-start" style={{ padding: "16px 0", borderBottom: "1px solid var(--line-soft)" }} data-testid="paying-row-card-required">
              <div style={{ width: "280px", flex: "0 0 280px" }}>
                <label htmlFor="paying-card-required" className="block text-sm font-medium text-ink">
                  What has to happen first
                </label>
                <p className="m-0 mt-1 text-xs text-ink-muted leading-normal">
                  Your default.
                  {cardOverrideNote && (
                    <span
                      className="inline-flex items-center h-5 px-1.75 ml-1.5 rounded-sm bg-chip-warn-bg text-chip-warn-ink text-xs font-medium"
                      data-testid="paying-card-required-override"
                    >
                      {cardOverrideNote}
                    </span>
                  )}
                </p>
              </div>
              <div style={{ flex: "1 1 auto", maxWidth: "460px", display: "flex", alignItems: "center", gap: "var(--gap)", flexWrap: "wrap" }}>
                <NativeSelect
                  id="paying-card-required"
                  value={keys["booking.card_required_at_booking"] ? "required" : "not_required"}
                  disabled={savingKey === "booking.card_required_at_booking"}
                  data-testid="paying-card-required"
                  onChange={(e) => save("booking.card_required_at_booking", e.target.value === "required")}
                >
                  <NativeSelectOption value="not_required">Nothing required</NativeSelectOption>
                  <NativeSelectOption value="required">A card on file</NativeSelectOption>
                </NativeSelect>
              </div>
            </div>

            {/* Deposit */}
            <div className="flex gap-5 items-start" style={{ padding: "16px 0", borderBottom: "1px solid var(--line-soft)" }} data-testid="paying-row-deposit">
              <div style={{ width: "280px", flex: "0 0 280px" }}>
                <label className="block text-sm font-medium text-ink">Deposit</label>
                <p className="m-0 mt-1 text-xs text-ink-muted leading-normal">Only used by services set to take one.</p>
              </div>
              <div style={{ flex: "1 1 auto", maxWidth: "460px", display: "flex", alignItems: "center", gap: "var(--gap)", flexWrap: "wrap" }}>
                <Button
                  id="paying-deposit-link"
                  variant="link"
                  size="sm"
                  data-testid="paying-deposit-link"
                  onClick={() => go("/items/services")}
                >
                  Set per service
                </Button>
              </div>
            </div>

            {/* Pay over time */}
            <div className="flex gap-5 items-start" style={{ padding: "16px 0", borderBottom: "1px solid var(--line-soft)" }} data-testid="paying-row-bnpl">
              <div style={{ width: "280px", flex: "0 0 280px" }}>
                <label className="block text-sm font-medium text-ink">Pay over time</label>
                <p className="m-0 mt-1 text-xs text-ink-muted leading-normal">
                  Affirm and Klarna at checkout. Never on anything recurring.
                </p>
              </div>
              <div style={{ flex: "1 1 auto", maxWidth: "460px", display: "flex", alignItems: "center", gap: "var(--gap)", flexWrap: "wrap" }}>
                <DisabledWithReason disabled={true} reason="Stripe has to approve this first" testId="paying-bnpl">
                  {({ disabled, describedBy }) => (
                    <div className="flex items-start gap-3 w-full">
                      <span className="flex-1 text-sm text-ink leading-normal">
                        Offer Affirm and Klarna at checkout
                      </span>
                      <Switch checked={false} disabled={disabled} aria-describedby={describedBy} data-testid="paying-bnpl-switch" />
                    </div>
                  )}
                </DisabledWithReason>
              </div>
            </div>
          </div>
        </section>

        {/* ═══ If they cancel ════════════════════════════════════════════════ */}
        <section className="bg-surface border border-line rounded-card" style={{ marginBottom: "18px" }} data-testid="paying-block-cancel">
          <div className="border-b border-line-soft text-sm font-medium text-ink" style={{ padding: "14px 17px" }}>
            If they cancel
          </div>
          <div style={{ padding: "2px 17px 6px" }}>
            {/* Free until */}
            <div className="flex gap-5 items-start" style={{ padding: "16px 0", borderBottom: "1px solid var(--line-soft)" }} data-testid="paying-row-cancel-window">
              <div style={{ width: "280px", flex: "0 0 280px" }}>
                <label className="block text-sm font-medium text-ink">Free until</label>
                <p className="m-0 mt-1 text-xs text-ink-muted leading-normal">
                  There's no practice-wide window — it's set per service.
                </p>
              </div>
              <div style={{ flex: "1 1 auto", maxWidth: "460px", display: "flex", alignItems: "center", gap: "var(--gap)", flexWrap: "wrap" }}>
                <span className="text-sm text-ink" data-testid="paying-cancel-window-summary">
                  {cancelWindowSummary}
                </span>
                <Button
                  variant="link"
                  size="sm"
                  data-testid="paying-cancel-window-link"
                  onClick={() => go("/engagements/booking/rules")}
                >
                  Set per service
                </Button>
              </div>
            </div>

            {/* After that */}
            <div className="flex gap-5 items-start" style={{ padding: "16px 0", borderBottom: "1px solid var(--line-soft)" }} data-testid="paying-row-late-cancel">
              <div style={{ width: "280px", flex: "0 0 280px" }}>
                <label htmlFor="paying-late-cancel-behaviour" className="block text-sm font-medium text-ink">
                  After that
                </label>
                <p className="m-0 mt-1 text-xs text-ink-muted leading-normal">
                  What happens to a late cancellation. A choice the practice makes — never a default.
                </p>
              </div>
              <div style={{ flex: "1 1 auto", maxWidth: "460px", display: "flex", alignItems: "center", gap: "var(--gap)", flexWrap: "wrap" }}>
                <NativeSelect
                  id="paying-late-cancel-behaviour"
                  value={keys["booking.late_cancel_behaviour"] ?? ""}
                  disabled={savingKey === "booking.late_cancel_behaviour"}
                  data-testid="paying-late-cancel-behaviour"
                  onChange={(e) => save("booking.late_cancel_behaviour", e.target.value)}
                >
                  {LATE_CANCEL_OPTIONS.map((opt) => (
                    <NativeSelectOption key={opt.value} value={opt.value}>
                      {opt.label}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
                {keys["booking.late_cancel_behaviour"] === "charge_percent" && (
                  <div className="flex items-center gap-2" style={{ marginTop: "8px" }}>
                    <Input
                      type="number"
                      min="0"
                      max="100"
                      step="1"
                      id="paying-late-cancel-percent"
                      value={keys["booking.late_cancel_charge_percent"] ?? ""}
                      disabled={savingKey === "booking.late_cancel_charge_percent"}
                      data-testid="paying-late-cancel-percent"
                      onChange={(e) => save("booking.late_cancel_charge_percent", Number(e.target.value))}
                      style={{ width: "72px" }}
                    />
                    <span className="text-sm text-ink-muted">% of the price</span>
                  </div>
                )}
              </div>
            </div>

            {/* A no-show */}
            <div className="flex gap-5 items-start" style={{ padding: "16px 0", borderBottom: "1px solid var(--line-soft)" }} data-testid="paying-row-no-show">
              <div style={{ width: "280px", flex: "0 0 280px" }}>
                <label htmlFor="paying-no-show-percent" className="block text-sm font-medium text-ink">
                  A no-show
                </label>
                <p className="m-0 mt-1 text-xs text-ink-muted leading-normal">
                  Someone who simply doesn't turn up. A choice the practice makes — never a default.
                </p>
              </div>
              <div style={{ flex: "1 1 auto", maxWidth: "460px", display: "flex", alignItems: "center", gap: "var(--gap)", flexWrap: "wrap" }}>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min="0"
                    max="100"
                    step="1"
                    id="paying-no-show-percent"
                    value={keys["booking.no_show_charge_percent"] ?? ""}
                    disabled={savingKey === "booking.no_show_charge_percent"}
                    data-testid="paying-no-show-percent"
                    onChange={(e) => save("booking.no_show_charge_percent", Number(e.target.value))}
                    style={{ width: "72px" }}
                  />
                  <span className="text-sm text-ink-muted">%, and the session is used up</span>
                </div>
              </div>
            </div>

            {/* What clients read */}
            <div className="flex gap-5 items-start" style={{ padding: "16px 0", borderBottom: "1px solid var(--line-soft)" }} data-testid="paying-row-policy-text">
              <div style={{ width: "280px", flex: "0 0 280px" }}>
                <label className="block text-sm font-medium text-ink">What clients read</label>
                <p className="m-0 mt-1 text-xs text-ink-muted leading-normal">
                  Shown at booking, and again in the reminder.
                </p>
              </div>
              <div style={{ flex: "1 1 auto", maxWidth: "460px", display: "flex", alignItems: "center", gap: "var(--gap)", flexWrap: "wrap" }}>
                {editingPolicyText ? (
                  <>
                    <Textarea
                      value={policyTextDraft}
                      onInput={(e) => setPolicyTextDraft(e.target.value)}
                      rows="3"
                      data-testid="paying-policy-text-input"
                    />
                    <div className="flex gap-2" style={{ marginTop: "8px" }}>
                      <Button
                        size="sm"
                        variant="outline"
                        data-testid="paying-policy-text-cancel"
                        onClick={cancelEditPolicyText}
                      >
                        Cancel
                      </Button>
                      <Button
                        size="sm"
                        data-testid="paying-policy-text-save"
                        disabled={savingKey === "booking.policy_text"}
                        onClick={savePolicyText}
                      >
                        Save
                      </Button>
                    </div>
                  </>
                ) : (
                  <>
                    <span
                      className="block text-sm text-ink leading-normal overflow-y-auto whitespace-pre-wrap break-words"
                      style={{ maxHeight: "6.5em" }}
                      data-testid="paying-policy-text-display"
                    >
                      {policyTextDisplay}
                    </span>
                    <Button
                      variant="link"
                      size="sm"
                      data-testid="paying-policy-text-edit"
                      onClick={startEditPolicyText}
                    >
                      Edit
                    </Button>
                  </>
                )}
              </div>
            </div>

            {/* Let them cancel themselves */}
            <div className="flex gap-5 items-start" style={{ padding: "16px 0", borderBottom: "1px solid var(--line-soft)" }} data-testid="paying-row-client-may-cancel">
              <div style={{ width: "280px", flex: "0 0 280px" }}>
                <label className="block text-sm font-medium text-ink">Let them cancel themselves</label>
                <p className="m-0 mt-1 text-xs text-ink-muted leading-normal">Or make them message you.</p>
              </div>
              <div style={{ flex: "1 1 auto", maxWidth: "460px", display: "flex", alignItems: "center", gap: "var(--gap)", flexWrap: "wrap" }}>
                <div className="flex items-start gap-3 w-full">
                  <span className="flex-1 text-sm text-ink leading-normal">
                    They can cancel from the portal
                    <span className="block text-xs text-ink-muted" style={{ marginTop: "3px" }}>Inside the free window only.</span>
                  </span>
                  <Switch
                    checked={keys["booking.client_may_cancel"] ?? false}
                    disabled={savingKey === "booking.client_may_cancel"}
                    data-testid="paying-client-may-cancel"
                    onCheckedChange={(v) => save("booking.client_may_cancel", v)}
                  />
                </div>
              </div>
            </div>
          </div>
        </section>
      </ScreenState>
    </div>
  );
}
