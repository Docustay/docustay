import { useState, useEffect, useContext } from "react";
import { api, ApiError, request } from "@/lib/api.js";
import ScreenState from "@/lib/empty/ScreenState.jsx";
import DecisionModal from "@/lib/forms/DecisionModal.jsx";
import Combobox from "@/lib/components/kit/Combobox.jsx";
import { Button } from "@/lib/components/ui/button.jsx";
import { DeleteButton } from "@/lib/record/DeleteDialog.jsx";
import { AppStateContext } from "@/lib/app/useAppState.js";

export default function AccountRecord({ id, onNavigate = null }) {
  function go(href) {
    if (onNavigate) onNavigate(href);
    else window.location.assign(href);
  }

  const app = useContext(AppStateContext);
  const [phase, setPhase] = useState("loading");
  const [error, setError] = useState(null);
  const [data, setData] = useState(null);

  async function load() {
    setPhase("loading");
    setError(null);
    try {
      const result = await api.payerGroup(id);
      setData(result);
      setPhase("ready");
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setPhase("denied");
        setError(err);
      } else {
        setPhase("error");
        setError(err instanceof ApiError
          ? { message: err.message, requestId: err.requestId }
          : { message: String(err?.message ?? err) });
      }
    }
  }

  useEffect(() => {
    if (id) load();
  }, [id]);

  const group = data?.group ?? null;
  const members = data?.members ?? [];
  const canSeeMoney = data?.owing !== undefined;

  function kindLabel(kind) {
    return kind === "family" ? "Family" : kind === "employer" ? "Employer"
      : kind === "third_party" ? "Third party" : (kind ?? "");
  }

  const subtitle = (() => {
    if (!group) return "";
    const parts = [kindLabel(group.kind)];
    if (group.contactName) parts.push(`${group.contactName} pays`);
    parts.push(`covers ${members.length} ${members.length === 1 ? "person" : "people"}`);
    return parts.join(" · ");
  })();

  function initials(name) {
    const words = String(name ?? "").trim().split(/\s+/).filter(Boolean);
    return words.slice(0, 2).map((w) => w[0]).join("").toUpperCase().replace(/[^A-Z0-9]/g, "") || "·";
  }

  function formatMoney(amountMinor, currency) {
    if (amountMinor == null) return "—";
    const n = amountMinor / 100;
    return new Intl.NumberFormat("en-US", { style: "currency", currency: currency ?? "USD" }).format(n);
  }

  function formatDate(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? "—"
      : d.toLocaleDateString("en-US", { day: "2-digit", month: "short", year: "numeric" });
  }

  // ── "Add someone" — search, add, and the one-account-per-person conflict/move flow ────────────
  const [addOpen, setAddOpen] = useState(false);
  const [addPick, setAddPick] = useState("");
  const [addOptions, setAddOptions] = useState([]);
  const [addBusy, setAddBusy] = useState(false);
  const [addError, setAddError] = useState(null);
  const [addConflict, setAddConflict] = useState(null); // { otherGroupId, otherGroupName }

  function openAdd() {
    setAddOpen(true);
    setAddPick("");
    setAddError(null);
    setAddConflict(null);
    if (addOptions.length === 0) {
      request("/api/list/people/all").then((r) => {
        setAddOptions((r?.rows ?? []).map((p) => ({ value: p.id, label: p.display_name ?? p.email ?? p.id })));
      }).catch(() => { setAddOptions([]); });
    }
  }

  function closeAdd() {
    setAddOpen(false);
    setAddPick("");
    setAddError(null);
    setAddConflict(null);
  }

  async function submitAdd() {
    if (!addPick || addBusy) return;
    setAddBusy(true);
    setAddError(null);
    setAddConflict(null);
    try {
      await api.addPayerGroupMember(id, { person_id: addPick });
      closeAdd();
      await load();
    } catch (err) {
      if (err instanceof ApiError) {
        setAddError(err.message);
        const detail = err.body?.error?.detail;
        if (err.status === 409 && detail?.code === "already_covered") {
          setAddConflict({ otherGroupId: detail.otherGroupId ?? null, otherGroupName: detail.otherGroupName ?? null });
        }
      } else {
        setAddError(String(err?.message ?? err));
      }
    } finally {
      setAddBusy(false);
    }
  }

  async function moveThem() {
    if (!addPick || addBusy) return;
    setAddBusy(true);
    try {
      await api.movePayerGroupMember(id, { personId: addPick });
      closeAdd();
      await load();
    } catch (err) {
      setAddError(err instanceof ApiError ? err.message : String(err?.message ?? err));
    } finally {
      setAddBusy(false);
    }
  }

  // ── "Remove someone" — per-member row, 409 open_invoice shown inline on that row ──────────────
  const [removeErrors, setRemoveErrors] = useState({}); // membershipId -> message
  const [removeBusy, setRemoveBusy] = useState({});   // membershipId -> boolean

  async function removeMember(membershipId) {
    setRemoveBusy((prev) => ({ ...prev, [membershipId]: true }));
    setRemoveErrors((prev) => ({ ...prev, [membershipId]: null }));
    try {
      await api.removePayerGroupMember(id, membershipId);
      await load();
    } catch (err) {
      setRemoveErrors((prev) => ({ ...prev, [membershipId]: err instanceof ApiError ? err.message : String(err?.message ?? err) }));
    } finally {
      setRemoveBusy((prev) => ({ ...prev, [membershipId]: false }));
    }
  }

  // ── Archive — counts-first ──────────────────────────────────────────────────────────────────
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [archiveError, setArchiveError] = useState(null);

  async function confirmArchive() {
    setArchiveBusy(true);
    setArchiveError(null);
    try {
      await api.archivePayerGroup(id);
      setArchiveOpen(false);
      await load();
    } catch (err) {
      setArchiveError(err instanceof ApiError ? err.message : String(err?.message ?? err));
    } finally {
      setArchiveBusy(false);
    }
  }

  return (
    <>
      <ScreenState
        phase={phase}
        error={phase === "error" ? error : null}
        reason={phase === "denied" ? (error?.message ?? null) : null}
        onNavigate={go}
      >
        {group && (
          <article className="flex flex-col gap-[var(--stack)] w-full" data-testid="account-record">
            <header className="flex items-center gap-[var(--gap)]">
              <span className="flex items-center justify-center w-14 h-14 rounded-full bg-[var(--primary-wash)] text-[var(--primary)] font-medium text-[var(--fs-heading)]" data-testid="account-mark" aria-hidden="true">{initials(group.name)}</span>
              <div className="flex-1 min-w-0">
                <h1 className="m-0 text-[var(--fs-heading)] font-[var(--fw-heading)]" data-testid="account-title">{group.name}</h1>
                <p className="m-0 mt-1 text-[var(--fs-sm)] text-[var(--ink-muted)]" data-testid="account-subtitle">{subtitle}</p>
              </div>
              <div className="flex gap-[var(--gap)] flex-shrink-0">
                <Button type="button" variant="outline" data-testid="account-add-someone" onClick={openAdd}>
                  Add someone
                </Button>
                <Button type="button" variant="outline" data-testid="account-archive"
                        disabled={Boolean(group.archivedAt)}
                        onClick={() => { setArchiveOpen(true); setArchiveError(null); }}>
                  Archive
                </Button>
                <DeleteButton type="payer_group" id={id} label={group.name ?? null} rank={app?.nav?.rank ?? null}
                  onDone={() => go("/accounts/all")} />
              </div>
            </header>

            {addOpen && (
              <div className="bg-[var(--surface)] border border-[var(--line)] rounded-[var(--radius)]" data-testid="account-add-panel">
                <div className="px-[17px] py-[14px] border-b border-[var(--line-soft)] font-medium text-[var(--fs)]"><b>Add someone</b></div>
                <div className="px-[17px] pt-[6px] pb-[14px] flex flex-col gap-1">
                  <Combobox
                    testId="account-add-search"
                    options={addOptions}
                    value={addPick}
                    placeholder="Search people"
                    emptyText="No people yet."
                    onValueChange={setAddPick}
                  />
                  <div className="flex gap-[var(--gap)] mt-[10px]">
                    <Button type="button" variant="outline" data-testid="account-add-cancel" onClick={closeAdd}
                            disabled={addBusy}>Cancel</Button>
                    <Button type="button" data-testid="account-add-submit" onClick={submitAdd}
                            disabled={addBusy || !addPick}>Add</Button>
                  </div>
                  {addError && (
                    <p className="text-[var(--fs-sm)] text-[var(--danger)] m-0 mt-2" role="alert" data-testid="account-add-error">{addError}</p>
                  )}
                  {addConflict && (
                    <Button type="button" data-testid="account-add-move" onClick={moveThem} disabled={addBusy}>
                      Move them
                    </Button>
                  )}
                </div>
              </div>
            )}

            {canSeeMoney && (
              <div className="bg-[var(--surface)] border border-[var(--line)] rounded-[var(--radius)]" data-testid="account-owing-band">
                <div className="px-[17px] py-[14px] border-b border-[var(--line-soft)] font-medium text-[var(--fs)]"><b>Owing</b></div>
                <div className="px-[17px] pt-[6px] pb-[14px] flex flex-col gap-1">
                  {!data.owing?.length ? (
                    <p className="text-[var(--fs-sm)] text-[var(--ink-muted)] py-3 my-0">Nothing owing right now.</p>
                  ) : (
                    data.owing.map((inv) => (
                      <div key={inv.invoiceId} className="flex items-center gap-3 py-[11px] px-0 border-b border-[var(--line-soft)] text-[var(--fs)]" data-testid="account-owing-row">
                        <span className="flex-1 min-w-0 break-words">{inv.invoiceNumber ?? "Invoice"}</span>
                        <span className="text-[var(--fs-sm)] text-[var(--ink-muted)] flex-shrink-0">Due {formatDate(inv.dueAt)}</span>
                        <span className="tabular-nums flex-shrink-0">{formatMoney(inv.amountMinor, inv.currency)}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

            <div className="bg-[var(--surface)] border border-[var(--line)] rounded-[var(--radius)]" data-testid="account-members-band">
              <div className="px-[17px] py-[14px] border-b border-[var(--line-soft)] font-medium text-[var(--fs)]"><b>People covered</b></div>
              <div className="px-[17px] pt-[6px] pb-[14px] flex flex-col gap-1">
                {!members.length ? (
                  <p className="text-[var(--fs-sm)] text-[var(--ink-muted)] py-3 my-0">Nobody is covered by this account yet.</p>
                ) : (
                  members.map((m) => (
                    <div key={m.membershipId} className="flex items-center gap-3 py-[11px] px-0 border-b border-[var(--line-soft)] text-[var(--fs)]" data-testid="account-member-row">
                      <a className="flex-1 min-w-0 break-words text-[var(--color-brand)] no-underline hover:underline" href={`/record/person/${m.personId}`}
                         onClick={(e) => { if (onNavigate) { e.preventDefault(); go(`/record/person/${m.personId}`); } }}
                      >{m.name}</a>
                      {m.isTeen && (
                        <span className="text-[var(--fs-sm)] text-[var(--ink-muted)] flex-shrink-0" data-testid="account-member-teen-line">
                          {group.contactName ?? "The contact"} sees attendance and what's owed. Never the notes.
                        </span>
                      )}
                      <Button type="button" variant="ghost" data-testid={`account-member-remove-${m.membershipId}`}
                              disabled={removeBusy[m.membershipId]}
                              onClick={() => removeMember(m.membershipId)}>Remove</Button>
                      {removeErrors[m.membershipId] && (
                        <p className="text-[var(--fs-sm)] text-[var(--danger)] m-0 mt-2 w-full" role="alert"
                           data-testid={`account-member-remove-error-${m.membershipId}`}>{removeErrors[m.membershipId]}</p>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>

            {group.kind === "third_party" && (
              <div className="bg-[var(--surface)] border border-[var(--line)] rounded-[var(--radius)]" data-testid="account-invoicing-band">
                <div className="px-[17px] py-[14px] border-b border-[var(--line-soft)] font-medium text-[var(--fs)]"><b>How they're invoiced</b></div>
                <div className="px-[17px] pt-[6px] pb-[14px] flex flex-col gap-1">
                  <p className="text-[var(--fs-sm)] text-[var(--ink-muted)] m-0">{group.billingNote ?? "No billing note yet."}</p>
                  {group.contactUserId && (
                    <Button type="button" variant="outline" data-testid="account-invoice"
                            onClick={() => go(`/money/invoices?new=1&for=${group.contactUserId}`)}>
                      Invoice the account
                    </Button>
                  )}
                </div>
              </div>
            )}

            {canSeeMoney && (
              <div className="bg-[var(--surface)] border border-[var(--line)] rounded-[var(--radius)]" data-testid="account-history-band">
                <div className="px-[17px] py-[14px] border-b border-[var(--line-soft)] font-medium text-[var(--fs)]"><b>History</b></div>
                <div className="px-[17px] pt-[6px] pb-[14px] flex flex-col gap-1">
                  {!data.history?.length ? (
                    <p className="text-[var(--fs-sm)] text-[var(--ink-muted)] py-3 my-0">No payments yet.</p>
                  ) : (
                    data.history.map((p) => (
                      <div key={p.paymentId} className="flex items-center gap-3 py-[11px] px-0 border-b border-[var(--line-soft)] text-[var(--fs)]" data-testid="account-history-row">
                        <span className="flex-1 min-w-0 break-words text-[var(--ink-muted)] text-[var(--fs-sm)]">{formatDate(p.paidAt)}</span>
                        <span className="tabular-nums flex-shrink-0">{formatMoney(p.amountMinor, p.currency)}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </article>
        )}
      </ScreenState>

      {archiveOpen && (
        <DecisionModal
          open={archiveOpen}
          onOpenChange={setArchiveOpen}
          title={`Archive ${group?.name ?? "this account"}?`}
          rows={[{
            headline: `${data?.owing?.length ?? 0} open invoice(s)`,
            detail: "These must be settled or voided before this account can be archived.",
          }]}
          cancelLabel="Don't archive"
          confirmLabel="Archive"
          danger={true}
          busy={archiveBusy}
          error={archiveError}
          onCancel={() => { setArchiveOpen(false); setArchiveError(null); }}
          onConfirm={confirmArchive}
          testId="account-archive-modal"
        />
      )}
    </>
  );
}
