// ═══════════════════════════════════════════════════════════════════════════════════════════════
// DocsSent — the maintainer's ruling, 29 Sep 2026 (documents island): ONE list of everything sent, any builder,
// split by STATE — All · Waiting · Signed · Declined · Expired. Replaces Pipeline/Contracts/Forms/
// Executed as the sidebar's own destination for "what did we send and how did it end".
// Props: { path, params, app, onNavigate, onRefetch }
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useEffect, useState } from "react";
import { request, ApiError } from "@/lib/api.js";
import LedgerPage from "@/lib/lists/LedgerPage.jsx";
import ScreenState from "@/lib/empty/ScreenState.jsx";
import StatusBadge from "@/lib/components/kit/StatusBadge.jsx";
import { formatValue } from "@/lib/format.js";

const VIEWS = [
  { key: "all",      label: "All",      path: "/documents/sent/all" },
  { key: "waiting",  label: "Waiting",  path: "/documents/sent/waiting" },
  { key: "signed",   label: "Signed",   path: "/documents/sent/signed" },
  { key: "declined", label: "Declined", path: "/documents/sent/declined" },
  { key: "expired",  label: "Expired",  path: "/documents/sent/expired" },
];
const VIEW_FROM_SEGMENT = Object.freeze(
  Object.fromEntries(VIEWS.map((v) => [v.path.split("/").pop(), v.key]))
);

const STATE_TONE = Object.freeze({
  sent: "warn", partially_signed: "warn",
  executed: "ok",
  declined: "bad", expired: "bad", void: "neutral",
});
const STATE_LABEL = Object.freeze({
  sent: "Sent", partially_signed: "Partially signed",
  executed: "Signed", declined: "Declined", expired: "Expired", void: "Void",
});

export default function DocsSent({
  path = "/documents/sent/all",
  params = null,
  app = null,
  onNavigate = null,
  onRefetch = null,
}) {
  function go(href) {
    if (onNavigate) onNavigate(href);
    else window.location.assign(href);
  }
  function openRecord(row) {
    go(`/record/document/${row.id}`);
  }

  const initialSegment = path.split("/").pop();
  const [activeView, setActiveView] = useState(VIEW_FROM_SEGMENT[initialSegment] ?? "all");
  useEffect(() => {
    const seg = path.split("/").pop();
    setActiveView(VIEW_FROM_SEGMENT[seg] ?? "all");
  }, [path]);

  const [rows, setRows] = useState(null);
  const [fetchError, setFetchError] = useState(null);
  const [fetchDenied, setFetchDenied] = useState(false);

  async function load() {
    setFetchError(null);
    setFetchDenied(false);
    setRows(null);
    const view = VIEWS.find((v) => v.key === activeView) ?? VIEWS[0];
    try {
      const result = await request(`/api/list${view.path}`);
      setRows(result.rows ?? []);
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) setFetchDenied(true);
      setFetchError(err);
    }
  }

  useEffect(() => {
    load();
  }, [activeView, app?.refetchSignal]);

  function selectView(key) {
    const view = VIEWS.find((v) => v.key === key) ?? VIEWS[0];
    setActiveView(key);
    go(view.path);
  }

  const phase = fetchDenied ? "denied" : fetchError ? "error" : rows === null ? "loading" : "ready";
  const displayPhase = phase === "ready" && rows.length === 0 ? "empty" : phase;

  const NUMBER_WORDS = ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"];
  function numberText(n) {
    if (Number.isInteger(n) && n >= 0 && n <= 10) return NUMBER_WORDS[n];
    return String(n);
  }
  const summaryText = phase === "ready"
    ? (rows.length === 0 ? null : `${numberText(rows.length)} document${rows.length === 1 ? "" : "s"}.`)
    : null;

  const emptyProp = (() => {
    const view = VIEWS.find((v) => v.key === activeView) ?? VIEWS[0];
    if (activeView === "all") {
      return {
        kind: "blocked",
        headline: "Nothing sent yet",
        line: "Every agreement or form sent, opened, signed or declined.",
        action: { label: "Send a document", onClick: () => go("/documents/templates/new") },
      };
    }
    return {
      kind: "filtered",
      headline: `Nothing ${view.label.toLowerCase()}`,
      line: "Try a different tab.",
      action: null,
    };
  })();

  return (
    <LedgerPage
      title="Sent"
      summary={summaryText}
      primary={{ label: "Send a document", onClick: () => go("/documents/templates/new") }}
      views={VIEWS.map(({ key, label }) => ({ key, label }))}
      activeView={activeView}
      onView={selectView}
      testId="docs-sent"
    >
      <ScreenState
        phase={displayPhase}
        error={phase === "error" ? fetchError : null}
        reason={phase === "denied" ? (fetchError?.message ?? null) : null}
        empty={emptyProp}
        onNavigate={go}
        subject="Sent documents"
        onRetry={load}
      >
        {displayPhase === "ready" && (
          <div className="overflow-auto rounded-card border border-line bg-surface" data-testid="docs-sent-table">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className="h-9 border-b border-line bg-surface-sunken px-4 py-0 text-left text-caption font-medium text-mute">Document</th>
                  <th className="h-9 border-b border-line bg-surface-sunken px-4 py-0 text-left text-caption font-medium text-mute">Subject</th>
                  <th className="h-9 border-b border-line bg-surface-sunken px-4 py-0 text-left text-caption font-medium text-mute">Type</th>
                  <th className="h-9 border-b border-line bg-surface-sunken px-4 py-0 text-left text-caption font-medium text-mute">Sent</th>
                  <th className="h-9 border-b border-line bg-surface-sunken px-4 py-0 text-left text-caption font-medium text-mute">State</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.id}
                    className="cursor-pointer hover:bg-paper"
                    data-testid="docs-sent-row"
                    data-id={row.id}
                    onClick={() => openRecord(row)}
                  >
                    <td className="h-10 border-b border-line-soft px-4 py-0 text-ui">{row.title}</td>
                    <td className="h-10 border-b border-line-soft px-4 py-0 text-ui">{row.subject ?? "—"}</td>
                    <td className="h-10 border-b border-line-soft px-4 py-0 text-ui">{row.builder === "form" ? "Form" : "Agreement"}</td>
                    <td className="h-10 border-b border-line-soft px-4 py-0 text-ui">{formatValue(row.sent_at, "date", { empty: "—" })}</td>
                    <td className="h-10 border-b border-line-soft px-4 py-0 text-ui">
                      <StatusBadge label={STATE_LABEL[row.state] ?? row.state} tone={STATE_TONE[row.state] ?? "neutral"} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </ScreenState>
    </LedgerPage>
  );
}
