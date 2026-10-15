import { useState, useEffect } from "react";
import { request, ApiError } from "@/lib/api.js";
import RailSection from "@/lib/components/editor/RailSection.jsx";
import RailOverrideNote from "@/lib/components/editor/RailOverrideNote.jsx";
import InlineValidation from "@/lib/components/editor/InlineValidation.jsx";
import StatusBadge from "@/lib/components/kit/StatusBadge.jsx";
import DisabledWithReason from "@/lib/forms/DisabledWithReason.jsx";
import { NativeSelect } from "@/lib/components/ui/native-select.jsx";
import { Switch } from "@/lib/components/ui/switch.jsx";
import { Button } from "@/lib/components/ui/button.jsx";
import ServiceEditorRailPaymentModal from "./ServiceEditorRailPaymentModal.jsx";

export default function ServiceEditorRail({
  record,
  mayEdit = false,
  onSaved,
  onArchive,
  onRevertOverride = null,
  onSavePaymentPolicy,
  testId = "service-editor-rail",
}) {
  // Validate required props
  useEffect(() => {
    if (typeof onSaved !== "function") {
      throw new Error(
        "ServiceEditorRail: onSaved is required — a write with no way to reflect the new state is a broken control."
      );
    }
    if (typeof onArchive !== "function") {
      throw new Error(
        "ServiceEditorRail: onArchive is required — Status routing to Archived must always be wired to a real action (14.55's ModalArchiveService), never a dead control."
      );
    }
    if (typeof onSavePaymentPolicy !== "function") {
      throw new Error(
        "ServiceEditorRail: onSavePaymentPolicy is required — confirming the payment policy modal must always be wired to a real save, never a dead control."
      );
    }
  }, [onSaved, onArchive, onSavePaymentPolicy]);

  // Data derivations
  const item = record?.item ?? {};
  const bp = record?.booking_policy ?? {};
  const defaults = record?.rail_defaults ?? {};
  const isArchived = !!item.archived_at;
  const stripeLive = record?.stripe_sync?.state === "in_sync";

  // Status state
  const statusValue = isArchived ? "archived" : item.bookable ? "available" : "hidden";
  const statusLabel = statusValue === "archived" ? "Archived" : statusValue === "hidden" ? "Hidden" : "Available";
  const statusTone = statusValue === "archived" ? "neutral" : statusValue === "hidden" ? "warn" : "ok";

  // Doors state
  const [doorsBusy, setDoorsBusy] = useState(false);
  const [doorsError, setDoorsError] = useState(null);
  const [localUpdatedAt, setLocalUpdatedAt] = useState(record?.item?.updated_at ?? null);

  useEffect(() => {
    setLocalUpdatedAt(record?.item?.updated_at ?? localUpdatedAt);
  }, [record?.item?.updated_at]);

  // Paying state
  const cardRequired = bp.card_required_at_booking;
  const cardRequiredPractice = defaults["booking.card_required_at_booking"] ?? null;
  const cardRequiredEffective = cardRequired ?? cardRequiredPractice ?? null;
  const payingOverridden = cardRequired !== null && cardRequired !== undefined;
  const payingSummary =
    cardRequiredEffective === true
      ? "A card has to be on file before anyone can book."
      : cardRequiredEffective === false
      ? "Nothing is required before someone books."
      : "Not set yet — your practice default applies once one is chosen.";
  const payingDefaultPhrase = cardRequiredPractice === true ? "asks for a card up front" : "asks for nothing up front";

  // Payment modal state
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [selectedMode, setSelectedMode] = useState(null);
  const [paymentBusy, setPaymentBusy] = useState(false);
  const [paymentError, setPaymentError] = useState(null);

  const PAYMENT_OPTIONS = Object.freeze([
    {
      key: "free",
      label: "Nothing up front",
      consequence: "They pick a time and that's it. Easiest to book, and you carry the risk of a no-show.",
    },
    {
      key: "card_on_file",
      label: "A card on file",
      consequence: "No money moves, but you can charge a late cancellation if your policy says so.",
    },
  ]);

  const handleConfirmPaymentPolicy = async () => {
    if (!selectedMode) return;
    setPaymentBusy(true);
    setPaymentError(null);
    try {
      await onSavePaymentPolicy({ serviceId: item.id, mode: selectedMode });
      setPaymentModalOpen(false);
      setSelectedMode(null);
      onSaved();
    } catch (err) {
      setPaymentError(
        err instanceof ApiError ? err.message : err?.message ?? "That could not be saved."
      );
    } finally {
      setPaymentBusy(false);
    }
  };

  // Reset payment modal state when opening
  useEffect(() => {
    if (paymentModalOpen) {
      setSelectedMode(null);
      setPaymentError(null);
    }
  }, [paymentModalOpen]);

  // Cancelling state
  const clientMayCancel = bp.client_may_cancel;
  const clientMayCancelPractice = defaults["booking.client_may_cancel"] ?? null;
  const clientMayCancelEffective = clientMayCancel ?? clientMayCancelPractice ?? true;

  const lateCancelBehaviour = bp.late_cancel_behaviour;
  const lateCancelPercent = bp.late_cancel_charge_percent;
  const practiceLateCancelBehaviour = defaults["booking.late_cancel_behaviour"] ?? null;
  const practiceLateCancelPercent = defaults["booking.late_cancel_charge_percent"] ?? null;
  const effectiveBehaviour = lateCancelBehaviour ?? practiceLateCancelBehaviour;
  const effectivePercent = lateCancelBehaviour != null ? lateCancelPercent : practiceLateCancelPercent;

  const minutesToPhrase = (min) => {
    if (!Number.isInteger(min) || min <= 0) return "no notice";
    if (min % 1440 === 0) {
      const d = min / 1440;
      return `${d} day${d === 1 ? "" : "s"}`;
    }
    if (min % 60 === 0) {
      const h = min / 60;
      return `${h} hour${h === 1 ? "" : "s"}`;
    }
    return `${min} minutes`;
  };

  const behaviourPhrase = (behaviour, percent) => {
    if (behaviour === "free") return "nothing is charged";
    if (behaviour === "credit_back") return "it's credited back instead of charged";
    if (behaviour === "charge_percent") {
      if (percent === 100) return "the session is charged in full";
      if (Number.isInteger(percent)) return `${percent}% of the session is charged`;
      return "a percentage of the session is charged";
    }
    return null;
  };

  const practiceCancelDefaultPhrase = (behaviour, percent) => {
    if (behaviour === "free") return "charges nothing for a late cancellation";
    if (behaviour === "credit_back") return "credits a late cancellation back instead of charging it";
    if (behaviour === "charge_percent") {
      if (percent === 100) return "charges a late cancellation in full";
      if (Number.isInteger(percent)) return `charges ${percent}% for a late cancellation`;
      return "charges a percentage for a late cancellation";
    }
    return "has no late-cancellation rule set yet";
  };

  const cancellingSummary = (() => {
    if (clientMayCancelEffective === false) return "Clients can't cancel their own bookings.";
    const behaviourText = behaviourPhrase(effectiveBehaviour, effectivePercent);
    const windowText = minutesToPhrase(bp.cancellation_notice_minutes);
    if (!behaviourText) return `Free until ${windowText} before.`;
    return `Free until ${windowText} before. After that ${behaviourText}.`;
  })();

  const cancellingOverridden =
    (clientMayCancel !== null && clientMayCancel !== undefined) ||
    (lateCancelBehaviour !== null && lateCancelBehaviour !== undefined) ||
    (bp.cancel_requires_contact !== null && bp.cancel_requires_contact !== undefined);

  const cancellingDefaultPhrase = practiceCancelDefaultPhrase(practiceLateCancelBehaviour, practiceLateCancelPercent);

  // Validate override callbacks if needed
  useEffect(() => {
    if ((payingOverridden || cancellingOverridden) && typeof onRevertOverride !== "function") {
      throw new Error(
        "ServiceEditorRail: onRevertOverride is required once a row shows RailOverrideNote — \"Go back to that\" must always be wired to a real action."
      );
    }
  }, [payingOverridden, cancellingOverridden, onRevertOverride]);

  // Doors summary
  const doorsSummary = (() => {
    const on = [];
    if (item.bookable) on.push("You and your team");
    if (item.portal_bookable) on.push("Clients, from their portal");
    if (item.public_bookable) on.push("Anyone, from your booking page");
    return on.length ? on.join(" · ") : "Nobody can book it right now";
  })();

  // Where it shows up summary
  const channelsSummary = (() => {
    const on = [];
    if (item.public_bookable) on.push("Your booking page");
    if (item.portal_bookable) on.push("the client portal");
    if (!on.length) return "Nowhere yet — turn on a door above.";
    return `${on.join(", ")}, Instagram`;
  })();

  // Stripe state
  const stripeState = record?.stripe_sync?.state ?? "never";
  const stripeLabel = stripeState === "in_sync" ? "In sync" : "Not synced — we'll retry";
  const stripeTone = stripeState === "in_sync" ? "ok" : "warn";

  // Section expanded states
  const [statusOpen, setStatusOpen] = useState(true);
  const [doorsOpen, setDoorsOpen] = useState(true);
  const [payingOpen, setPayingOpen] = useState(true);
  const [cancellingOpen, setCancellingOpen] = useState(true);
  const [shownOpen, setShownOpen] = useState(true);
  const [stripeOpen, setStripeOpen] = useState(false);

  // Handlers
  const handleStatusChange = async (e) => {
    const v = e.target.value;
    e.target.value = statusValue; // controlled — real state changes only once the save lands
    if (v === "archived") {
      onArchive({ id: item.id });
      return;
    }
    await saveDoors({ bookable: v === "available" });
  };

  const saveDoors = async (patch) => {
    if (!mayEdit) return;
    setDoorsBusy(true);
    setDoorsError(null);
    try {
      const res = await request("/api/items/services/update", {
        method: "POST",
        body: { id: item.id, expectedUpdatedAt: localUpdatedAt, ...patch },
      });
      setLocalUpdatedAt(res?.updated_at ?? localUpdatedAt);
      onSaved();
    } catch (err) {
      setDoorsError(
        err instanceof ApiError
          ? { message: err.message, requestId: err.requestId }
          : { message: "You're offline — nothing was saved. Try again when you're back." }
      );
    } finally {
      setDoorsBusy(false);
    }
  };

  const handleToggleDoor = (bookable) => {
    saveDoors({ bookable });
  };

  return (
    <div className="flex flex-col" data-testid={testId}>
      {/* STATUS */}
      <RailSection
        label="Status"
        summary={statusLabel}
        expanded={statusOpen}
        onToggle={setStatusOpen}
        testId={`${testId}-status`}
      >
        <div className="flex flex-col gap-2.5">
          <StatusBadge label={statusLabel} tone={statusTone} testId={`${testId}-status-badge`} />
          <NativeSelect
            value={statusValue}
            disabled={!mayEdit || isArchived}
            onChange={handleStatusChange}
            data-testid={`${testId}-status-select`}
          >
            <option value="available">Available</option>
            <option value="hidden">Hidden</option>
            <option value="archived">Archived</option>
          </NativeSelect>
          {isArchived && <p className="text-meta text-mute">Restore it from the banner above to change this.</p>}
          {doorsError && <InlineValidation message={doorsError.message} requestId={doorsError.requestId} />}
        </div>
      </RailSection>

      {/* WHO CAN BOOK IT */}
      <RailSection
        label="Who can book it"
        summary={null}
        expanded={doorsOpen}
        onToggle={setDoorsOpen}
        testId={`${testId}-doors`}
      >
        <div className="flex flex-col gap-3">
          <p className="text-meta text-mute">{doorsSummary}</p>
          <div className="flex items-center justify-between gap-2">
            <span className="text-meta text-ink">You and your team</span>
            <Switch
              checked={item.bookable === true}
              disabled={!mayEdit || doorsBusy}
              onCheckedChange={(v) => handleToggleDoor(v)}
              data-testid={`${testId}-door-team`}
            />
          </div>
          <DisabledWithReason
            disabled={true}
            reason="Changing this door on a saved service isn't wired to a save yet."
            testId={`${testId}-door-portal`}
          >
            {({ disabled, describedBy }) => (
              <div className="flex items-center justify-between gap-2">
                <span className="text-meta text-ink">Clients, from their portal</span>
                <Switch checked={item.portal_bookable === true} disabled={disabled} aria-describedby={describedBy} />
              </div>
            )}
          </DisabledWithReason>
          <DisabledWithReason
            disabled={true}
            reason="Changing this door on a saved service isn't wired to a save yet."
            testId={`${testId}-door-public`}
          >
            {({ disabled, describedBy }) => (
              <div className="flex flex-col gap-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-meta text-ink">
                    Anyone, from your booking page
                  </span>
                  <Switch checked={item.public_bookable === true} disabled={disabled} aria-describedby={describedBy} />
                </div>
                <span className="text-meta text-mute">Strangers can book without an account.</span>
              </div>
            )}
          </DisabledWithReason>
          {doorsError && <InlineValidation message={doorsError.message} requestId={doorsError.requestId} />}
        </div>
      </RailSection>

      {/* PAYING */}
      <RailSection
        label="Paying"
        summary={payingSummary}
        expanded={payingOpen}
        onToggle={setPayingOpen}
        testId={`${testId}-paying`}
      >
        <div className="flex flex-col gap-2.5">
          <p className="text-meta text-mute">{payingSummary}</p>
          {payingOverridden && (
            <RailOverrideNote
              defaultPhrase={payingDefaultPhrase}
              onRevert={() => onRevertOverride({ row: "paying" })}
              testId={`${testId}-paying-override`}
            />
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!mayEdit}
            onClick={() => setPaymentModalOpen(true)}
            data-testid={`${testId}-paying-change`}
          >
            Change
          </Button>
        </div>
      </RailSection>

      {/* CANCELLING */}
      <RailSection
        label="Cancelling"
        summary={cancellingSummary}
        expanded={cancellingOpen}
        onToggle={setCancellingOpen}
        testId={`${testId}-cancelling`}
      >
        <div className="flex flex-col gap-2.5">
          <p className="text-meta text-mute">{cancellingSummary}</p>
          {cancellingOverridden && (
            <RailOverrideNote
              defaultPhrase={cancellingDefaultPhrase}
              onRevert={() => onRevertOverride({ row: "cancelling" })}
              testId={`${testId}-cancelling-override`}
            />
          )}
        </div>
      </RailSection>

      {/* WHERE IT SHOWS UP */}
      <RailSection
        label="Where it shows up"
        summary={null}
        expanded={shownOpen}
        onToggle={setShownOpen}
        testId={`${testId}-shown`}
      >
        <div className="flex flex-col gap-2.5">
          <p className="text-meta text-mute">{channelsSummary}</p>
          <p className="text-meta text-mute opacity-55">Reserve with Google — connect Google to turn this on</p>
        </div>
      </RailSection>

      {/* STRIPE */}
      <RailSection
        label="Stripe"
        summary={stripeLabel}
        expanded={stripeOpen}
        onToggle={setStripeOpen}
        testId={`${testId}-stripe`}
      >
        <StatusBadge label={stripeLabel} tone={stripeTone} testId={`${testId}-stripe-badge`} />
      </RailSection>

      {/* PAYMENT MODAL */}
      <ServiceEditorRailPaymentModal
        open={paymentModalOpen}
        onOpenChange={setPaymentModalOpen}
        testId={`${testId}-payment-modal`}
        item={item}
        stripeLive={stripeLive}
        PAYMENT_OPTIONS={PAYMENT_OPTIONS}
        selectedMode={selectedMode}
        paymentBusy={paymentBusy}
        paymentError={paymentError}
        handleConfirmPaymentPolicy={handleConfirmPaymentPolicy}
      />
    </div>
  );
}
