// ═══════════════════════════════════════════════════════════════════════════════════════════════
// 18.26 — PERSON RECORD (AppStaffRecord, PhoneRecord)
//
// ★★★ THE COACH'S PERSON RECORD VIEW AT PHONE WIDTH. Displays:
//     · Header with name, "Client since {Month} · {payer line}"
//     · Three action buttons: Book, Message, Get paid
//     · Money prompt from CT-F01
//     · Block/entitlement figure with progress meter (CT-F03)
//     · Next upcoming booking
//     · Last three notes with date and lead
//     · Documents with signing status
//     · Who else is on the account (household members)
//
// ★★ EACH SECTION LOADS AND FAILS INDEPENDENTLY — ErrorPanel for section failures.
//     When data is not available, section says "None yet".
//
// ★ Built from `specs/mockups/AppStaffRecord.frame.html`.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

import { useMemo } from "react";
import PhoneCard from "@/lib/phone/PhoneCard.jsx";
import Figure from "@/lib/components/kit/Figure.jsx";
import ErrorPanel from "@/lib/empty/ErrorPanel.jsx";
import ScreenState from "@/lib/empty/ScreenState.jsx";

const TONE_MAP = {
  warning: "warm",
  danger: "bad",
  plain: "plain",
};

export default function StaffRecord({
  data = null,
  promptsError = null,
  notesError = null,
  documentsError = null,
  householdError = null,
  onRetryPrompts = null,
  onRetryNotes = null,
  onRetryDocuments = null,
  onRetryHousehold = null,
  onBook = null,
  onMessage = null,
  onGetPaid = null,
}) {
  // Format currency
  const formatCurrency = (amount) => {
    if (amount === null || amount === undefined) return null;
    return (amount / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
  };

  // Format date to "Mon DD"
  const formatDateShort = (iso) => {
    if (!iso) return "—";
    try {
      const date = new Date(iso);
      const day = date.toLocaleDateString(undefined, { weekday: "short" });
      const numDay = date.getDate();
      return `${day} ${numDay}`;
    } catch {
      return "—";
    }
  };

  // Format date to "DD Mon"
  const formatDateMed = (iso) => {
    if (!iso) return "—";
    try {
      const date = new Date(iso);
      return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    } catch {
      return "—";
    }
  };

  // Derived values
  const derived = useMemo(() => {
    const isLoading = data === null;
    const personName = data?.name ?? data?.display_name ?? "Unknown";

    let clientSinceLine = "Unknown · Unknown";
    if (data?.joined_at) {
      try {
        const date = new Date(data.joined_at);
        const month = date.toLocaleDateString(undefined, { month: "long" });
        const payerLine = data.payer_line ?? "the family pays";
        clientSinceLine = `Client since ${month} · ${payerLine}`;
      } catch {
        // keep default
      }
    }

    const isArchived = !!data?.archived_at;
    const prompts = (data?.prompts?.items ?? []).slice(0, 1);
    const notes = (data?.notes ?? []).slice(0, 3);
    const documents = (data?.documents ?? []).slice(0, 10);
    const household = (data?.household ?? []).slice(0, 10);
    const entitlement = data?.entitlement ?? null;

    const blockPercent = (() => {
      if (!entitlement) return 0;
      if (!entitlement.credits_total) return 0;
      return Math.round((entitlement.credits_remaining / entitlement.credits_total) * 100);
    })();

    const nextBooking = data?.next_booking ?? null;

    return {
      isLoading,
      personName,
      clientSinceLine,
      isArchived,
      prompts,
      notes,
      documents,
      household,
      entitlement,
      blockPercent,
      nextBooking,
    };
  }, [data]);

  if (derived.isLoading) {
    return <ScreenState phase="loading" />;
  }

  return (
    <div className="px-[18px] pb-[22px] pt-[2px]">
      {derived.isArchived && (
        <div className="rounded-[8px] bg-warn-soft px-3 py-2.5 mb-3 text-caption text-warn leading-relaxed">
          Read-only: this person is archived.
        </div>
      )}

      <div className="pb-[14px] pt-1">
        <Figure as="h1" size="md" className="m-0 leading-[1.05] tracking-[-0.02em]">
          {derived.personName}
        </Figure>
        <p className="m-0 mt-1.5 text-[13.5px] leading-[1.5] text-mute">
          {derived.clientSinceLine}
        </p>
      </div>

      <div className="flex gap-2 mb-[14px]">
        <button
          className="flex-1 h-8 px-3.25 rounded-[7px] border border-line bg-surface text-ink-2 text-[13px] font-medium"
          onClick={onBook}
        >
          Book
        </button>
        <button
          className="flex-1 h-8 px-3.25 rounded-[7px] border border-line bg-surface text-ink-2 text-[13px] font-medium"
          onClick={onMessage}
        >
          Message
        </button>
        <button
          className="flex-1 h-8 px-3.25 rounded-[7px] border border-brand bg-brand text-white text-[13px] font-medium"
          onClick={onGetPaid}
        >
          Get paid
        </button>
      </div>

      {promptsError ? (
        <ErrorPanel
          error={promptsError}
          variant="band"
          testId="prompts-error"
          onRetry={onRetryPrompts}
        />
      ) : derived.prompts.length > 0 ? (
        derived.prompts.map((prompt) => (
          <PhoneCard
            key={prompt.id || prompt.headline}
            variant={TONE_MAP[prompt.tone] ?? "plain"}
            label={prompt.headline}
          >
            <p className="m-0 mt-1.5 text-[13px] leading-[1.55] text-mute">
              {prompt.why}
            </p>
            <div className="flex gap-2 mt-[13px]">
              {(prompt.actions ?? []).slice(0, 2).map((action, idx) => (
                <button
                  key={idx}
                  className="flex-1 h-8 px-3.25 rounded-[7px] border border-brand bg-brand text-white text-[13px] font-medium"
                >
                  {action.label}
                </button>
              ))}
            </div>
          </PhoneCard>
        ))
      ) : null}

      {derived.entitlement && (
        <PhoneCard variant="plain">
          <div className="flex items-center gap-3">
            <Figure size="sm" className="flex-shrink-0">
              {derived.entitlement.credits_remaining}
            </Figure>
            <span className="text-[13px] leading-[1.5] text-mute">
              sessions left of {derived.entitlement.credits_total}
              <br />
              expiring{" "}
              {new Date(derived.entitlement.expires_at).toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
              })}
            </span>
          </div>
          <div className="h-[7px] rounded-full bg-mute-bg overflow-hidden mt-[11px]">
            <div
              className="h-full bg-brand"
              style={{ width: `${derived.blockPercent}%` }}
            />
          </div>
        </PhoneCard>
      )}

      {derived.nextBooking && (
        <>
          <h3 className="m-0 mt-[18px] mb-1.5 font-medium text-[12.5px] text-mute">
            Next
          </h3>
          <div className="flex gap-3 py-[13px] border-b border-hair">
            <div className="flex-shrink-0 w-[54px] font-variant-numeric text-[12.5px] text-mute leading-[1.4]">
              <strong className="block text-[13.5px] font-medium text-ink">
                {derived.nextBooking.day_of_week}
              </strong>
              {derived.nextBooking.date_short}
            </div>
            <div className="flex-1 text-[14px] leading-[1.45]">
              <div>{derived.nextBooking.service_type}</div>
              <span className="text-[12.5px] text-mute leading-[1.45]">
                {derived.nextBooking.time} · {derived.nextBooking.location}
              </span>
            </div>
          </div>
        </>
      )}

      <h3 className="m-0 mt-[18px] mb-1.5 font-medium text-[12.5px] text-mute">
        Notes
      </h3>
      {notesError ? (
        <ErrorPanel
          error={notesError}
          variant="band"
          testId="notes-error"
          onRetry={onRetryNotes}
        />
      ) : derived.notes.length === 0 ? (
        <div className="flex gap-3 py-[13px] border-b border-hair">
          <div className="flex-shrink-0 w-[54px]" />
          <div className="flex-1 text-[14px]">None yet</div>
        </div>
      ) : (
        derived.notes.map((note, idx) => (
          <div
            key={idx}
            className={`flex gap-3 py-[13px] ${idx < derived.notes.length - 1 ? "border-b border-hair" : ""}`}
          >
            <div className="flex-shrink-0 w-[54px] font-variant-numeric text-[12.5px] text-mute leading-[1.4]">
              {formatDateMed(note.created_at)}
            </div>
            <div className="flex-1">
              <div className="text-[14px] leading-[1.45]">{note.title}</div>
              <span className="block text-[12.5px] text-mute leading-[1.45] mt-0.75">
                {note.summary}
              </span>
            </div>
          </div>
        ))
      )}

      <h3 className="m-0 mt-[18px] mb-1.5 font-medium text-[12.5px] text-mute">
        Documents
      </h3>
      {documentsError ? (
        <ErrorPanel
          error={documentsError}
          variant="band"
          testId="documents-error"
          onRetry={onRetryDocuments}
        />
      ) : derived.documents.length === 0 ? (
        <div className="flex gap-3 py-[13px] border-b border-hair">
          <div className="flex-shrink-0 w-[54px]" />
          <div className="flex-1 text-[14px]">None yet</div>
        </div>
      ) : (
        derived.documents.map((doc, idx) => (
          <div
            key={idx}
            className={`flex gap-3 py-[13px] items-flex-start ${
              idx < derived.documents.length - 1 ? "border-b border-hair" : ""
            }`}
          >
            <div className="flex-shrink-0 w-[54px] text-[12.5px] text-mute leading-[1.4]">
              ✓
            </div>
            <div className="flex-1">
              <div className="text-[14px] leading-[1.45]">{doc.title}</div>
              <span className="block text-[12.5px] text-mute leading-[1.45] mt-0.75">
                {doc.status_text}
              </span>
            </div>
            <span
              className={`inline-flex items-center h-[21px] px-2.25 rounded-[5px] text-[12px] font-medium flex-shrink-0 ${
                doc.state === "signed"
                  ? "bg-ok-soft text-ok"
                  : doc.state === "sent"
                    ? "bg-warn-soft text-warn"
                    : "bg-mute-bg text-mute"
              }`}
            >
              {doc.state === "signed"
                ? "Signed"
                : doc.state === "sent"
                  ? "Sent"
                  : doc.state === "draft"
                    ? "Draft"
                    : doc.state}
            </span>
          </div>
        ))
      )}

      <h3 className="m-0 mt-[18px] mb-1.5 font-medium text-[12.5px] text-mute">
        Who else is on the account
      </h3>
      {householdError ? (
        <ErrorPanel
          error={householdError}
          variant="band"
          testId="household-error"
          onRetry={onRetryHousehold}
        />
      ) : derived.household.length === 0 ? (
        <div className="flex gap-3 py-[13px] border-b border-hair">
          <div className="flex-shrink-0 w-[54px]" />
          <div className="flex-1 text-[14px]">None yet</div>
        </div>
      ) : (
        derived.household.map((member, idx) => (
          <div
            key={idx}
            className={`flex gap-3 py-[13px] ${
              idx < derived.household.length - 1 ? "border-b border-hair" : ""
            }`}
          >
            <div className="flex-shrink-0 text-[12px] text-mute leading-[1.4] min-w-[24px]">
              {member.initials}
            </div>
            <div className="flex-1">
              <div className="text-[14px] leading-[1.45]">{member.display_name}</div>
              <span className="block text-[12.5px] text-mute leading-[1.45] mt-0.75">
                {member.relationship_text}
              </span>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
