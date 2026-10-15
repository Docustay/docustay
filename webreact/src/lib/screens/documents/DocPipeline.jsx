import { useEffect, useState } from "react";
import { request, ApiError } from "@/lib/api.js";
import WorklistPage from "@/lib/lists/WorklistPage.jsx";
import ScreenState from "@/lib/empty/ScreenState.jsx";
import StatusBadge from "@/lib/components/kit/StatusBadge.jsx";
import { Button } from "@/lib/components/ui/button.jsx";
import { formatValue } from "@/lib/format.js";
import DocPipelineDocPipelineTable from "./DocPipelineDocPipelineTable.jsx";

export default function DocPipeline({ path = "/documents/pipeline", params = null, app = null, onNavigate = null, onRefetch = null }) {
  // Data fetching
  const [pipelineRows, setPipelineRows] = useState(null);
  const [contractRows, setContractRows] = useState(null);
  const [formRows, setFormRows] = useState(null);
  const [executedRows, setExecutedRows] = useState(null);
  const [fetchError, setFetchError] = useState(null);
  const [fetchDenied, setFetchDenied] = useState(false);

  function go(href) {
    if (onNavigate) onNavigate(href);
    else window.location.assign(href);
  }

  function openRecord(row) {
    go(`/record/document/${row.id}`);
  }

  async function load() {
    setFetchError(null);
    setFetchDenied(false);
    setPipelineRows(null);
    setContractRows(null);
    setFormRows(null);
    setExecutedRows(null);
    try {
      const [p, c, f, e] = await Promise.all([
        request("/api/list/documents/pipeline"),
        request("/api/list/documents/contracts/all"),
        request("/api/list/documents/forms/all"),
        request("/api/list/documents/executed"),
      ]);
      setPipelineRows(p.rows ?? []);
      setContractRows(c.rows ?? []);
      setFormRows(f.rows ?? []);
      setExecutedRows(e.rows ?? []);
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) setFetchDenied(true);
      setFetchError(err);
    }
  }

  // Load on mount and when app.refetchSignal changes
  useEffect(() => {
    load();
  }, [app?.refetchSignal]);

  // Derived values
  const loaded =
    pipelineRows !== null && contractRows !== null && formRows !== null && executedRows !== null;

  const phase = (() => {
    if (fetchDenied) return "denied";
    if (fetchError) return "error";
    if (!loaded) return "loading";
    return "ready";
  })();

  function typeLabel(row) {
    return row.builder === "form" ? "Form" : "Agreement";
  }

  const draftBand = [...(contractRows ?? []), ...(formRows ?? [])].filter((r) => r.state === "draft");
  const sentBand = (pipelineRows ?? []).filter((r) => r.band === "sent" || r.band === "partially_signed");
  const openedBand = (pipelineRows ?? []).filter((r) => r.band === "opened");
  const signedBand = executedRows ?? [];

  const displayPhase = (() => {
    if (phase !== "ready") return phase;
    const nothingOut = draftBand.length === 0 && sentBand.length === 0 && openedBand.length === 0 && signedBand.length === 0;
    return nothingOut ? "empty" : "ready";
  })();

  const outCount = draftBand.length + sentBand.length + openedBand.length;
  const staleCount = [...sentBand, ...openedBand].filter(
    (r) => typeof r.age_days === "number" && r.age_days >= 7
  ).length;

  const NUMBER_WORDS = ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"];
  function numberText(n) {
    if (Number.isInteger(n) && n >= 0 && n <= 10) return NUMBER_WORDS[n];
    return String(n);
  }

  const summaryText = (() => {
    if (phase !== "ready") return null;
    if (outCount === 0 && signedBand.length === 0) return "Nothing is out with anyone.";
    const base = `${numberText(outCount)} out.`;
    if (staleCount === 0) return base;
    return `${base} ${numberText(staleCount)} ${staleCount === 1 ? "has" : "have"} been sitting unsigned for over a week.`;
  })();

  function ageChip(row) {
    if (typeof row.age_days !== "number") return null;
    return row.age_days === 0 ? "Sent today" : `Sent ${row.age_days} day${row.age_days === 1 ? "" : "s"} ago`;
  }

  function remindersChip(row) {
    if (typeof row.reminders_sent !== "number" || row.reminders_sent === 0) return null;
    return `Reminded ${numberText(row.reminders_sent).toLowerCase()} time${row.reminders_sent === 1 ? "" : "s"}`;
  }

  function openedChip(row) {
    if (typeof row.open_count !== "number" || row.open_count === 0) return null;
    return `Opened ${row.open_count} time${row.open_count === 1 ? "" : "s"}`;
  }

  function signedLine(row) {
    const when = formatValue(row.executed_at, "datetime");
    const hasParent = Array.isArray(row.signer_config) && row.signer_config.includes("parent");
    const allSigned = typeof row.signatures === "number" && Array.isArray(row.signer_config) && row.signatures >= row.signer_config.length;
    return hasParent && allSigned ? `Signed ${when}, parent too` : `Signed ${when}`;
  }

  return (
    <WorklistPage
      title="Documents in flight"
      summary={summaryText}
      headerAction={{ label: "Send one", onClick: () => go("/documents/contracts/all?new=1") }}
      testId="doc-pipeline"
    >
      {displayPhase === "empty" && (
        <div className="rounded-[11px] border border-line bg-surface p-14 text-center" data-state="empty" data-kind="first-run" data-testid="pipeline-empty-rich" role="status">
          <p className="m-0 mb-[7px] text-[17px] font-medium text-ink" data-testid="pipeline-empty-headline">
            Nothing waiting on anybody
          </p>
          <p className="mx-auto mb-[18px] max-w-[46ch] text-sm text-mute leading-relaxed" data-testid="pipeline-empty-line">
            This fills up on its own once documents start going out — drafted, sent, opened, signed. The useful column is the one in the middle: people who read it and didn't sign.
          </p>
          <div className="flex flex-wrap gap-4 justify-center">
            <Button data-testid="pipeline-empty-send" onClick={() => go("/documents/contracts/all?new=1")}>
              Send a document
            </Button>
            <Button variant="outline" data-testid="pipeline-empty-attach" onClick={() => go("/items/services")}>
              Attach one to a service instead
            </Button>
          </div>
          <p className="m-0 mt-5 pt-5 border-t border-line-soft text-xs text-mute leading-relaxed">
            Attaching it to a service means it goes out the moment somebody books, rather than when you remember.
          </p>
        </div>
      )}

      {displayPhase !== "empty" && (
        <ScreenState
          phase={displayPhase}
          error={phase === "error" ? fetchError : null}
          reason={phase === "denied" ? fetchError?.message ?? null : null}
          empty={{ kind: "first-run", headline: "Nothing waiting on anybody", line: "" }}
          onNavigate={go}
          subject="Documents in flight"
          onRetry={load}
        >
          {displayPhase === "ready" && (
            <DocPipelineDocPipelineTable
              onNavigate={go}
              go={go}
              openRecord={openRecord}
              fetchError={fetchError}
              load={load}
              phase={phase}
              typeLabel={typeLabel}
              draftBand={draftBand}
              sentBand={sentBand}
              openedBand={openedBand}
              signedBand={signedBand}
              displayPhase={displayPhase}
              summaryText={summaryText}
              ageChip={ageChip}
              remindersChip={remindersChip}
              openedChip={openedChip}
              signedLine={signedLine}
            />
          )}
        </ScreenState>
      )}
    </WorklistPage>
  );
}
