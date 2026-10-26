// ═══════════════════════════════════════════════════════════════════════════════════════════════
// R8.038 — `/settings/terminology`. **THE FOUR OR FIVE WORDS A PRACTICE CHANGES. NOT A TRANSLATION
// LAYER.**
//
// ★★★ THE HISTORY MATTERS AND IS THE REASON THIS SCREEN IS SHAPED THE WAY IT IS. The previous
//     terminology system resolved words through i18next, **which ECHOES THE KEY ON A MISS** — so a
//     lookup with no resolver behind it did not throw and did not render blank, it printed a
//     dotted identifier on screen. That system was deleted, and this one replaced it with a CLOSED
//     set of keys, each with a SHIPPED DEFAULT. There is no miss to echo.
//   ★★ So the left column is the DEFAULT — the word the product uses when this practice has said
//      nothing — and it is always shown. A screen offering only an empty box could not tell
//      "we call them clients" from "nobody has decided".
//
// ★★★ A BLANK FIELD IS NOT AN EMPTY STRING. Saving builds the override map from the fields that
//     have text; a cleared field is OMITTED, never stored as `""` and never stored as a copy of
//     the fallback. Storing the fallback would freeze today's default into the practice's data,
//     so changing the shipped word later would silently not reach them.
//
// ★★ ONE SAVE, NOT ONE PER ROW. The setting is a single key holding the whole map
//    (`terminology.overrides`), so per-row saves would each rewrite the entire object — and two
//    rows saved close together would race, with the loser's word vanishing. One button, one write.
//
// ★ THE IDENTIFIER IS SHOWN AND IS `aria-hidden`. A label may not contain a dot — that is an
//   identifier, not a label — and renaming a word never renames a permission key. Sighted users
//   occasionally need the key; a screen reader reading it aloud after the label is noise.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useState, useEffect } from "react";
import { api, ApiError } from "@/lib/api.js";
import PageHeader from "@/lib/lists/PageHeader.jsx";
import { Button } from "@/lib/components/ui/button.jsx";
import TerminologyScreenTable1Table from "@/lib/screens/TerminologyScreenTable1Table.jsx";
import { RANK_ORDER } from "@/lib/permissions/rank.js";

