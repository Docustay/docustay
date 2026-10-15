import { useState, useEffect } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/lib/components/ui/tabs.jsx";
import { Avatar, AvatarFallback } from "@/lib/components/ui/avatar.jsx";
import { Button } from "@/lib/components/ui/button.jsx";
import PromptCard from "@/lib/prompts/PromptCard.jsx";
import StatusBadge from "@/lib/components/kit/StatusBadge.jsx";
import ScreenState from "@/lib/empty/ScreenState.jsx";
import EmptyState from "@/lib/empty/EmptyState.jsx";
import DisabledWithReason from "@/lib/forms/DisabledWithReason.jsx";
import PersonActions from "./PersonActions.jsx";
import PersonOverview from "./PersonOverview.jsx";
import MemberPermissions from "../screens/people/MemberPermissions.jsx";
import PersonMoneyTab from "./PersonMoneyTab.jsx";
import { PersonDocumentsTab } from "@/lib/documents/index.js";
import PersonSessionsNotesTabs from "./PersonSessionsNotesTabs.jsx";
import PersonGoalsTab from "./PersonGoalsTab.jsx";
import BookSessionDialog from "@/lib/shell/BookSessionDialog.jsx";
import { api, ApiError } from "@/lib/api.js";
import ProgramPicker from "@/lib/programs/ProgramPicker.jsx";
import { ProgramChips } from "@/lib/programs/ProgramChip.jsx";
import { refreshPrograms } from "@/lib/programs/programs.js";
import { mayArchive } from "./archive.js";
import { DeleteButton } from "./DeleteDialog.jsx";
import { deleteTypeForRecord } from "./deleteTypes.js";

// The person's programs: chips + an inline editor (ProgramPicker) that SETs the list through POST /api/people/programs.
function PersonPrograms({ personId, editable = true }) {
  const [ids, setIds] = useState(null);
  const [draft, setDraft] = useState([]);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  useEffect(() => {
    if (!personId) return undefined;
    let live = true;
    api.getPersonPrograms(personId).then((r) => { if (live) setIds((r?.data ?? []).map((p) => p.id)); }).catch(() => { if (live) setIds([]); });
    return () => { live = false; };
  }, [personId]);
  if (!personId || ids === null) return null;
  async function save() {
    setBusy(true); setError(null);
    try {
      await api.setPersonPrograms({ personId, programIds: draft });
      setIds(draft); setEditing(false); refreshPrograms();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err?.message ?? err));
    } finally { setBusy(false); }
  }
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2" data-testid="person-record-programs">
      {editing ? (
        <>
          <ProgramPicker value={draft} onChange={setDraft} disabled={busy} testId="person-record-program-picker" />
          <Button size="sm" onClick={save} disabled={busy} data-testid="person-record-programs-save">{busy ? "Saving…" : "Save"}</Button>
          <Button size="sm" variant="outline" onClick={() => { setEditing(false); setError(null); }} disabled={busy} data-testid="person-record-programs-cancel">Cancel</Button>
          {error && <span className="text-meta text-bad" role="alert" data-testid="person-record-programs-error">{error}</span>}
        </>
      ) : (
        <>
          <span className="text-meta text-mute">Programs</span>
          <ProgramChips ids={ids} testId="person-record-program-chips" />
          {editable && <Button size="sm" variant="outline" onClick={() => { setDraft(ids); setEditing(true); }} data-testid="person-record-programs-edit">Edit</Button>}
        </>
      )}
    </div>
  );
}

