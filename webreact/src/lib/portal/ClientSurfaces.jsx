// ═══════════════════════════════════════════════════════════════════════════════════════════════
// S5.1–S5.8 (+ C2.6 messages, 24 Sep 2026) — THE NINE CLIENT-PORTAL SURFACES, IN ONE COMPONENT.
//
// ★★★ ONE COMPONENT AND NOT NINE, FOR THE REASON §K GIVES: *"DO NOT FORK A PORTAL TO EXPRESS A
//     PERMISSION DIFFERENCE — that is how four portals became five surfaces and 160 routes last
//     time."* Eight files would be eight places for a role check to creep in. The surface key
//     selects a BRANCH; it never selects a component tree.
//
// ★★★ AND THE EMPTY STATES HERE ARE NOT THE COACH'S. [SPEC, RULED] *"A client's empty state is not
//     a coach`s; these do not share copy."* A coach`s "No sessions yet" is a gap in their book; a
//     client's is *"nothing is booked for you"* — and the client cannot fix it by adding a row,
//     so a create action would be a dead end. **Every empty below speaks to the person reading it,
//     and none of them offers a control a client does not have.**
//
// ★★ THE DATA ARRIVES ALREADY ACCESS-FILTERED. `/api/app/**` serves only the eight keys and
//    Postgres decides what those reads can see at all. Nothing here filters; filtering here would
//    be a second opinion on a question the database already answered.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useMemo, useState } from "react";
import { formatValue } from "@/lib/format.js";
import { term } from "@/lib/terminology/terms.js";
import { Alert, AlertDescription } from "@/lib/components/ui/alert";
import { DocumentSigning, PortalDocuments } from "@/lib/documents/index.js";
import PortalSessions from "./PortalSessions.jsx";
import PortalBooking from "./PortalBooking.jsx";
import PortalMoney from "./PortalMoney.jsx";
import PortalProfile from "./PortalProfile.jsx";
import PortalMessages from "./PortalMessages.jsx";

