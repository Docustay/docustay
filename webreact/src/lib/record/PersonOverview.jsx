// ═══════════════════════════════════════════════════════════════════════════════════════════════
// PersonOverview — ported from webui/src/lib/record/PersonOverview.svelte (386 lines, 50 of them
// <style>). Props, testids, copy and behaviour are preserved; `<style>` blocks are NOT ported
// (styling comes from kit components + tokens only).
//
// ★★★ ONE OBJECT PROP, `tabs` — the WHOLE `personTabs` payload, not sliced per-band. Overview is
//     the one screen that is ALL of them at once (Coming up · Notes preview · Money strip · Who pays
//     · Documents · Details · Found you through), so a single trusted object is the honest shape rather
//     than seven separate props that must always be kept in lockstep by the caller.
//
// ★★ THEY/THEM THROUGHOUT. `app_user` records no reliable gender — the frame's illustrative
//     "her"/"she" is rewritten gender-neutral here, matching the sibling 12.23 tabs already built.
//
// ★ HONEST NULLS, NEVER FILLED IN: `notesPreview[].excerpt` is always null (no free-text body column)
//   so no excerpt line is rendered, only title + author + date. `howPays.card.expMonth`/`expYear`
//   are always null (no expiry column) so no expiry sub-line is ever rendered.
//
// ★★★ EVERY BAND IS THE REAL BAND, NEVER A SLATE. A section with nothing renders EmptyState in its
//     own place, not an omitted heading.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { Badge } from "@/lib/components/ui/badge.jsx";
import EmptyState from "@/lib/empty/EmptyState.jsx";