export default function PersonRecord({
  data = null,
  personId,
  rank = null,
  onNavigate = null,
  onDone = null,
}) {
  const [prompts, setPrompts] = useState([]);
  const [promptsError, setPromptsError] = useState(null);
  const [bookOpen, setBookOpen] = useState(false);
  const [restoreBusy, setRestoreBusy] = useState(false);
  const [restoreError, setRestoreError] = useState(null);
  const [activeTab, setActiveTab] = useState("overview");

  const tabs = data?.personTabs ?? null;
  const shell = data?.shell ?? null;
  const variant = tabs?.variant ?? "full";

  useEffect(() => {
    if (data && !personId) {
      throw new Error(
        "PersonRecord: personId is required — none of data.shell or data.personTabs carries the " +
          "record's own id, so every control on this page (PersonActions, Book, Get paid, the " +
          "prompts fetch, Bring them back) needs it supplied directly."
      );
    }
  }, [data, personId]);

  const words = String(shell?.header?.title ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const initials = words
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "") || "·";

  const person = personId
    ? {
        id: personId,
        display_name: shell?.header?.title ?? null,
        email: shell?.fields?.email ?? null,
        role: shell?.fields?.role ?? null,
        staff_role: shell?.fields?.staff_role ?? null,
        lifecycle_status: shell?.fields?.lifecycle_status ?? null,
        firebase_uid: shell?.fields?.firebase_uid ?? null,
        // ★ the maintainer, 29 Sep 2026 — the portal-invite control's two facts (see shell.mjs's CONTROL_KEYS).
        portal_status: shell?.fields?.portal_status ?? null,
        has_parent_linked: shell?.fields?.has_parent_linked ?? false,
      }
    : null;

  function fmtDayMonth(value, opts = {}) {
    if (!value) return null;
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", ...opts });
  }

  function fmtMonth(value) {
    if (!value) return null;
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleDateString("en-GB", { month: "long" });
  }

  function fmtWeekday(value) {
    if (!value) return null;
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleDateString("en-GB", { weekday: "long" });
  }

  function getFactLine() {
    if (!tabs) return "";
    if (variant === "archived") {
      const a = tabs.archived;
      if (!a) return "";
      const parts = [
        a.archivedByName
          ? `Archived by ${a.archivedByName}${
              a.archivedAt ? ` on ${fmtDayMonth(a.archivedAt)}` : ""
            }`
          : null,
        a.stats?.firstAt || a.stats?.lastAt
          ? `client from ${fmtMonth(a.stats.firstAt) ?? "—"} to ${
              fmtMonth(a.stats.lastAt) ?? "—"
            }`
          : null,
      ].filter(Boolean);
      return parts.join(" · ");
    }
    if (variant === "new") {
      const parts = [
        tabs.factLine?.clientSince ? `Added ${fmtWeekday(tabs.factLine.clientSince)}` : null,
        "hasn't been in yet",
        tabs.foundThrough?.partyName || tabs.foundThrough?.referredByName
          ? `came from ${
              tabs.foundThrough.partyName ?? tabs.foundThrough.referredByName
            }`
          : null,
      ].filter(Boolean);
      return parts.join(" · ");
    }
    if (variant === "teen") {
      const guardian = tabs.teen?.guardians?.[0] ?? null;
      const parts = [
        tabs.teen?.age != null ? String(tabs.teen.age) : null,
        tabs.factLine?.clientSince ? `client since ${fmtMonth(tabs.factLine.clientSince)}` : null,
        tabs.factLine?.payerName ? `the ${tabs.factLine.payerName} pays` : null,
        guardian
          ? `${guardian.name} is their ${guardian.relationship ?? "guardian"}`
          : null,
      ].filter(Boolean);
      return parts.join(" · ");
    }
    // full (and coach-rank over full)
    const parts = [
      tabs.factLine?.clientSince ? `Client since ${fmtDayMonth(tabs.factLine.clientSince)}` : null,
      tabs.factLine?.payerName ? `the ${tabs.factLine.payerName} pays` : null,
      tabs.factLine?.cadence ? `comes ${tabs.factLine.cadence}` : null,
    ].filter(Boolean);
    return parts.join(" · ");
  }

  const factLine = getFactLine();

  async function loadPrompts() {
    if (!personId) return;
    try {
      const r = await api.prompts("person", personId);
      setPrompts((r?.prompts ?? []).slice(0, 3));
      setPromptsError(null);
    } catch (err) {
      setPromptsError(err);
    }
  }

  useEffect(() => {
    if (personId) loadPrompts();
  }, [personId]);

  async function dismissPrompt(p) {
    try {
      await api.dismissPrompt(p.kind, p.subjectId);
      setPrompts((prev) => prev.filter((q) => q.fingerprint !== p.fingerprint));
    } catch {
      // A failed dismiss leaves the card exactly where it was
    }
  }

  const bookLabel = variant === "new" ? "Book him in" : "Book";

  function openGetPaid() {
    if (!personId) return;
    onNavigate?.(
      `/money/invoices?new=1&for=${encodeURIComponent(personId)}`
    );
  }

  async function bringThemBack() {
    if (!personId || restoreBusy) return;
    setRestoreBusy(true);
    setRestoreError(null);
    try {
      await api.restoreRecord({ object: "person", id: personId });
      onDone?.();
    } catch (err) {
      setRestoreError(
        err instanceof ApiError ? err.message : String(err?.message ?? err)
      );
    } finally {
      setRestoreBusy(false);
    }
  }

  const payerName =
    tabs?.whoPays?.contact?.name ?? tabs?.whoPays?.group?.name ?? null;

  function stateLabel(state) {
    if (!state) return "";
    return state.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  }

  function chipTone(state) {
    if (state === "cancelled" || state === "declined" || state === "no_show") return "bad";
    if (state === "confirmed" || state === "signed") return "ok";
    if (state === "sent" || state === "pending") return "warn";
    return "neutral";
  }

  if (!data) {
    return <ScreenState phase="loading" />;
  }

  return (
    <article
      data-testid="person-record"
      data-variant={variant}
    >
      {/* HEADER */}
      {/* ★ the maintainer, 29 Sep 2026 — the name/avatar and the action-button group are now separate ROWS,
          not flex siblings. A full action set (Message + its always-on DisabledWithReason text +
          Book + Get paid + PersonActions' stage/portal/tags/merge controls) is wider than one row
          on anything but a very wide screen — sharing a row with the name meant the name/fact-line
          span (flex-1, min-w-0) was the thing squeezed to make room, collapsing to near-zero width
          and wrapping the name and fact line one WORD per line. Splitting them means the actions can
          wrap freely on their own row without the name ever competing with them for width. */}
      <header className="mb-5.5 flex flex-col gap-2.5" data-testid="person-record-header">
        <div className="flex items-start gap-4.5">
          <Avatar className="size-14">
            <AvatarFallback className="text-[19px] font-semibold bg-avatar-bg text-avatar-ink">
              {initials}
            </AvatarFallback>
          </Avatar>
          <span className="min-w-0 flex-1">
            <h1 className="m-0 text-page-title font-medium tracking-[-0.01em] text-ink" data-testid="person-record-title">
              {shell?.header?.title ?? "Untitled person"}
            </h1>
            <div className="mt-1.5 text-control text-mute" data-testid="person-record-factline">
              {factLine}
            </div>
            <PersonPrograms personId={personId} editable={variant !== "archived"} />
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {variant === "archived" ? (
            <>
              <Button
                data-testid="person-record-bring-back"
                disabled={!mayArchive(rank) || restoreBusy}
                onClick={bringThemBack}
              >
                {restoreBusy ? "Working…" : "Bring them back"}
              </Button>
              {restoreError && (
                <p
                  className="text-meta text-bad"
                  role="alert"
                  data-testid="person-record-restore-error"
                >
                  {restoreError}
                </p>
              )}
            </>
          ) : (
            <>
              <DisabledWithReason
                disabled
                reason="Messages arrive with the app"
                testId="person-record-message"
              >
                {({ disabled, describedBy }) => (
                  <Button
                    variant="outline"
                    disabled={disabled}
                    aria-describedby={describedBy}
                    data-testid="person-record-message-btn"
                  >
                    Message
                  </Button>
                )}
              </DisabledWithReason>

              <Button
                variant="outline"
                data-testid="person-record-book"
                onClick={() => setBookOpen(true)}
              >
                {bookLabel}
              </Button>

              {tabs?.money && (
                <Button
                  data-testid="person-record-get-paid"
                  onClick={openGetPaid}
                >
                  Get paid
                </Button>
              )}

              {person && (
                <PersonActions
                  person={person}
                  rank={rank}
                  onDone={() => onDone?.()}
                />
              )}
            </>
          )}
          {/* the shared page Delete (Owner/Admin only — gated inside DeleteButton); staff rows are type team_member */}
          {personId && (() => {
            const deleteType = deleteTypeForRecord("person", shell?.role ?? shell?.fields?.role ?? null);
            return (
              <DeleteButton type={deleteType} id={personId} label={shell?.header?.title ?? null} rank={rank}
                onDone={() => onNavigate?.(deleteType === "team_member" ? "/people/team" : "/people/active")} />
            );
          })()}
        </div>
      </header>

      <BookSessionDialog
        open={bookOpen}
        onOpenChange={setBookOpen}
        label={bookLabel}
        onBooked={() => onDone?.()}
      />

      {/* PROMPTS BAND */}
      {prompts.length > 0 && (
        <div className="mb-7.5 flex flex-col gap-2.5" data-testid="person-record-prompts">
          {prompts.map((p) => (
            <PromptCard
              key={p.fingerprint}
              icon={p.icon}
              tone={p.tone}
              headline={p.headline}
              why={p.why}
              action={p.action}
              kind={p.kind}
              onDismiss={() => dismissPrompt(p)}
              testId={`person-record-prompt-${p.fingerprint}`}
            />
          ))}
        </div>
      )}

      {/* TEEN BOUNDARY NOTICE */}
      {variant === "teen" && (
        <div className="mb-4.5 rounded-card border border-line bg-surface-2 px-4.25 py-3.5 text-ui text-ink-2" data-testid="person-record-teen-boundary">
          <b className="text-heading font-medium">
            Because {shell?.header?.title ?? "they"} is{" "}
            {tabs?.teen?.age ?? "a teen"}.
          </b>
          {tabs?.whoPays?.boundaryLine ?? ""} They do not see their notes, what
          they talk about, or their messages to you. Both of them signed the
          teen agreement, which says exactly that in plain words, and{" "}
          {shell?.header?.title ?? "they"} has read it.
        </div>
      )}

      {/* COACH NOTICE */}
      {rank === "member" && variant === "full" && (
        <div className="mb-4.5 rounded-card border border-line bg-surface-2 px-4.25 py-3.5 text-ui text-ink-2" data-testid="person-record-coach-band">
          <b className="text-heading font-medium">You're seeing this the way a coach does.</b> No money anywhere — no
          invoices, no balances, no prices. They can book, write notes and send
          documents.
        </div>
      )}

      {/* ARCHIVED BANNER */}
      {variant === "archived" && (
        <div
          className="mb-4.5 rounded-card border border-line bg-surface-2 px-4.25 py-3.5 text-ui text-ink-2"
          data-testid="person-record-archived-banner"
        >
          <b className="text-heading font-medium">Archived means out of the way, not gone.</b> They don't appear in
          your lists, can't be booked, and won't get campaigns or reminders.
          Everything — their sessions, invoices, documents and notes — is
          exactly where it was, and their portal login still works.
        </div>
      )}

      {/* BODY */}
      {variant === "full" && (
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList variant="line" className="mb-4.5 border-b border-line" aria-label="Record sections">
            <TabsTrigger value="overview" data-testid="record-tab-overview">
              Overview
            </TabsTrigger>
            <TabsTrigger value="sessions" data-testid="record-tab-sessions">
              Sessions
            </TabsTrigger>
            <TabsTrigger value="notes" data-testid="record-tab-notes">
              Notes
            </TabsTrigger>
            {tabs?.money && (
              <TabsTrigger value="money" data-testid="record-tab-money">
                Money
              </TabsTrigger>
            )}
            <TabsTrigger value="documents" data-testid="record-tab-documents">
              Documents
            </TabsTrigger>
            <TabsTrigger value="goals" data-testid="record-tab-goals">
              What they're working on
            </TabsTrigger>
          </TabsList>

          <div data-tab={activeTab}>
            <TabsContent value="overview">
              <PersonOverview
                tabs={tabs}
                onSwitchTab={setActiveTab}
              />
              {person?.staff_role && (
                <MemberPermissions
                  person={person}
                  rank={rank}
                  onChanged={() => onDone?.()}
                />
              )}
            </TabsContent>
            <TabsContent value="sessions">
              <PersonSessionsNotesTabs
                variant="sessions"
                sessions={tabs?.sessions ?? null}
                testId="record-tab-content-sessions"
              />
            </TabsContent>
            <TabsContent value="notes">
              <PersonSessionsNotesTabs
                variant="notes"
                notesPreview={tabs?.notesPreview ?? []}
                testId="record-tab-content-notes"
              />
            </TabsContent>
            {tabs?.money && (
              <TabsContent value="money">
                <PersonMoneyTab
                  money={tabs.money}
                  testId="record-tab-content-money"
                />
              </TabsContent>
            )}
            <TabsContent value="documents">
              <PersonDocumentsTab
                documents={tabs?.documents ?? null}
                notesPreview={tabs?.notesPreview ?? []}
                testId="record-tab-content-documents"
              />
            </TabsContent>
            <TabsContent value="goals">
              {personId && (
                <PersonGoalsTab
                  personId={personId}
                  payerName={payerName}
                />
              )}
            </TabsContent>
          </div>
        </Tabs>
      )}

      {variant === "teen" && (
        <div className="flex items-start gap-5.5" data-testid="person-record-teen-body">
          <div className="min-w-0 flex-1">
            <section className="mb-4.5 rounded-card border border-line bg-surface" data-testid="teen-coming-up">
              <div className="border-b border-hair px-4.25 py-3.5">
                <b className="text-heading font-medium">Coming up</b>
              </div>
              <div className="px-4.25 pt-1.5 pb-3.5">
                {!tabs?.comingUp?.length ? (
                  <EmptyState
                    kind="first-run"
                    headline="Nothing coming up"
                    line="Book a session and it will show here."
                    testId="teen-coming-up-empty"
                  />
                ) : (
                  tabs.comingUp.map((row) => (
                    <div
                      key={row.bookingId}
                      className="flex items-center gap-3 border-b border-hair py-2.75 text-ui last:border-b-0"
                      data-testid="teen-coming-up-row"
                    >
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="text-ui text-ink">
                          {row.title ?? "Session"}
                        </span>
                        <span className="mt-0.5 text-caption text-mute">
                          {[
                            row.locationDetail,
                            row.hostName ? `with ${row.hostName}` : null,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      </span>
                      <StatusBadge label={stateLabel(row.state)} tone={chipTone(row.state)} testId="teen-coming-up-chip" />
                    </div>
                  ))
                )}
              </div>
            </section>
            <section className="mb-4.5 rounded-card border border-line bg-surface" data-testid="teen-notes">
              <div className="border-b border-hair px-4.25 py-3.5">
                <b className="text-heading font-medium">Notes</b>
              </div>
              <div className="px-4.25 pt-1.5 pb-3.5">
                {!tabs?.notesPreview?.length ? (
                  <EmptyState
                    kind="first-run"
                    headline="No notes yet"
                    line="Notes from sessions will show here."
                    testId="teen-notes-empty"
                  />
                ) : (
                  tabs.notesPreview.map((n) => (
                    <div
                      key={n.id}
                      className="flex items-center gap-3 border-b border-hair py-2.75 text-ui last:border-b-0"
                      data-testid="teen-note-row"
                    >
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="text-ui text-ink">{n.title}</span>
                        {n.authorName && (
                          <span className="mt-0.5 text-caption text-mute">
                            Written by {n.authorName}
                          </span>
                        )}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </section>
          </div>
          <div className="w-80 flex-shrink-0">
            <section className="mb-4.5 rounded-card border border-line bg-surface" data-testid="teen-account">
              <div className="border-b border-hair px-4.25 py-3.5">
                <b className="text-heading font-medium">The account</b>
              </div>
              <div className="px-4.25 pt-1.5 pb-3.5">
                {!tabs?.teen?.guardians?.length ? (
                  <EmptyState
                    kind="first-run"
                    headline="No guardian on file"
                    line="A guardian will show here once one is added."
                    testId="teen-account-empty"
                  />
                ) : (
                  tabs.teen.guardians.map((g) => (
                    <div
                      key={g.id}
                      className="flex items-center gap-3 border-b border-hair py-2.75 text-ui last:border-b-0"
                      data-testid="teen-guardian-row"
                    >
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="text-ui text-ink">{g.name}</span>
                        <span className="mt-0.5 text-caption text-mute">
                          Their {g.relationship ?? "guardian"} · pays · sees
                          attendance and money only
                        </span>
                      </span>
                    </div>
                  ))
                )}
              </div>
            </section>
            <section className="mb-4.5 rounded-card border border-line bg-surface" data-testid="teen-documents">
              <div className="border-b border-hair px-4.25 py-3.5">
                <b className="text-heading font-medium">Documents</b>
              </div>
              <div className="px-4.25 pt-1.5 pb-3.5">
                {!tabs?.documents?.signed?.length &&
                !tabs?.documents?.waiting?.length ? (
                  <EmptyState
                    kind="first-run"
                    headline="No documents yet"
                    line="Signed and sent documents will show here."
                    testId="teen-documents-empty"
                  />
                ) : (
                  <>
                    {tabs.documents.signed.map((d) => (
                      <div
                        key={d.id}
                        className="flex items-center gap-3 border-b border-hair py-2.75 text-ui last:border-b-0"
                        data-testid="teen-document-row"
                      >
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="text-ui text-ink">{d.title}</span>
                          <span className="mt-0.5 text-caption text-mute">
                            Signed {fmtDayMonth(d.signedAt) ?? "—"}
                          </span>
                        </span>
                        <StatusBadge label="Signed" tone="ok" testId="teen-document-signed-chip" />
                      </div>
                    ))}
                    {tabs.documents.waiting.map((d) => (
                      <div
                        key={d.id}
                        className="flex items-center gap-3 border-b border-hair py-2.75 text-ui last:border-b-0"
                        data-testid="teen-document-row"
                      >
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="text-ui text-ink">{d.title}</span>
                          <span className="mt-0.5 text-caption text-mute">
                            Sent {fmtDayMonth(d.sentAt) ?? "—"}
                          </span>
                        </span>
                        <StatusBadge label="Waiting" tone="warn" testId="teen-document-waiting-chip" />
                      </div>
                    ))}
                  </>
                )}
              </div>
            </section>
          </div>
        </div>
      )}

      {variant === "new" && (
        <div className="flex items-start gap-5.5" data-testid="person-record-new-body">
          <div className="min-w-0 flex-1">
            <section className="mb-4.5 rounded-card border border-line bg-surface" data-testid="new-timeline">
              <div className="border-b border-hair px-4.25 py-3.5">
                <b className="text-heading font-medium">What's happened so far</b>
              </div>
              <div className="px-4.25 pt-1.5 pb-3.5">
                {!data?.activity?.length ? (
                  <EmptyState
                    kind="first-run"
                    headline="Nothing yet"
                    line="What happens with this person will show here."
                    testId="new-timeline-empty"
                  />
                ) : (
                  data.activity.map((e) => (
                    <div
                      key={e.id}
                      className="flex items-center gap-3 border-b border-hair py-2.75 text-ui last:border-b-0"
                      data-testid="new-timeline-row"
                    >
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="text-ui text-ink">
                          {stateLabel(e.topic)}
                        </span>
                      </span>
                    </div>
                  ))
                )}
              </div>
            </section>

            <section className="mb-4.5 rounded-card border border-line bg-surface" data-testid="new-empties">
              <div className="border-b border-hair px-4.25 py-3.5">
                <b className="text-heading font-medium">Nothing here yet</b>
              </div>
              <div className="px-4.25 pt-1.5 pb-3.5">
                <EmptyState
                  kind="first-run"
                  headline="No sessions"
                  line="Book one, or wait for them to accept"
                  testId="new-no-sessions"
                />
                <EmptyState
                  kind="first-run"
                  headline="No notes"
                  line="They'll appear after the first session"
                  testId="new-no-notes"
                />
                {/* ★ This used to print "No money" for EVERY person with a money tab — Vikki Roberts, who
                    has paid $0.95 and has a Discover card on file, read "Nothing owed, nothing paid"
                    (2 Oct 2026 browser check). Only a person with truly no money gets the empty state. */}
                {tabs?.money && (
                  (tabs.money.owing?.length || tabs.money.paidRows?.length || tabs.money.credits?.length
                    || tabs.money.howPays?.card || tabs.money.howPays?.viaGroupName) ? (
                    <PersonMoneyTab money={tabs.money} testId="new-money" />
                  ) : (
                    <EmptyState
                      kind="first-run"
                      headline="No money"
                      line="Nothing owed, nothing paid"
                      testId="new-no-money"
                    />
                  )
                )}
              </div>
            </section>
          </div>
          <div className="w-80 flex-shrink-0">
            <section className="mb-4.5 rounded-card border border-line bg-surface" data-testid="new-details">
              <div className="border-b border-hair px-4.25 py-3.5">
                <b className="text-heading font-medium">Their details</b>
              </div>
              <div className="px-4.25 pt-1.5 pb-3.5">
                {!tabs?.details?.email && !tabs?.details?.phone ? (
                  <EmptyState
                    kind="first-run"
                    headline="No contact details yet"
                    line="An email or phone number will show here once one is added."
                    testId="new-details-empty"
                  />
                ) : (
                  <>
                    {tabs.details.email && (
                      <div className="flex items-center gap-3 border-b border-hair py-2.75 text-ui last:border-b-0" data-testid="new-detail-email">
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="text-ui text-ink">
                            {tabs.details.email}
                          </span>
                        </span>
                      </div>
                    )}
                    {tabs.details.phone && (
                      <div className="flex items-center gap-3 border-b border-hair py-2.75 text-ui last:border-b-0" data-testid="new-detail-phone">
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="text-ui text-ink">
                            {tabs.details.phone}
                          </span>
                        </span>
                      </div>
                    )}
                  </>
                )}
              </div>
            </section>
          </div>
        </div>
      )}

      {variant === "archived" && (
        <div className="flex items-start gap-5.5" data-testid="person-record-archived-body">
          <div className="min-w-0 flex-1">
            <section className="mb-4.5 rounded-card border border-line bg-surface" data-testid="archived-stats">
              <div className="border-b border-hair px-4.25 py-3.5">
                <b className="text-heading font-medium">What they did here</b>
              </div>
              <div className="flex divide-x divide-hair">
                <div className="flex-1 px-4.25 py-4" data-testid="archived-stat-sessions">
                  <div className="text-figure-md text-ink tabular-nums">
                    {tabs?.archived?.stats?.sessions ?? 0}
                  </div>
                  <div className="mt-1.5 text-meta text-mute">sessions</div>
                </div>
                {tabs?.money && (
                  <div className="flex-1 px-4.25 py-4" data-testid="archived-stat-paid">
                    <div className="text-figure-md text-ink tabular-nums">
                      {tabs?.archived?.stats?.paidMinor != null
                        ? new Intl.NumberFormat("en-US", {
                            style: "currency",
                            currency: "USD",
                            currencyDisplay: "narrowSymbol",
                            minimumFractionDigits: 0,
                          }).format(tabs.archived.stats.paidMinor / 100)
                        : "—"}
                    </div>
                    <div className="mt-1.5 text-meta text-mute">paid</div>
                  </div>
                )}
                <div className="flex-1 px-4.25 py-4" data-testid="archived-stat-documents">
                  <div className="text-figure-md text-ink tabular-nums">
                    {tabs?.archived?.stats?.documents ?? 0}
                  </div>
                  <div className="mt-1.5 text-meta text-mute">documents</div>
                </div>
              </div>
            </section>
            <section className="mb-4.5 rounded-card border border-line bg-surface" data-testid="archived-notes">
              <div className="border-b border-hair px-4.25 py-3.5">
                <b className="text-heading font-medium">Notes</b>
              </div>
              <div className="px-4.25 pt-1.5 pb-3.5">
                {!tabs?.notesPreview?.length ? (
                  <EmptyState
                    kind="first-run"
                    headline="No notes"
                    line="Nothing was written for this person."
                    testId="archived-notes-empty"
                  />
                ) : (
                  tabs.notesPreview.map((n) => (
                    <div
                      key={n.id}
                      className="flex items-center gap-3 border-b border-hair py-2.75 text-ui last:border-b-0"
                      data-testid="archived-note-row"
                    >
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="text-ui text-ink">{n.title}</span>
                        {n.authorName && (
                          <span className="mt-0.5 text-caption text-mute">
                            Written by {n.authorName}
                          </span>
                        )}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </section>
          </div>
          <div className="w-80 flex-shrink-0">
            <section className="mb-4.5 rounded-card border border-line bg-surface" data-testid="archived-why">
              <div className="border-b border-hair px-4.25 py-3.5">
                <b className="text-heading font-medium">Why they were archived</b>
              </div>
              <div className="px-4.25 pt-1.5 pb-3.5">
                {tabs?.archived?.reason && (
                  <div className="flex items-center gap-3 border-b border-hair py-2.75 text-ui last:border-b-0" data-testid="archived-reason-row">
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="text-ui text-ink">
                        {tabs.archived.reason}
                      </span>
                    </span>
                  </div>
                )}
                <div className="flex items-center gap-3 border-b border-hair py-2.75 text-ui last:border-b-0" data-testid="archived-by-row">
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="text-ui text-ink">
                      Archived by {tabs?.archived?.archivedByName ?? "—"}
                    </span>
                    <span className="mt-0.5 text-caption text-mute">
                      {fmtDayMonth(tabs?.archived?.archivedAt) ?? "—"}
                    </span>
                  </span>
                </div>
              </div>
            </section>
          </div>
        </div>
      )}
    </article>
  );
}