export default function ClientSurfaces({ surface, data = null, role = null, terms = {} }) {
  const [signingDocumentId, setSigningDocumentId] = useState(null);

  // Derive rows from data
  const rows = useMemo(() => {
    if (Array.isArray(data?.rows)) return data.rows;
    return [];
  }, [data]);

  // ★ The word a practice uses, ALREADY RESOLVED BY THE SERVER. §KS-17: one resolver, server-side.
  //  A hook here would be a SECOND resolver, and the worker that composes a push notification has no
  //  component to run it in — so the two would diverge the first time a practice renamed anything.
  const wordResolver = (key, fallback) => term(key) ?? terms?.[key] ?? fallback;

  // ★★ Nine surfaces (eight at launch + messages, 24 Sep 2026), nine sentences. Written for the
  //  PERSON, not for the operator.
  const EMPTY = useMemo(() => ({
    "working-on": {
      testId: "working-on-empty",
      text: `Nothing is set as your focus yet. Your ${wordResolver("userType.coach", "coach")} sets this, and it appears here when they do.`,
    },
    sessions: {
      testId: "sessions-empty",
      text: "No sessions yet. When one is booked for you it appears here, with the time and where to go.",
    },
    "app-documents": {
      testId: "documents-empty",
      text: "Nothing to read or sign. Anything your practice sends you shows up here, and stays here after you have signed it.",
    },
    activity: {
      testId: "activity-empty",
      text: "Nothing has happened yet. This is a record of your sessions and documents as they go along.",
    },
    booking: {
      testId: "booking-empty",
      text: "No times are free at the moment. Your practice opens times as they become available — check back, or contact them.",
    },
    payments: {
      testId: "payments-empty",
      text: "Nothing to pay. Invoices and receipts appear here as they are raised.",
    },
    notifications: {
      testId: "notifications-empty",
      text: "Nothing new. Reminders and messages from your practice arrive here.",
    },
    profile: {
      testId: "profile-empty",
      text: "We do not hold any details for you yet. Your practice fills these in.",
    },
    // ★ ADDED (coordinator, checkpoint, 24 Sep 2026): `messages` (C2.6, authorized). Unused in
    //   practice — `PortalMessages.svelte` owns its own empty state — kept for symmetry with the
    //   other dedicated-component surfaces above, which all keep an entry here too.
    messages: {
      testId: "messages-empty",
      text: "No messages yet. Messages from your practice will appear here.",
    },
  }), [wordResolver]);

  const empty = useMemo(() => EMPTY[surface] ?? { testId: "surface-empty", text: "Nothing here yet." }, [EMPTY, surface]);

  const titleOf = useMemo(() => ({
    "working-on": "What you are working on",
    sessions: "Your sessions",
    "app-documents": "Your documents",
    activity: "Your activity",
    booking: "Book a session",
    payments: "Payments",
    notifications: "Notifications",
    profile: "Your details",
    messages: "Messages",
  }), []);

  // Show coach notes message only for certain surfaces
  const shouldShowCoachNotesLocked = useMemo(() => {
    const excludeSurfaces = ["sessions", "booking", "profile", "app-documents", "payments", "notifications", "messages"];
    return surface && !excludeSurfaces.includes(surface) && rows.length > 0;
  }, [surface, rows.length]);

  return (
    <section
      className="flex flex-col gap-4 p-4"
      data-testid={`surface-${surface}`}
      data-surface={surface}
      data-role={role}
    >
      <h1 className="text-base font-medium text-[var(--color-structure-900)]">{titleOf[surface] ?? surface}</h1>

      {data?.error ? (
        // ★ The SERVER's own message. A client is the one reader least able to describe a failure, so
        //   the sentence they can quote matters more here than anywhere.
        <Alert variant="destructive">
          <AlertDescription data-testid={`${surface}-error`}>
            {data.error}
          </AlertDescription>
        </Alert>
      ) : surface === "profile" ? (
        // ★★★ PROFILE SURFACE WITH EDITABLE CONTACT DETAILS AND PREFERENCES. Uses dedicated component.
        <PortalProfile data={data} role={role} terms={terms} />
      ) : surface === "sessions" ? (
        // ★★★ C2.2 — SESSIONS SURFACE WITH CANCEL/RESCHEDULE. Uses dedicated component.
        <PortalSessions data={data} role={role} terms={terms} />
      ) : surface === "booking" ? (
        // ★★★ C2.1 — BOOKING SURFACE. Uses dedicated component.
        <PortalBooking data={data} role={role} terms={terms} />
      ) : surface === "payments" ? (
        // ★★★ PAYMENTS SURFACE. Uses dedicated component.
        <PortalMoney data={data} terms={terms} />
      ) : surface === "messages" ? (
        // ★★★ C2.6 — MESSAGES SURFACE (authorized 24 Sep 2026). Uses dedicated component.
        // ★ FIX (coordinator, checkpoint, 24 Sep 2026): this branch checked `surface === "notifications"`
        //   — which never matched anything (the real `SURFACES` key is `app-notifications`, and
        //   `messages` didn't exist as a surface at all yet) — so PortalMessages never rendered.
        <PortalMessages data={data} role={role} terms={terms} />
      ) : surface === "app-documents" ? (
        // ★★★ DOCUMENTS SURFACE. Uses dedicated component.
        signingDocumentId ? (
          <DocumentSigning
            documentId={signingDocumentId}
            onClose={() => {
              setSigningDocumentId(null);
            }}
          />
        ) : (
          <PortalDocuments
            data={data}
            onSigningDocumentChange={(docId) => {
              setSigningDocumentId(docId);
            }}
          />
        )
      ) : rows.length === 0 ? (
        // ★★★ THE CLIENT'S OWN WORDS, AND NO CREATE ACTION. A client cannot add a session, an invoice
        //     or a document to their own account — offering a button would be the dead end the empty-state
        //     spec is written against, on the audience least able to work around it.
        <p className="text-sm text-[var(--color-structure-600)]" data-testid={empty.testId}>
          {empty.text}
        </p>
      ) : (
        // ★★ GENERIC LIST FALLBACK for surfaces like "working-on" and "activity"
        <>
          <ul className="flex flex-col gap-0">
            {rows.map((row, i) => (
              <li
                key={row.id ?? i}
                className="flex flex-col gap-1 py-3 px-0 border-b-[1px] border-b-[var(--color-structure-150)] last:border-b-0"
                data-testid={`${surface}-row`}
                data-id={row.id}
              >
                <span className="text-sm font-medium text-[var(--color-structure-900)]">
                  {row.title ?? row.name ?? row.label ?? "—"}
                </span>
                {(row.subtitle ?? row.service_name ?? row.state) && (
                  <span className="text-xs text-[var(--color-structure-600)]">
                    {row.subtitle ?? row.service_name ?? row.state}
                  </span>
                )}
                {(row.starts_at ?? row.created_at ?? row.sent_at) && (
                  <span className="text-xs text-[var(--color-structure-600)]">
                    {formatValue(row.starts_at ?? row.created_at ?? row.sent_at, "datetime", { empty: "—" })}
                  </span>
                )}
                {typeof row.amount_minor === "number" && (
                  <span className="text-xs text-[var(--color-structure-600)]">
                    {formatValue(row.amount_minor, "money", { empty: "—", currency: row.currency })}
                  </span>
                )}
                {row.attended === true && (
                  <span className="inline-block w-fit rounded-full px-2 py-1 text-xs bg-[var(--color-success-50)] text-[var(--color-success-700)]">
                    Attended
                  </span>
                )}
              </li>
            ))}
          </ul>

          {/* ═══════════════════════════════════════════════════════════════════════════════════════════
             ★★★ COACH NOTES ARE NEVER SHOWN HERE, AND IT IS SAID RATHER THAN SILENTLY OMITTED. A session
                 row a client can see may have notes they cannot, and a surface that simply left them out
                 would look complete. Saying `your coach keeps notes and they are not shown to you` is the
                 honest rendering, and it is the same distinction as denied-vs-empty one layer in.
          ═══════════════════════════════════════════════════════════════════════════════════════════ */}
          {shouldShowCoachNotesLocked && (
            <p className="text-sm text-[var(--color-structure-600)] mt-4" data-testid="coach-notes-locked">
              Your {wordResolver("userType.coach", "coach")} keeps their own notes on these sessions. Those are not
              shown here.
            </p>
          )}
        </>
      )}
    </section>
  );
}
