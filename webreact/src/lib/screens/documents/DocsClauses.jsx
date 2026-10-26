// ═══════════════════════════════════════════════════════════════════════════════════════════════
// R6.007 — DocsClauses. Screen for managing reusable clause templates.
// Props: { path, params, app, onNavigate, onRefetch, testId }
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useEffect, useState } from "react";
import { request, ApiError } from "@/lib/api.js";
import DocsClausesTable from "./DocsClausesTable.jsx";
import DocsClausesClauseSheet from "./DocsClausesClauseSheet.jsx";
import { savedToast } from "@/lib/hooks/savedToast.js";
import useListBulk from "@/lib/lists/useListBulk.jsx";

export default function DocsClauses({
  path = null,
  params = null,
  app = null,
  onNavigate = null,
  onRefetch = null,
  testId = "docs-clauses",
}) {
  // Configuration
  const basePath = path || "/documents/clauses";
  const KIND_VALUES = ["yours", "standard"];
  const KIND_LABEL = { yours: "Yours", standard: "Standard" };

  // Data and phase state
  const [phase, setPhase] = useState("loading");
  const [error, setError] = useState(null);
  const [rows, setRows] = useState([]);

  // Sheet state
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetMode, setSheetMode] = useState("create");
  const [sheetId, setSheetId] = useState(null);
  const [sheetName, setSheetName] = useState("");
  const [sheetGist, setSheetGist] = useState("");
  const [sheetKind, setSheetKind] = useState("yours");
  const [sheetBody, setSheetBody] = useState("");
  const [sheetBusy, setSheetBusy] = useState(false);
  const [sheetError, setSheetError] = useState(null);

  // Fetch clauses
  async function load() {
    setPhase("loading");
    setError(null);
    try {
      const res = await request("/api/documents/clauses");
      const data = Array.isArray(res?.data) ? res.data : [];
      setRows(data);
      setPhase(data.length === 0 ? "empty" : "ready");
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

  // §13.3 — selection + bulk Delete come from the shared hook; this screen writes no delete code of its own
  const bulk = useListBulk({ app, path: basePath, rank: app?.nav?.rank ?? null, rows, onChanged: app ? null : load });

  // Load on mount and when app.refetchSignal changes
  useEffect(() => {
    load();
  }, [app?.refetchSignal]);

  // Handle initial ?new=1 query param
  useEffect(() => {
    if (typeof window === "undefined") return;
    const qp = new URLSearchParams(window.location.search);
    if (qp.get("new") === "1") {
      openCreate();
      window.history.replaceState(window.history.state, "", window.location.pathname);
    }
  }, []);

  // Sheet handlers
  function openCreate() {
    setSheetMode("create");
    setSheetId(null);
    setSheetName("");
    setSheetGist("");
    setSheetKind("yours");
    setSheetBody("");
    setSheetError(null);
    setSheetOpen(true);
  }

  function openEdit(row) {
    setSheetMode("edit");
    setSheetId(row.id);
    setSheetName(row.name);
    setSheetGist(row.gist);
    setSheetKind(row.kind);
    setSheetBody("");
    setSheetError(null);
    setSheetOpen(true);
  }

  function closeSheet() {
    if (sheetBusy) return;
    setSheetOpen(false);
  }

  async function submitSheet(e) {
    e?.preventDefault?.();
    if (sheetBusy) return;
    if (!sheetName.trim()) {
      setSheetError("a clause needs a name");
      return;
    }
    if (!sheetGist.trim()) {
      setSheetError("a clause needs a one-line gist");
      return;
    }
    if (sheetMode === "create" && !sheetBody.trim()) {
      setSheetError("a new clause needs the words it says");
      return;
    }

    setSheetBusy(true);
    setSheetError(null);
    try {
      if (sheetMode === "create") {
        await request("/api/documents/clauses", {
          method: "POST",
          body: {
            name: sheetName.trim(),
            gist: sheetGist.trim(),
            kind: sheetKind,
            blocks: [{ type: "prose", text: sheetBody.trim() }],
          },
        });
      } else {
        await request("/api/documents/clauses/update", {
          method: "POST",
          body: {
            id: sheetId,
            name: sheetName.trim(),
            gist: sheetGist.trim(),
            kind: sheetKind,
          },
        });
      }
      savedToast(sheetMode === "create" ? "Clause created" : "Clause updated");
      setSheetOpen(false);
      await load();
      onRefetch?.();
    } catch (err) {
      setSheetError(
        err instanceof ApiError
          ? `${err.message}${err.requestId ? ` (ref ${err.requestId})` : ""}`
          : String(err?.message ?? err)
      );
    } finally {
      setSheetBusy(false);
    }
  }

  // Derived values
  const summary =
    rows.length === 0
      ? ""
      : `${rows.length} clause${rows.length === 1 ? "" : "s"}. Write one once and drop it into any agreement.`;

  function actionsFor(row) {
    return [{ id: "edit", label: "Edit", onRun: () => openEdit(row) }];
  }

  return (
    <>
      <DocsClausesTable
        onNavigate={onNavigate}
        testId={testId}
        basePath={basePath}
        phase={phase}
        error={error}
        rows={rows}
        summary={summary}
        openCreate={openCreate}
        actionsFor={actionsFor}
        bulk={bulk}
      />
      <DocsClausesClauseSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        testId="clause-sheet"
        KIND_VALUES={KIND_VALUES}
        KIND_LABEL={KIND_LABEL}
        error={error}
        rows={rows}
        sheetMode={sheetMode}
        sheetName={sheetName}
        sheetGist={sheetGist}
        sheetKind={sheetKind}
        sheetBody={sheetBody}
        sheetBusy={sheetBusy}
        sheetError={sheetError}
        closeSheet={closeSheet}
        submitSheet={submitSheet}
        onNameChange={setSheetName}
        onGistChange={setSheetGist}
        onKindChange={setSheetKind}
        onBodyChange={setSheetBody}
      />
    </>
  );
}
