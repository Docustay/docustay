// ═══════════════════════════════════════════════════════════════════════════════════════════════
// R8.020 — SetImport: `/settings/import` (`SetImport`).
//
// Ported from webui/src/lib/screens/SetImport.svelte — markup/data/handlers ported; styles are
// Tailwind + kit components only. Archetype: DecisionModal + kit components.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useState, useRef, useMemo } from "react";
import { api, ApiError } from "@/lib/api.js";
import { Button } from "@/lib/components/ui/button.jsx";
import { Badge } from "@/lib/components/ui/badge.jsx";
import { Checkbox } from "@/lib/components/ui/checkbox.jsx";
import { NativeSelect, NativeSelectOption } from "@/lib/components/ui/native-select.jsx";
import { Skeleton } from "@/lib/components/ui/skeleton.jsx";
import DecisionModal from "@/lib/forms/DecisionModal.jsx";
import SetImportTable1Table from "@/lib/screens/SetImportTable1Table.jsx";
import SetImportImportUndoConfirm from "@/lib/screens/SetImportImportUndoConfirm.jsx";

const SOURCE_SENTENCES = {
  mindbody: "We know its export inside out. Nothing to line up by hand.",
  vagaro: "Same — we know the columns.",
  boulevard: "Same.",
  practice_better: "Same.",
  simplepractice: "Same.",
  acuity_square: "Same.",
  spreadsheet: "We'll work out what your columns mean and ask about anything we're unsure of.",
  other: "Send us what you've got and we'll do the whole thing for you. Free.",
};

const NAMED_PLATFORM_KEYS = new Set([
  "mindbody", "vagaro", "boulevard", "practice_better", "simplepractice", "acuity_square",
]);

const TRACKER = [
  { key: "source", label: "Where from" },
  { key: "file", label: "Your file" },
  { key: "checked", label: "Check it over" },
  { key: "done", label: "Bring it in" },
];

function trackerGroup(s) {
  if (s === "source") return 0;
  if (s === "upload" || s === "mapping") return 1;
  if (s === "checked") return 2;
  return 3; // 'done'
}

