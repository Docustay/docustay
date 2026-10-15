import { useState, useEffect, useCallback } from "react";
import { request, ApiError } from "@/lib/api.js";
import OptionsPageOptionsPageTable from "./OptionsPageOptionsPageTable.jsx";
import OptionsPageOptionsSheet from "./OptionsPageOptionsSheet.jsx";
import { savedToast } from "@/lib/hooks/savedToast.js";

export default function OptionsPage({ onNavigate = null, onDone = null, rank = null }) {
  const isCoach = rank === `coach`;

  // Loading and error state
  const [phase, setPhase] = useState("loading");
  const [error, setError] = useState(null);
  const [rows, setRows] = useState([]);

  // Sheet state
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetMode, setSheetMode] = useState("create");
  const [sheetId, setSheetId] = useState(null);
  const [sheetBusy, setSheetBusy] = useState(false);
  const [sheetError, setSheetError] = useState(null);
  const [sheetErrorRequestId, setSheetErrorRequestId] = useState(null);
  const [question, setQuestion] = useState("");
  const [kind, setKind] = useState("choice");
  const [choices, setChoices] = useState([""]);
  const [required, setRequired] = useState(false);

  const displayPhase = phase === "ready" && rows.length === 0 ? "empty" : phase;

  // Load data from API
  const load = useCallback(async () => {
    setPhase("loading");
    setError(null);
    try {
      const res = await request("/api/items/options");
      const data = Array.isArray(res?.data) ? res.data : [];
      setRows(data);
      setPhase(data.length === 0 ? "empty" : "ready");
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
  }, []);

  // Compute empty state
  const emptyProp = useCallback(() => {
    return {
      kind: "first-run",
      icon: "IconListCheck",
      headline: "Add your first option",
      line: "Choices that change nothing about the price. You just need to know.",
      action: isCoach ? null : { label: "New option", href: "#new-option" },
    };
  }, [isCoach]);

  // Handle empty state navigation
  const handleEmptyNavigate = useCallback((href) => {
    if (href === "#new-option") {
      openCreate();
      return;
    }
    if (onNavigate) onNavigate(href);
    else window.location.assign(href);
  }, [onNavigate]);

  // Compute fraction word for honesty note
  const fractionWord = useCallback((skipped, eligible) => {
    if (!eligible || skipped <= 0) return null;
    const ratio = skipped / eligible;
    if (ratio >= 0.9) return "nearly all";
    if (ratio >= 0.66) return "most";
    if (ratio >= 0.55) return "more than half";
    if (ratio >= 0.45) return "about half";
    if (ratio >= 0.3) return "a third";
    if (ratio >= 0.2) return "a quarter";
    if (ratio >= 0.1) return "about a tenth";
    return "some";
  }, []);

  // Compute chip for a row
  const chipFor = useCallback((row) => {
    if (row.required) return { label: "Required", tone: "act" };
    const eligible = Number(row.answered ?? 0) + Number(row.skipped ?? 0);
    const word = fractionWord(Number(row.skipped ?? 0), eligible);
    if (word) return { label: `Optional — and ${word} of people skip it`, tone: "warn" };
    return { label: "Optional", tone: "neutral" };
  }, [fractionWord]);

  // Compute description for a row
  const descriptionFor = useCallback((row) => {
    if (row.kind === "choice") return (row.choices ?? []).join(" · ");
    return "A box they can type in.";
  }, []);

  // Compute conditional note for a row
  const conditionalNote = useCallback((row) => {
    return row.showIf ? "Conditional — only shows for some bookings." : null;
  }, []);

  // Check if row is actionable
  const rowActionable = useCallback((row) => {
    return !isCoach;
  }, [isCoach]);

  // Sheet handlers
  const openCreate = useCallback(() => {
    if (isCoach) return;
    setSheetMode("create");
    setSheetId(null);
    setSheetError(null);
    setSheetErrorRequestId(null);
    setQuestion("");
    setKind("choice");
    setChoices([""]);
    setRequired(false);
    setSheetOpen(true);
  }, [isCoach]);

  const openEdit = useCallback((row) => {
    if (isCoach) return;
    setSheetMode("edit");
    setSheetId(row.id);
    setSheetError(null);
    setSheetErrorRequestId(null);
    setQuestion(row.question ?? "");
    setKind(row.kind === "text" ? "text" : "choice");
    setChoices((row.choices && row.choices.length) ? [...row.choices] : [""]);
    setRequired(!!row.required);
    setSheetOpen(true);
  }, [isCoach]);

  const closeSheet = useCallback(() => {
    if (sheetBusy) return;
    setSheetOpen(false);
  }, [sheetBusy]);

  const addChoice = useCallback(() => {
    setChoices((prev) => [...prev, ""]);
  }, []);

  const removeChoice = useCallback((i) => {
    setChoices((prev) => prev.filter((_, idx) => idx !== i));
  }, []);

  const setChoice = useCallback((i, value) => {
    setChoices((prev) => prev.map((c, idx) => (idx === i ? value : c)));
  }, []);

  const submitSheet = useCallback(async () => {
    setSheetError(null);
    setSheetErrorRequestId(null);
    const trimmedChoices = choices.map((c) => c.trim()).filter((c) => c.length > 0);
    const body = {
      question: question.trim(),
      kind,
      choices: kind === "choice" ? trimmedChoices : [],
      required,
    };
    setSheetBusy(true);
    try {
      if (sheetMode === "edit") {
        await request("/api/items/options/update", {
          method: "POST",
          body: { id: sheetId, ...body },
        });
      } else {
        await request("/api/items/options", {
          method: "POST",
          body,
        });
      }
      savedToast(sheetMode === "edit" ? "Option updated" : "Option added");
      setSheetOpen(false);
      await load();
      onDone?.();
    } catch (err) {
      if (err instanceof ApiError) {
        setSheetError(err.message);
        setSheetErrorRequestId(err.requestId);
      } else {
        setSheetError(String(err?.message ?? err));
        setSheetErrorRequestId(null);
      }
    } finally {
      setSheetBusy(false);
    }
  }, [sheetMode, sheetId, question, kind, choices, required, load, onDone]);

  // Load data on mount
  useEffect(() => {
    load();
  }, [load]);

  return (
    <>
      <OptionsPageOptionsPageTable
        onNavigate={onNavigate}
        isCoach={isCoach}
        phase={phase}
        error={error}
        rows={rows}
        displayPhase={displayPhase}
        emptyProp={emptyProp()}
        handleEmptyNavigate={handleEmptyNavigate}
        chipFor={chipFor}
        descriptionFor={descriptionFor}
        conditionalNote={conditionalNote}
        rowActionable={rowActionable}
        question={question}
        openCreate={openCreate}
        openEdit={openEdit}
      />

      {sheetOpen && (
        <OptionsPageOptionsSheet
          open={sheetOpen}
          onOpenChange={setSheetOpen}
          error={error}
          sheetMode={sheetMode}
          sheetBusy={sheetBusy}
          sheetError={sheetError}
          sheetErrorRequestId={sheetErrorRequestId}
          question={question}
          onQuestionChange={setQuestion}
          kind={kind}
          onKindChange={setKind}
          choices={choices}
          required={required}
          onRequiredChange={setRequired}
          closeSheet={closeSheet}
          addChoice={addChoice}
          removeChoice={removeChoice}
          setChoice={setChoice}
          submitSheet={submitSheet}
          dirty={question.trim() !== "" || choices.some((c) => c.trim() !== "")}
        />
      )}
    </>
  );
}