export default function TerminologyScreen({ view = null, rank = null, onDone = null }) {
  const [draft, setDraft] = useState({});
  const [seeded, setSeeded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(null);
  const [saved, setSaved] = useState(false);
  const [lintWarnings, setLintWarnings] = useState([]);
  const [confirmingSave, setConfirmingSave] = useState(false);

  const terms = view?.terms ?? [];
  const canWrite = RANK_ORDER.indexOf(rank ?? "") >= RANK_ORDER.indexOf("admin") && view?.writable === true;

  // ★★ SEEDED ONCE PER LOAD, NOT ON EVERY RENDER — re-seeding would wipe what somebody is typing
  //    the moment any unrelated state changed.
  useEffect(() => {
    if (seeded || terms.length === 0) return;
    const newDraft = {};
    terms.forEach((t) => {
      newDraft[t.key] = t.override ?? "";
    });
    setDraft(newDraft);
    setSeeded(true);
  }, [seeded, terms]);

  const dirty = terms.some((t) => (draft[t.key] ?? "") !== (t.override ?? ""));

  // ★★ THE SERVER REFUSES A LABEL CONTAINING A DOT. Saying so BEFORE the save is the difference
  //    between a hint and a round trip that comes back as a refusal — and the sentence is the same
  //    one the server uses, so the two cannot disagree about the rule.
  const offending = terms.filter((t) => String(draft[t.key] ?? "").includes(".")).map((t) => t.key);

  const handleDraftChange = (termKey, value) => {
    setDraft((prev) => ({ ...prev, [termKey]: value }));
    setSaved(false);
  };

  const doSave = async (overrides) => {
    setBusy(true);
    setProblem(null);
    setSaved(false);
    try {
      await api.setSetting({
        key: view?.settingKey ?? "terminology.overrides",
        value: overrides,
      });
      setSaved(true);
      onDone?.();
    } catch (err) {
      setProblem(err instanceof ApiError ? err.message : String(err?.message ?? err));
    } finally {
      setBusy(false);
    }
  };

  const handleSave = async () => {
    if (busy || !canWrite || offending.length > 0) return;
    setBusy(true);
    setProblem(null);
    setSaved(false);
    try {
      // ★★★ THE WHOLE MAP, WITH BLANKS OMITTED. See the header — a blank is "use the default",
      //     which is the ABSENCE of a key, not a key holding "".
      const value = {};
      for (const t of terms) {
        const v = String(draft[t.key] ?? "").trim();
        if (v) value[t.key] = v;
      }

      // ★ Check for layout risks before saving
      const lintResult = await api.lintTerminology({ overrides: value });
      if (lintResult.warnings && lintResult.warnings.length > 0) {
        setLintWarnings(lintResult.warnings);
        setConfirmingSave(true);
        setBusy(false);
        return;
      }

      await doSave(value);
    } catch (err) {
      setProblem(err instanceof ApiError ? err.message : String(err?.message ?? err));
      setBusy(false);
    }
  };

  const handleSaveAnyway = () => {
    if (busy) return;
    const value = {};
    for (const t of terms) {
      const v = String(draft[t.key] ?? "").trim();
      if (v) value[t.key] = v;
    }
    setConfirmingSave(false);
    doSave(value);
  };

  const handleChangeIt = () => {
    setConfirmingSave(false);
    setLintWarnings([]);
  };

  return (
    <>
      <PageHeader title={view?.title ?? "Terminology"} count={terms.length} noun="word" />

      {view?.intro && (
        <p className="mb-4" data-testid="terminology-intro">
          {view.intro}
        </p>
      )}
      {view?.notice && (
        <p className="mb-4 rounded-card bg-notice-wash p-4 text-notice-ink" data-testid="terminology-notice" role="status">
          {view.notice}
        </p>
      )}

      <TerminologyScreenTable1Table
        canWrite={canWrite}
        terms={terms}
        draft={draft}
        busy={busy}
        onDraftChange={handleDraftChange}
      />

      {offending.length > 0 && (
        <p className="mt-4 rounded-card bg-destructive/10 p-4 text-destructive" data-testid="terminology-dot" role="alert">
          Labels can't contain a full stop.
          Fix {offending.length === 1 ? "the entry" : "the entries"} above before saving.
        </p>
      )}

      {problem && (
        <p className="mt-4 rounded-card bg-destructive/10 p-4 text-destructive" data-testid="terminology-error" role="alert">
          {problem}
        </p>
      )}

      {confirmingSave && lintWarnings.length > 0 && (
        <div className="mt-4 rounded-card bg-notice-wash p-4 text-notice-ink" data-testid="terminology-lint-warnings" role="alert">
          <div className="mb-2 font-medium">Longer words break layouts</div>
          <div className="mb-3">
            {lintWarnings.map((warning) => (
              <div key={warning.termKey} data-testid={`lint-warning-${warning.termKey}`}>
                &ldquo;{warning.word}&rdquo; is too wide for {warning.where}
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              disabled={busy}
              onClick={handleSaveAnyway}
              data-testid="terminology-save-anyway"
            >
              Save anyway
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={handleChangeIt}
              data-testid="terminology-change-it"
            >
              Change it
            </Button>
          </div>
        </div>
      )}

      {canWrite && (
        <div className="mt-6 flex items-center gap-3">
          <Button
            type="button"
            disabled={busy || !dirty || offending.length > 0 || confirmingSave}
            onClick={handleSave}
            data-testid="terminology-save"
          >
            {busy ? "Saving…" : "Save these words"}
          </Button>
          {saved && !dirty && (
            <span className="text-sm text-mute" data-testid="terminology-saved" role="status">
              Saved.
            </span>
          )}
        </div>
      )}
      {!canWrite && (
        <p className="mt-6 text-sm text-mute" data-testid="terminology-readonly">
          You can see these words but not change them. Renaming is an admin action.
        </p>
      )}
    </>
  );
}