function slugifyFieldKey(col) {
  let k = String(col ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  if (!k) k = "field";
  if (!/^[a-z]/.test(k)) k = `f_${k}`;
  return k;
}

function guessField(col) {
  const c = col.trim().toLowerCase();
  if (c.includes("first")) return "first_name";
  if (c.includes("last")) return "last_name";
  if (c.includes("email")) return "email";
  if (c.includes("mobile") || c.includes("phone")) return "mobile_phone";
  if (c.includes("birth") || c === "dob") return "date_of_birth";
  return "";
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export default function SetImport({
  view = null,
  onNavigate = null,
  onDone = null,
  defaultStep = "source",
  defaultState = null,
}) {
  const fieldOptions = view?.fieldOptions ?? [];
  const maxRows = view?.maxRows ?? 5000;
  const sources = view?.sources ?? [];

  const initialState = defaultState || {
    step: defaultStep,
    sourceKey: null,
    filename: "",
    importRunId: null,
    columns: [],
    sampleRows: [],
    mapping: {},
    duplicatePolicy: "skip",
    marketingConsentConfirmed: false,
    checkResult: null,
    runResult: null,
    fieldsCreated: {},
    busy: false,
    error: null,
    undone: false,
    undoOpen: false,
  };

  const [step, setStep] = useState(initialState.step);
  const [sourceKey, setSourceKey] = useState(initialState.sourceKey);
  const [filename, setFilename] = useState(initialState.filename);
  const [importRunId, setImportRunId] = useState(initialState.importRunId);
  const [columns, setColumns] = useState(initialState.columns);
  const [sampleRows, setSampleRows] = useState(initialState.sampleRows);
  const [mapping, setMapping] = useState(initialState.mapping);
  const [duplicatePolicy, setDuplicatePolicy] = useState(initialState.duplicatePolicy);
  const [marketingConsentConfirmed, setMarketingConsentConfirmed] = useState(initialState.marketingConsentConfirmed);
  const [checkResult, setCheckResult] = useState(initialState.checkResult);
  const [runResult, setRunResult] = useState(initialState.runResult);
  const [fieldsCreated, setFieldsCreated] = useState(initialState.fieldsCreated);
  const [busy, setBusy] = useState(initialState.busy);
  const [error, setError] = useState(initialState.error);
  const [undone, setUndone] = useState(initialState.undone);
  const [undoOpen, setUndoOpen] = useState(initialState.undoOpen);

  const fileInput = useRef(null);

  const sourceLabel = useMemo(() => {
    return sources.find((s) => s.key === sourceKey)?.label ?? null;
  }, [sources, sourceKey]);

  const showSourceSentence = useMemo(() => {
    return Boolean(sourceKey && NAMED_PLATFORM_KEYS.has(sourceKey) && sourceLabel);
  }, [sourceKey, sourceLabel]);

  const currentGroup = trackerGroup(step);

  const duplicateCount = useMemo(() => {
    return (checkResult?.toFillBlanksOn ?? 0) + (checkResult?.duplicatesSkipped ?? 0);
  }, [checkResult]);

  function fieldLabelFor(key) {
    return fieldOptions.find((o) => o.key === key)?.label ?? key;
  }

  function exampleFor(col) {
    return sampleRows.slice(0, 3).map((r) => r[col]).filter((v) => v).join(" · ");
  }

  function goto(e, href) {
    e?.preventDefault?.();
    onNavigate?.(href);
  }

  function chooseSource(key) {
    setSourceKey(key);
  }

  function continueFromSource() {
    if (!sourceKey) return;
    setStep("upload");
  }

  function openFilePicker() {
    fileInput.current?.click();
  }

  async function onFileChosen(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const dataBase64 = await readFileAsBase64(file);
      const res = await api.startImport({ filename: file.name, dataBase64 });
      setFilename(file.name);
      setImportRunId(res.importRunId);
      setColumns(res.columns);
      setSampleRows(res.sampleRows);
      const initialMapping = Object.fromEntries(res.columns.map((c) => [c, guessField(c)]));
      setMapping(initialMapping);
      setFieldsCreated({});
      setStep("mapping");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err?.message ?? err));
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function runCheck() {
    if (busy) return;
    setBusy(true);
    setError(null);
    setCheckResult(null);
    setStep("checked");
    try {
      const sentMapping = Object.fromEntries(
        Object.entries(mapping).map(([col, key]) => [col, key === "" ? null : key])
      );
      await api.setImportMapping(importRunId, {
        sourceKey,
        mapping: sentMapping,
        duplicatePolicy,
        marketingConsentConfirmed,
      });
      const result = await api.checkImport(importRunId);
      setCheckResult(result);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err?.message ?? err));
      setStep("mapping");
    } finally {
      setBusy(false);
    }
  }

  async function runImport() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.runImport(importRunId);
      setRunResult(result);
      setStep("done");
      onDone?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err?.message ?? err));
    } finally {
      setBusy(false);
    }
  }

  function backToMapping() {
    setStep("mapping");
    setError(null);
  }

  async function undoThisImport() {
    if (busy || undone) return;
    setBusy(true);
    setError(null);
    try {
      await api.undoImport(importRunId);
      setUndone(true);
      setUndoOpen(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err?.message ?? err));
    } finally {
      setBusy(false);
    }
  }

  async function makeFieldForIt(col) {
    if (busy || fieldsCreated[col]) return;
    setBusy(true);
    setError(null);
    try {
      if (typeof api.createCustomField !== "function") {
        throw new Error(
          "Creating a field from here isn't available yet — add it from Settings › Fields, " +
          "then come back and map this column to it."
        );
      }
      await api.createCustomField({
        recordType: "person",
        key: slugifyFieldKey(col),
        label: col,
        kind: "text",
      });
      setFieldsCreated((prev) => ({ ...prev, [col]: true }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err?.message ?? err));
    } finally {
      setBusy(false);
    }
  }

  function handleMappingChange(col, value) {
    setMapping((prev) => ({ ...prev, [col]: value }));
  }

  return (
    <div className="flex flex-col max-w-4xl" data-testid="settings-import">
      <p className="text-xs text-muted-foreground mb-4">
        <a href="/settings" onClick={(e) => goto(e, "/settings")} className="text-primary hover:text-primary-hover">
          Settings
        </a>
        {" › "}Data and audit
      </p>
      <h1 className="text-2xl font-medium -tracking-wider mb-1">Import clients</h1>
      <p className="text-sm text-muted-foreground mb-4" data-testid="import-subtitle">
        {filename
          ? `${filename}${sampleRows.length || columns.length ? ` · ${sampleRows.length} rows shown` : ""}`
          : `Up to ${maxRows} rows per file.`}
      </p>

      {/* TRACKER */}
      <div className="flex gap-2 items-center mb-4 text-sm" data-testid="import-tracker">
        {TRACKER.map((t, i) => {
          const trackState = currentGroup === i ? "current" : currentGroup > i ? "done" : "future";
          return (
            <div key={t.key}>
              <span
                className={`flex items-center gap-1.5 ${
                  trackState === "done"
                    ? "text-green-600"
                    : trackState === "current"
                      ? "text-ink font-semibold"
                      : "text-muted-foreground"
                }`}
                data-testid={`import-tracker-${t.key}`}
              >
                <span
                  className={`inline-flex items-center justify-center w-5.5 h-5.5 rounded-full text-xs font-medium ${
                    trackState === "done"
                      ? "bg-green-100 text-green-600"
                      : trackState === "current"
                        ? "bg-primary text-white"
                        : "bg-surface-sunken text-muted-foreground"
                  }`}
                >
                  {trackState === "done" ? "✓" : i + 1}
                </span>
                {t.label}
              </span>
              {i < TRACKER.length - 1 && <span className="text-line-soft mx-2">—</span>}
            </div>
          );
        })}
      </div>

      {error && (
        <p className="text-sm text-destructive mb-3 rounded-card" role="alert" data-testid="import-error">
          {error}
        </p>
      )}

      {step === "source" && (
        <div className="space-y-4" data-testid="import-source-panel">
          <p className="text-sm text-muted-foreground max-w-prose">
            If it's one of these, you won't have to match up a single column. We already know what
            their exports look like.
          </p>
          <div className="flex flex-col gap-2">
            {sources.map((s) => (
              <button
                key={s.key}
                type="button"
                className={`flex gap-3 items-start p-3.5 border rounded-xl text-left transition-colors ${
                  sourceKey === s.key
                    ? "border-primary bg-blue-50"
                    : "border-line-soft bg-surface hover:bg-surface-sunken"
                }`}
                data-testid={`import-source-${s.key}`}
                aria-pressed={sourceKey === s.key}
                onClick={() => chooseSource(s.key)}
              >
                <span
                  className={`w-4.5 h-4.5 rounded-full border-2 flex-shrink-0 mt-0.5 transition-all ${
                    sourceKey === s.key
                      ? "border-primary bg-primary"
                      : "border-line-soft"
                  }`}
                />
                <div className="flex flex-col gap-1">
                  <b className="text-sm text-ink font-medium">{s.label}</b>
                  <span className="text-xs text-muted-foreground">{SOURCE_SENTENCES[s.key] ?? ""}</span>
                </div>
              </button>
            ))}
          </div>
          <div className="flex gap-2 pt-4">
            <Button disabled={!sourceKey} onClick={continueFromSource} data-testid="import-source-continue">
              Continue
            </Button>
          </div>
        </div>
      )}

      {step === "upload" && (
        <>
          <div className="flex flex-col items-start gap-3 p-8 border border-dashed border-line-soft rounded-lg bg-surface-sunken mb-4" data-testid="import-upload-panel">
            <p className="text-sm text-muted-foreground m-0">
              Choose a CSV exported from Carepatron, Square, SimplePractice or any spreadsheet.
            </p>
            <input
              ref={fileInput}
              type="file"
              accept=".csv,text/csv"
              hidden
              onChange={onFileChosen}
              data-testid="import-file-input"
            />
            <Button disabled={busy} onClick={openFilePicker} data-testid="import-choose-file">
              {busy ? "Reading…" : "Import a file"}
            </Button>
          </div>
          <div className="flex gap-2 justify-start">
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setStep("source")}
              data-testid="import-back-source"
            >
              Back
            </Button>
          </div>
        </>
      )}

      {step === "mapping" && (
        <>
          <div className="mb-4 overflow-auto rounded-lg border border-line bg-surface" data-testid="import-mapping-table">
            <SetImportTable1Table
              fieldOptions={fieldOptions}
              columns={columns}
              mapping={mapping}
              exampleFor={exampleFor}
              onMappingChange={handleMappingChange}
            />
          </div>

          <div
            className="flex items-center gap-3 p-4 rounded-lg bg-[var(--notice-wash)] border border-[var(--notice-wash)] mb-4"
            data-testid="import-duplicate-banner"
          >
            <span className="flex-1 text-sm text-[var(--notice-ink)]">
              <strong>Some people may already exist</strong> (same email). Choose: skip them, or fill in
              only blank fields. Nothing existing is overwritten.
            </span>
            <div className="flex gap-2 flex-shrink-0">
              <Button
                variant={duplicatePolicy === "skip" ? "default" : "outline"}
                size="sm"
                onClick={() => setDuplicatePolicy("skip")}
                data-testid="import-policy-skip"
              >
                Skip them
              </Button>
              <Button
                variant={duplicatePolicy === "fill_blank" ? "default" : "outline"}
                size="sm"
                onClick={() => setDuplicatePolicy("fill_blank")}
                data-testid="import-policy-fill"
              >
                Fill in blank fields
              </Button>
            </div>
          </div>

          <div className="flex items-center gap-2 mb-4">
            <Checkbox
              id="import-consent"
              checked={marketingConsentConfirmed}
              onCheckedChange={setMarketingConsentConfirmed}
              data-testid="import-consent"
            />
            <label htmlFor="import-consent" className="text-sm text-ink cursor-pointer">
              I confirm these people can be added to marketing lists.
            </label>
          </div>

          <div className="flex gap-2 justify-end">
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setStep("upload")}
              data-testid="import-back"
            >
              Back
            </Button>
            <Button disabled={busy} onClick={runCheck} data-testid="import-check">
              {busy ? "Checking…" : `Check ${columns.length ? sampleRows.length : ""} rows`}
            </Button>
          </div>
        </>
      )}

      {step === "checked" && (
        <>
          {busy && !checkResult ? (
            <div className="flex flex-col gap-1 py-2" data-testid="import-check-loading">
              <h1 className="text-2xl font-medium -tracking-wider mt-0 mb-2">Here's what we found</h1>
              <Skeleton className="h-3.5 mb-2.5 w-full" />
              <Skeleton className="h-3.5 mb-2.5 w-70%" />
              <div className="flex gap-4 mb-5">
                <Skeleton className="flex-1 h-18 rounded-lg" />
                <Skeleton className="flex-1 h-18 rounded-lg" />
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-1 py-2" data-testid="import-check-summary">
              <h1 className="text-2xl font-medium -tracking-wider mt-0 mb-2">Here's what we found</h1>
              <p className="text-sm text-muted-foreground max-w-prose mb-5">
                {showSourceSentence && (
                  <>
                    You came from <strong>{sourceLabel}</strong>, so we already know what its columns mean.{" "}
                  </>
                )}
                Nothing has been written yet — and if this goes wrong, one button puts it all back.
              </p>

              <div className="flex gap-4 mb-5" data-testid="import-counts-strip">
                <div className="flex-1 flex flex-col gap-1 p-3.5 border border-line rounded-lg bg-surface">
                  <div className="text-lg font-medium text-ink">{checkResult?.counts?.clients ?? 0}</div>
                  <div className="text-xs text-muted-foreground">clients</div>
                  <div className="text-xs text-muted-foreground">
                    {checkResult?.counts?.cardsOnFile ?? 0} of them have a card on file
                  </div>
                </div>
                <div className="flex-1 flex flex-col gap-1 p-3.5 border border-line rounded-lg bg-surface">
                  <div className="text-lg font-medium text-ink">{checkResult?.counts?.couldNotWorkOut ?? 0}</div>
                  <div className="text-xs text-muted-foreground">we couldn't work out</div>
                  <div className="text-xs text-muted-foreground">You can fix them now or later</div>
                </div>
              </div>

              {(checkResult?.issues ?? []).length > 0 && (
                <div className="border border-line rounded-lg mb-4 overflow-hidden" data-testid="import-issues-block">
                  <p className="m-0 p-3 border-b border-line bg-surface-sunken font-medium text-sm text-ink">
                    The {checkResult.issues.length}
                  </p>
                  {checkResult.issues.map((issue, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between gap-3 p-2.5 border-b border-line last:border-b-0 text-sm text-ink"
                      data-testid={`import-issue-${i}`}
                    >
                      <span className="flex-1">{issue.sentence}</span>
                      <span className="inline-flex items-center h-5 px-2 rounded text-xs font-medium bg-[var(--chip-warn-bg)] text-[var(--chip-warn-ink)] flex-shrink-0">
                        Decide
                      </span>
                    </div>
                  ))}
                </div>
              )}

              <div className="border border-line rounded-lg mb-4 overflow-hidden" data-testid="import-mapping-summary">
                <p className="m-0 p-3 border-b border-line bg-surface-sunken font-medium text-sm text-ink">
                  What lines up with what
                </p>
                {columns.map((col) => (
                  <div
                    key={col}
                    className="flex items-center justify-between gap-3 p-2.5 border-b border-line last:border-b-0 text-sm text-ink"
                    data-testid={`import-mapping-row-${col}`}
                  >
                    <span className="flex-1">
                      {col}{" "}
                      <span className="text-muted-foreground">
                        → {mapping[col] ? fieldLabelFor(mapping[col]) : "nothing, yet"}
                      </span>
                    </span>
                    {mapping[col] ? (
                      <Badge variant="secondary">Certain</Badge>
                    ) : fieldsCreated[col] ? (
                      <span
                        className="inline-flex items-center h-5 px-2 rounded text-xs font-medium bg-surface-sunken text-muted-foreground flex-shrink-0"
                        data-testid={`import-field-made-${col}`}
                      >
                        Field created — not filled by this import
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="inline-flex items-center h-5 px-2 rounded text-xs font-medium bg-[var(--chip-warn-bg)] text-[var(--chip-warn-ink)] hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed flex-shrink-0"
                        data-testid={`import-make-field-${col}`}
                        disabled={busy}
                        onClick={() => makeFieldForIt(col)}
                      >
                        Make a field for it?
                      </button>
                    )}
                  </div>
                ))}
              </div>

              {(checkResult?.errors ?? []).length > 0 && (
                <>
                  <p
                    className="text-sm font-semibold text-destructive mb-2"
                    data-testid="import-check-errors"
                  >
                    {checkResult.errors.length} row{checkResult.errors.length === 1 ? "" : "s"} cannot be
                    imported:
                  </p>
                  <ul className="pl-5 text-sm text-muted-foreground space-y-1">
                    {checkResult.errors.map((e, i) => (
                      <li key={i}>
                        Row {e.row}: {e.message}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}

          <div className="flex gap-2 justify-end mt-4">
            <Button
              variant="outline"
              disabled={busy}
              onClick={backToMapping}
              data-testid="import-back-2"
            >
              Back
            </Button>
            <Button disabled={busy || !checkResult} onClick={runImport} data-testid="import-run">
              {!checkResult ? "Checking…" : busy ? "Importing…" : `Import ${checkResult?.toCreate ?? 0} people`}
            </Button>
          </div>
        </>
      )}

      {step === "done" && (
        <>
          <div className="flex flex-col items-start gap-2 py-6" data-testid="import-done">
            <p className="text-lg font-semibold text-ink m-0">Import complete.</p>
            <p className="text-sm text-muted-foreground m-0">
              {runResult?.created ?? 0} created · {runResult?.filledBlanks ?? 0} filled in ·
              {runResult?.skipped ?? 0} skipped · {runResult?.errors ?? 0} errors.
            </p>
            {undone && (
              <p className="text-sm text-muted-foreground m-0" data-testid="import-undone">
                The people this import created have been archived.
              </p>
            )}
            <div className="flex gap-2 justify-start pt-2">
              <Button onClick={(e) => goto(e, "/people")} data-testid="import-done-people">
                See People
              </Button>
              {(runResult?.created ?? 0) > 0 && !undone && (
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => setUndoOpen(true)}
                  data-testid="import-undo"
                >
                  Undo this import
                </Button>
              )}
            </div>
          </div>

          <SetImportImportUndoConfirm
            open={undoOpen}
            onOpenChange={setUndoOpen}
            runResult={runResult}
            busy={busy}
            error={error}
            undoThisImport={undoThisImport}
          />
        </>
      )}
    </div>
  );
}
