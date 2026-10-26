// ═══════════════════════════════════════════════════════════════════════════════════════════════
// Task 6.4 / 06-settings.md §2.6, §11 — `/settings/data` (`SetData`).
//
// ★★★ BUILT FROM `specs/mockups/SetData.frame.html`, PORTED EXACTLY: breadcrumb "Settings" → h1
//     "Data and audit" → subtitle → "Import clients" (links out to `/settings/import`, task 6.4's
//     other half) → "Export everything" (owner-only "Prepare export") → "A client's data request"
//     (Export one person / Remove one person) → "Audit log" (3-row preview + a link to the full
//     log).
//
// ★ "Remove one person" is drawn by the frame with NO backing route anywhere in 06-settings.md
//   §2.5/§2.6's route tables — only "Export one person" has one. Rendered per the frame's own
//   structure, disabled, with an honest reason, per CLAUDE.md failure #1 ("wired to nothing"):
//   this is a row that IS wired — to a plain, said-out-loud "not built yet" rather than to a
//   route that does not exist. Flagged in this build's report as a scope gap, not hidden.
//
// ★ `view` (`state.data`) is `{ exports, auditPreview }` from `GET /api/settings/data` — the shell
//   (`Screen.svelte`) has already run its own loading/error/no-permission phases before this
//   component mounts, same discipline `SetBilling.svelte` documents for itself.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useState, useEffect, useCallback } from "react";
import { api, ApiError } from "@/lib/api.js";
import { Button } from "@/lib/components/ui/button.jsx";
import { Badge } from "@/lib/components/ui/badge.jsx";
import { Input } from "@/lib/components/ui/input.jsx";
import { Alert } from "@/lib/components/ui/alert.jsx";