export default function PersonOverview({ tabs, onSwitchTab = null }) {
  const comingUp = tabs?.comingUp ?? [];
  const notesPreview = tabs?.notesPreview ?? [];
  const money = tabs?.money ?? null;
  const whoPays = tabs?.whoPays ?? null;
  const documents = tabs?.documents ?? null;
  const details = tabs?.details ?? null;
  const foundThrough = tabs?.foundThrough ?? null;

  const docRows = [
    ...((documents?.signed ?? []).map((d) => ({ ...d, kind: "signed" }))),
    ...((documents?.waiting ?? []).map((d) => ({ ...d, kind: "waiting" }))),
  ];

  // ★ `en-GB` day-then-month — matches the frame's own dates ("3 March", "24 September")
  function fmtDayMonth(value) {
    if (!value) return null;
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "long" });
  }

  function fmtWeekdayDay(value) {
    if (!value) return null;
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric" });
  }

  // ★ Whole-dollar amounts print without cents ("$540")
  function fmtMoney(amountMinor, currency) {
    if (amountMinor == null || !currency) return null;
    const n = amountMinor / 100;
    try {
      return new Intl.NumberFormat("en-US", {
        style: "currency", currency, currencyDisplay: "narrowSymbol",
        minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2,
      }).format(n);
    } catch {
      return `${currency} ${n}`;
    }
  }

  function stateLabel(state) {
    if (!state) return "";
    return state.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  }

  const firstOwing = money?.owing?.[0] ?? null;
  const firstCredit = money?.credits?.[0] ?? null;
  const paidCurrency = money?.paidRows?.[0]?.currency ?? null;
  const hasMoneyContent = Boolean(firstOwing) || Boolean(firstCredit) || (money?.paidInvoiceCount ?? 0) > 0;

  return (
    <div className="w-full" data-testid="person-overview">
      <div className="flex gap-[22px] items-start">
        {/* Left column: Coming up, Notes, Money (if present) */}
        <div className="flex-1 min-w-0">
          {/* ═══ COMING UP ═══ */}
          <section className="bg-surface border border-line rounded-card mb-[18px]" data-testid="overview-coming-up">
            <div className="flex items-center gap-2.5 px-4.25 py-3.5 border-b border-line-soft">
              <b>Coming up</b>
              {comingUp.length > 0 && onSwitchTab && (
                <button
                  type="button"
                  className="ml-auto text-meta text-mute hover:text-action-600 bg-none border-none p-0 cursor-pointer"
                  data-testid="overview-coming-up-see-all"
                  onClick={() => onSwitchTab("sessions")}
                >
                  See all
                </button>
              )}
            </div>
            <div className="px-4.25 py-1.5">
              {comingUp.length === 0 ? (
                <EmptyState kind="first-run" headline="Nothing coming up"
                            line="Book a session and it will show here." testId="overview-coming-up-empty" />
              ) : (
                comingUp.map((row) => (
                  <div key={row.bookingId} className="flex items-center gap-2.5 min-h-[40px] py-2 px-0 border-b border-line-soft text-ui last:border-b-0"
                       data-testid="overview-coming-up-row">
                    <span className="w-[74px] flex-shrink-0 text-meta text-mute tabular-nums">
                      {fmtWeekdayDay(row.startsAt) ?? "—"}
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-ink overflow-anywhere">{row.title ?? "Session"}</span>
                      <span className="block text-meta text-mute mt-0.5 overflow-anywhere">
                        {[row.locationDetail, row.hostName ? `with ${row.hostName}` : null]
                          .filter(Boolean).join(" · ")}
                      </span>
                    </span>
                    <Badge className="flex-shrink-0" data-value={row.state}>{stateLabel(row.state)}</Badge>
                  </div>
                ))
              )}
            </div>
          </section>

          {/* ═══ NOTES ═══ */}
          <section className="bg-surface border border-line rounded-card mb-[18px]" data-testid="overview-notes">
            <div className="flex items-center gap-2.5 px-4.25 py-3.5 border-b border-line-soft">
              <b>Notes</b>
              {onSwitchTab && (
                <button
                  type="button"
                  className="ml-auto text-meta text-mute hover:text-action-600 bg-none border-none p-0 cursor-pointer"
                  data-testid="overview-notes-write-one"
                  onClick={() => onSwitchTab("notes")}
                >
                  Write one
                </button>
              )}
            </div>
            <div className="px-4.25 py-1.5">
              {notesPreview.length === 0 ? (
                <EmptyState kind="first-run" headline="No notes yet"
                            line="Notes from sessions will show here." testId="overview-notes-empty" />
              ) : (
                notesPreview.map((n) => (
                  <div key={n.id} className="flex items-center gap-2.5 min-h-[40px] py-2 px-0 border-b border-line-soft text-ui last:border-b-0"
                       data-testid="overview-note-row">
                    <span className="w-[74px] flex-shrink-0 text-meta text-mute tabular-nums">
                      {fmtDayMonth(n.createdAt) ?? "—"}
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-ink overflow-anywhere">{n.title}</span>
                      {n.authorName && (
                        <span className="block text-meta text-mute mt-0.5 overflow-anywhere">Written by {n.authorName}</span>
                      )}
                    </span>
                  </div>
                ))
              )}
            </div>
          </section>

          {/* ═══ MONEY STRIP (mayMoney only) ═══ */}
          {money && (
            <section className="bg-surface border border-line rounded-card mb-[18px]" data-testid="overview-money">
              <div className="flex items-center gap-2.5 px-4.25 py-3.5 border-b border-line-soft">
                <b>Money</b>
                {onSwitchTab && (
                  <button
                    type="button"
                    className="ml-auto text-meta text-mute hover:text-action-600 bg-none border-none p-0 cursor-pointer"
                    data-testid="overview-money-open"
                    onClick={() => onSwitchTab("money")}
                  >
                    Open money
                  </button>
                )}
              </div>
              <div className="px-4.25 py-1.5">
                {!hasMoneyContent ? (
                  <EmptyState kind="first-run" headline="No money" line="Nothing owed, nothing paid yet."
                              testId="overview-money-empty" />
                ) : (
                  <>
                    {firstOwing && (
                      <div className="flex items-center gap-2.5 min-h-[40px] py-2 px-0 border-b border-line-soft text-ui"
                           data-testid="overview-money-owing">
                        <span className="flex-1 min-w-0">
                          <span className="block text-ink overflow-anywhere">
                            {fmtMoney(firstOwing.amountMinor, firstOwing.currency)} owing
                          </span>
                          <span className="block text-meta text-mute mt-0.5 overflow-anywhere">
                            {[firstOwing.memo, firstOwing.dueAt ? `due ${fmtDayMonth(firstOwing.dueAt)}` : null]
                              .filter(Boolean).join(" · ")}
                          </span>
                        </span>
                        <Badge className="flex-shrink-0" data-value="open">Open</Badge>
                      </div>
                    )}
                    {firstCredit && (
                      <div className="flex items-center gap-2.5 min-h-[40px] py-2 px-0 border-b border-line-soft text-ui"
                           data-testid="overview-money-credit">
                        <span className="flex-1 min-w-0">
                          <span className="block text-ink overflow-anywhere">
                            {Math.max(0, (firstCredit.total ?? 0) - (firstCredit.used ?? 0))} of {firstCredit.total} sessions left
                          </span>
                          <span className="block text-meta text-mute mt-0.5 overflow-anywhere">
                            Expiring {fmtDayMonth(firstCredit.expiresAt) ?? "—"}
                          </span>
                        </span>
                      </div>
                    )}
                    {(money.paidInvoiceCount ?? 0) > 0 && (
                      <div className="flex items-center gap-2.5 min-h-[40px] py-2 px-0 text-ui last:border-b-0"
                           data-testid="overview-money-paid">
                        <span className="flex-1 min-w-0">
                          <span className="block text-ink overflow-anywhere">
                            {fmtMoney(money.paidSinceMinor, paidCurrency)} paid
                            {money.firstPaidAt ? ` since ${fmtDayMonth(money.firstPaidAt)}` : ""}
                          </span>
                          <span className="block text-meta text-mute mt-0.5 overflow-anywhere">
                            Across {money.paidInvoiceCount}
                            invoice{money.paidInvoiceCount === 1 ? "" : "s"}
                          </span>
                        </span>
                      </div>
                    )}
                  </>
                )}
              </div>
            </section>
          )}
        </div>

        {/* Right column: Who pays, Documents, Details */}
        <div className="w-[320px] flex-shrink-0">
          {/* ═══ WHO PAYS ═══ */}
          <section className="bg-surface border border-line rounded-card mb-[18px]" data-testid="overview-who-pays">
            <div className="flex items-center gap-2.5 px-4.25 py-3.5 border-b border-line-soft">
              <b>Who pays</b>
            </div>
            <div className="px-4.25 py-1.5">
              {!whoPays?.group && !whoPays?.contact ? (
                <EmptyState kind="first-run" headline="Pays for themselves"
                            line="No payer group is on this account." testId="overview-who-pays-empty" />
              ) : (
                <>
                  {whoPays.group && (
                    <div className="flex items-center gap-2.5 min-h-[40px] py-2 px-0 border-b border-line-soft text-ui"
                         data-testid="overview-who-pays-group">
                      <span className="flex-1 min-w-0">
                        <span className="block text-ink overflow-anywhere">{whoPays.group.name}</span>
                        {whoPays.contact && (
                          <span className="block text-meta text-mute mt-0.5 overflow-anywhere">
                            {whoPays.contact.name}{whoPays.contact.relationship ? ` · their ${whoPays.contact.relationship}` : ""}
                          </span>
                        )}
                      </span>
                    </div>
                  )}
                  {whoPays.boundaryLine && (
                    <div className="flex items-center gap-2.5 min-h-[40px] py-2 px-0 border-b border-line-soft text-ui"
                         data-testid="overview-who-pays-boundary">
                      <span className="flex-1 min-w-0">
                        <span className="block text-ink overflow-anywhere">{whoPays.boundaryLine}</span>
                      </span>
                    </div>
                  )}
                  {whoPays.alsoOnAccount?.length > 0 && (
                    <div className="flex items-center gap-2.5 min-h-[40px] py-2 px-0 text-ui last:border-b-0"
                         data-testid="overview-also-on-account">
                      <span className="flex-1 min-w-0">
                        <span className="block text-ink overflow-anywhere">Also on the account</span>
                        <span className="block text-meta text-mute mt-0.5 overflow-anywhere">
                          {whoPays.alsoOnAccount
                            .map((p) => [p.name, p.age != null ? p.age : null, p.relationship ? `their ${p.relationship}` : null]
                              .filter(Boolean).join(", "))
                            .join(" · ")}
                        </span>
                      </span>
                    </div>
                  )}
                </>
              )}
            </div>
          </section>

          {/* ═══ DOCUMENTS ═══ */}
          <section className="bg-surface border border-line rounded-card mb-[18px]" data-testid="overview-documents">
            <div className="flex items-center gap-2.5 px-4.25 py-3.5 border-b border-line-soft">
              <b>Documents</b>
            </div>
            <div className="px-4.25 py-1.5">
              {docRows.length === 0 ? (
                <EmptyState kind="first-run" headline="No documents yet"
                            line="Signed and sent documents will show here." testId="overview-documents-empty" />
              ) : (
                docRows.map((d) => (
                  <div key={d.id} className="flex items-center gap-2.5 min-h-[40px] py-2 px-0 border-b border-line-soft text-ui last:border-b-0"
                       data-testid="overview-document-row">
                    <span className="flex-1 min-w-0">
                      <span className="block text-ink overflow-anywhere">{d.title}</span>
                      <span className="block text-meta text-mute mt-0.5 overflow-anywhere">
                        {d.kind === "signed"
                          ? `Signed ${fmtDayMonth(d.signedAt) ?? "—"}`
                          : `Sent ${fmtDayMonth(d.sentAt) ?? "—"}`}
                      </span>
                    </span>
                    <Badge className="flex-shrink-0" data-value={d.kind === "signed" ? "signed" : "sent"}>
                      {d.kind === "signed" ? "Signed" : "Waiting"}
                    </Badge>
                  </div>
                ))
              )}
            </div>
          </section>

          {/* ═══ THEIR DETAILS ═══ */}
          <section className="bg-surface border border-line rounded-card mb-[18px]" data-testid="overview-details">
            <div className="flex items-center gap-2.5 px-4.25 py-3.5 border-b border-line-soft">
              <b>Their details</b>
            </div>
            <div className="px-4.25 py-1.5">
              {!details?.email && !details?.phone ? (
                <EmptyState kind="first-run" headline="No contact details yet"
                            line="An email or phone number will show here once one is added."
                            testId="overview-details-empty" />
              ) : (
                <>
                  {details.email && (
                    <div className="flex items-center gap-2.5 min-h-[40px] py-2 px-0 border-b border-line-soft text-ui"
                         data-testid="overview-detail-email">
                      <span className="flex-1 min-w-0">
                        <span className="block text-ink overflow-anywhere">{details.email}</span>
                      </span>
                    </div>
                  )}
                  {details.phone && (
                    <div className="flex items-center gap-2.5 min-h-[40px] py-2 px-0 border-b border-line-soft text-ui"
                         data-testid="overview-detail-phone">
                      <span className="flex-1 min-w-0">
                        <span className="block text-ink overflow-anywhere">{details.phone}</span>
                        {details.prefersText && (
                          <span className="block text-meta text-mute mt-0.5 overflow-anywhere">Prefers text for reminders</span>
                        )}
                      </span>
                    </div>
                  )}
                </>
              )}
              {(foundThrough?.partyName || foundThrough?.referredByName || foundThrough?.source) && (
                <div className="flex items-center gap-2.5 min-h-[40px] py-2 px-0 text-ui last:border-b-0"
                     data-testid="overview-found-through">
                  <span className="flex-1 min-w-0">
                    <span className="block text-ink overflow-anywhere">Found you through</span>
                    <span className="block text-meta text-mute mt-0.5 overflow-anywhere">
                      {foundThrough.partyName ?? foundThrough.referredByName ?? foundThrough.source}
                    </span>
                  </span>
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