// Same format as the full audit log's When column ("Oct 22, 2026, 11:57 PM").
function auditWhen(t) {
  if (!t) return "";
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? String(t) : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

// "the maintainer requested a data export" when the person is known, else the sentence on its own with a capital.
function auditLine(ev) {
  const what = String(ev.description ?? ev.topic ?? "");
  return ev.actorName ? `${ev.actorName} ${what}` : what.charAt(0).toUpperCase() + what.slice(1);
}

export default function SetData({ view = null, rank = null, onNavigate = null, onDone = null }) {
  const isOwner = (rank ?? "") === "owner";

  // ── STATE ───────────────────────────────────────────────────────────────────────────────────
  const [exportsList, setExportsList] = useState(view?.exports ?? []);
  const [auditPreview, setAuditPreview] = useState(view?.auditPreview ?? []);

  // ── EXPORT EVERYTHING ───────────────────────────────────────────────────────────────────────
  const [everythingBusy, setEverythingBusy] = useState(false);
  const [everythingError, setEverythingError] = useState(null);

  // ── EXPORT ONE PERSON ───────────────────────────────────────────────────────────────────────
  const [personQuery, setPersonQuery] = useState("");
  const [personHits, setPersonHits] = useState([]);
  const [personSearchBusy, setPersonSearchBusy] = useState(false);
  const [personSearchError, setPersonSearchError] = useState(null);
  const [selectedPerson, setSelectedPerson] = useState(null);
  const [personExportBusy, setPersonExportBusy] = useState(false);
  const [personExportError, setPersonExportError] = useState(null);

  // ── SEARCH TIMER ────────────────────────────────────────────────────────────────────────────
  const [searchTimer, setSearchTimer] = useState(null);

  // ── EFFECTS ──────────────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    setExportsList(view?.exports ?? []);
    setAuditPreview(view?.auditPreview ?? []);
  }, [view]);

  // ── HANDLERS ────────────────────────────────────────────────────────────────────────────────
  const goto = (e, href) => {
    e?.preventDefault?.();
    onNavigate?.(href);
  };

  const refreshExports = useCallback(async () => {
    try {
      const res = await api.dataExports();
      setExportsList(res.exports);
    } catch {
      // ★ A failed refresh leaves the last-known list on screen rather than blanking it —
      //   `prepareEverythingExport`'s own error banner already reports the real failure, if any.
    }
  }, []);

  const prepareEverythingExport = useCallback(async () => {
    if (everythingBusy) return;
    setEverythingBusy(true);
    setEverythingError(null);
    try {
      await api.requestDataExport({ scope: "everything" });
      await refreshExports();
      onDone?.();
    } catch (err) {
      setEverythingError(err instanceof ApiError ? err.message : String(err?.message ?? err));
    } finally {
      setEverythingBusy(false);
    }
  }, [everythingBusy, refreshExports, onDone]);

  // ── PERSON SEARCH ───────────────────────────────────────────────────────────────────────────
  const runPersonSearch = useCallback(async (q) => {
    setPersonSearchBusy(true);
    setPersonSearchError(null);
    try {
      const res = await api.search(q);
      const peopleGroup = (res.hits ?? []).find((g) => g.type === "person");
      setPersonHits(peopleGroup?.hits ?? []);
    } catch (err) {
      setPersonSearchError(err instanceof ApiError ? err.message : String(err?.message ?? err));
      setPersonHits([]);
    } finally {
      setPersonSearchBusy(false);
    }
  }, []);

  const onPersonQueryInput = useCallback(
    (e) => {
      const q = e.target.value;
      setPersonQuery(q);
      setSelectedPerson(null);
      if (searchTimer) clearTimeout(searchTimer);
      const trimmed = q.trim();
      if (trimmed.length < 2) {
        setPersonHits([]);
        return;
      }
      const timer = setTimeout(() => runPersonSearch(trimmed), 250);
      setSearchTimer(timer);
    },
    [searchTimer, runPersonSearch],
  );

  const pickPerson = useCallback((hit) => {
    setSelectedPerson(hit);
    setPersonHits([]);
    setPersonQuery(hit.label);
  }, []);

  const exportOnePerson = useCallback(async () => {
    if (personExportBusy || !selectedPerson) return;
    setPersonExportBusy(true);
    setPersonExportError(null);
    try {
      await api.requestDataExport({ scope: "one_person", personId: selectedPerson.id });
      await refreshExports();
      setSelectedPerson(null);
      setPersonQuery("");
      onDone?.();
    } catch (err) {
      setPersonExportError(err instanceof ApiError ? err.message : String(err?.message ?? err));
    } finally {
      setPersonExportBusy(false);
    }
  }, [personExportBusy, selectedPerson, refreshExports, onDone]);

  // ── HELPERS ─────────────────────────────────────────────────────────────────────────────────
  const statusLabel = (status) => {
    if (status === "ready") return "Ready";
    if (status === "failed") return "Failed";
    if (status === "processing") return "Preparing…";
    return "Queued";
  };

  const statusVariant = (status) => {
    if (status === "ready") return "secondary";
    if (status === "failed") return "destructive";
    return "outline";
  };

  return (
    <div
      className="flex flex-col gap-6 max-w-[720px] py-6 px-6 md:py-8 md:px-8"
      data-testid="settings-data"
    >
      {/* ── BREADCRUMB ──────────────────────────────────────────────────────────────────────── */}
      <p className="text-xs text-muted-foreground m-0">
        <a href="/settings" onClick={(e) => goto(e, "/settings")} className="text-primary hover:text-primary/80">
          Settings
        </a>
      </p>

      {/* ── HEADER ──────────────────────────────────────────────────────────────────────────── */}
      <div>
        <h1 className="text-2xl font-medium -tracking-[0.01em] mt-1 mb-0">Data and audit</h1>
        <p className="text-sm text-muted-foreground mt-1.5 mb-0">
          Bring people in, take a practice's data out, and see who changed what.
        </p>
      </div>

      {/* ── IMPORT CLIENTS ──────────────────────────────────────────────────────────────────── */}
      <section
        className="flex flex-col gap-2.5 p-4 rounded-lg bg-muted/50"
        data-testid="data-section-import"
      >
        <h2 className="text-base font-semibold m-0 text-foreground">Import clients</h2>
        <p className="text-sm text-muted-foreground m-0">Bring in a CSV of people from another system.</p>
        <div>
          <Button
            variant="outline"
            data-testid="data-goto-import"
            onClick={(e) => goto(e, "/settings/import")}
          >
            Import clients
          </Button>
        </div>
      </section>

      {/* ── EXPORT EVERYTHING ───────────────────────────────────────────────────────────────── */}
      <section
        className="flex flex-col gap-2.5 p-4 rounded-lg bg-muted/50"
        data-testid="data-section-export-everything"
      >
        <h2 className="text-base font-semibold m-0 text-foreground">Export everything</h2>
        <p className="text-sm text-muted-foreground m-0">
          Every person, account, booking and invoice this practice owns, as one file.
        </p>
        {!isOwner ? (
          <p className="text-sm text-muted-foreground m-0" data-testid="data-export-everything-noperm">
            Only the practice owner can export everything.
          </p>
        ) : (
          <>
            {everythingError && (
              <Alert variant="destructive" data-testid="data-export-everything-error" role="alert">
                {everythingError}
              </Alert>
            )}
            <div>
              <Button
                data-testid="data-export-everything"
                disabled={everythingBusy}
                onClick={prepareEverythingExport}
              >
                {everythingBusy ? "Preparing…" : "Prepare export"}
              </Button>
            </div>
          </>
        )}
      </section>

      {/* ── A CLIENT'S DATA REQUEST ──────────────────────────────────────────────────────────── */}
      <section
        className="flex flex-col gap-2.5 p-4 rounded-lg bg-muted/50"
        data-testid="data-section-person-request"
      >
        <h2 className="text-base font-semibold m-0 text-foreground">A client's data request</h2>

        {/* Export one person */}
        <div className="flex flex-col gap-2 pt-2 border-t border-border" data-testid="data-export-one-person">
          <p className="text-sm font-semibold text-foreground m-0">Export one person</p>
          <div className="flex flex-col gap-1.5">
            <Input
              type="text"
              placeholder="Search by name or email…"
              value={personQuery}
              onChange={onPersonQueryInput}
              data-testid="data-person-search-input"
            />
            {personSearchBusy ? (
              <p className="text-sm text-muted-foreground m-0" data-testid="data-person-search-loading">
                Searching…
              </p>
            ) : personSearchError ? (
              <Alert variant="destructive" data-testid="data-person-search-error" role="alert">
                {personSearchError}
              </Alert>
            ) : personHits.length > 0 ? (
              <ul className="flex flex-col gap-0.5 m-0 p-0 list-none" data-testid="data-person-hits">
                {personHits.map((hit) => (
                  <li key={hit.id}>
                    <button
                      type="button"
                      className="flex justify-between gap-3 w-full text-left p-2 rounded-lg border-0 bg-muted cursor-pointer font-inherit text-foreground hover:bg-primary/5"
                      data-testid={`data-person-hit-${hit.id}`}
                      onClick={() => pickPerson(hit)}
                    >
                      <span className="font-medium">{hit.label}</span>
                      <span className="text-xs text-muted-foreground">{hit.detail}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : personQuery.trim().length >= 2 ? (
              <p className="text-sm text-muted-foreground m-0" data-testid="data-person-search-empty">
                No one matches "{personQuery}".
              </p>
            ) : null}
          </div>
          {personExportError && (
            <Alert variant="destructive" data-testid="data-person-export-error" role="alert">
              {personExportError}
            </Alert>
          )}
          <div>
            <Button
              variant="outline"
              data-testid="data-export-one-person-btn"
              disabled={!selectedPerson || personExportBusy}
              onClick={exportOnePerson}
            >
              {personExportBusy ? "Preparing…" : "Export one person"}
            </Button>
          </div>
        </div>

        {/* Remove one person */}
        <div className="flex flex-col gap-2 pt-2 border-t border-border" data-testid="data-remove-one-person">
          <p className="text-sm font-semibold text-foreground m-0">Remove one person</p>
          <p className="text-sm text-muted-foreground m-0">Not available yet.</p>
          <div>
            <Button variant="outline" disabled data-testid="data-remove-one-person-btn">
              Remove one person
            </Button>
          </div>
        </div>
      </section>

      {/* ── EXPORTS LIST ────────────────────────────────────────────────────────────────────── */}
      <section
        className="flex flex-col gap-2.5 p-4 rounded-lg bg-muted/50"
        data-testid="data-section-exports-list"
      >
        <h2 className="text-base font-semibold m-0 text-foreground">Exports</h2>
        {exportsList.length === 0 ? (
          <p className="text-sm text-muted-foreground m-0" data-testid="data-exports-empty">
            No exports yet.
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5 m-0 p-0 list-none" data-testid="data-exports-list">
            {exportsList.map((exp) => (
              <li
                key={exp.id}
                className="flex items-center gap-2.5 text-sm text-foreground"
                data-testid={`data-export-row-${exp.id}`}
              >
                <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
                  {exp.scope === "everything" ? "Everything" : exp.personName ?? "One person"}
                </span>
                <Badge variant={statusVariant(exp.status)}>{statusLabel(exp.status)}</Badge>
                {exp.downloadUrl && (
                  <a
                    className="text-primary no-underline text-xs hover:text-primary/80"
                    href={exp.downloadUrl}
                    data-testid={`data-export-download-${exp.id}`}
                  >
                    Download
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── AUDIT LOG ───────────────────────────────────────────────────────────────────────── */}
      <section
        className="flex flex-col gap-2.5 p-4 rounded-lg bg-muted/50"
        data-testid="data-section-audit"
      >
        <h2 className="text-base font-semibold m-0 text-foreground">Audit log</h2>
        {view?.lastChanged && (
          <p className="text-xs text-muted-foreground m-0">
            Changed by {view.lastChanged.by} on {auditWhen(view.lastChanged.at)}
          </p>
        )}
        {auditPreview.length === 0 ? (
          <p className="text-sm text-muted-foreground m-0" data-testid="data-audit-empty">
            Nothing recorded yet.
          </p>
        ) : (
          <ul className="flex flex-col gap-1 m-0 p-0 list-none" data-testid="data-audit-preview">
            {auditPreview.map((ev, idx) => (
              <li key={idx} className="flex justify-between gap-2.5 text-xs text-foreground">
                <span className="overflow-hidden text-ellipsis whitespace-nowrap">
                  {auditLine(ev)}
                </span>
                <span className="text-muted-foreground flex-shrink-0">{auditWhen(ev.at)}</span>
              </li>
            ))}
          </ul>
        )}
        <div>
          <Button variant="outline" data-testid="data-open-audit-log" onClick={(e) => goto(e, "/settings/developer/audit-log")}>
            Open full audit log
          </Button>
        </div>
      </section>
    </div>
  );
}
