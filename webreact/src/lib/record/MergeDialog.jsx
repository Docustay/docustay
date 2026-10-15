// ═══════════════════════════════════════════════════════════════════════════════════════════════
// 12.25 — MERGE DUPLICATES. Ported from `specs/mockups/MergePreview.frame.html`. Owner/Admin only
// (the server enforces this on every one of the four routes below — `record.archive`,
// `src/routes/writes.mjs:238-262` — hiding the trigger in `PersonActions.jsx` is a payload
// decision, never the boundary).
//
// ★★★ MERGE RE-POINTS AND PRESERVES. IT NEVER DELETES REAL CLIENT DATA. Nothing in this dialog may
//     say or imply that a record is destroyed — every related row moves to the survivor
//     (`src/records/merge.mjs`'s `PERSON_FK_REFS`), the loser is archived (restorable), and the
//     30-day undo window reverses the whole thing.
//
// ★★ `previewMerge` returns `whatHappens`, `evidence` and `undoUntil` precisely so the person
//    clicking can see what will change, on what grounds, and how long they have to undo it — all
//    three are rendered below, never summarised away.
//
// ★ THE COMPARISON CARDS RENDER ONLY WHAT `previewMerge` ACTUALLY RETURNS. The frame draws seven
//   facts (Email, Phone, Who pays, Sessions, Invoices, Documents, Portal) side by side;
//   `previewMerge`'s `fields` array (`src/records/merge.mjs:162-218`, not owned by this task) only
//   carries per-side values for `display_name`/`email`/`mobile_phone`/`created_at` — the other five
//   would have to be guessed at, the exact thing that same file's own header comment refuses to do
//   for the evidence row (`Coach/service comparison is NOT included ... guessing at one risks`
//   citing a column that does not exist. Reported, not guessed."). Reported here too, not guessed:
//   Email, Phone and Added date are rendered per side; the rest are not available without editing
//   `src/records/merge.mjs`, which is out of this task's file list (12.12 owns it).
//
// ★ THE UNDO CONFIRMATION IS A `toast.success(...)` FROM `svelte-sonner` (COMPONENTS field) — the
//   same idiom `BulkBar.svelte` already uses for an undoable bulk action — fired the moment the
//   merge succeeds, in addition to `MergeResult`'s own persistent Undo button.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api.js";
import { toast } from "sonner";
import MergeResult from "./MergeResult.jsx";
import MergeDialogMergePreviewModal from "./MergeDialogMergePreviewModal.jsx";
import MergeDialogModal6Modal from "./MergeDialogModal6Modal.jsx";

function formatError(err) {
  if (err instanceof ApiError) {
    return err.requestId ? `${err.message} (Reference: ${err.requestId})` : err.message;
  }
  return String(err?.message ?? err);
}

function formatDate(iso) {
  if (!iso) return "an unknown date";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });
}

export default function MergeDialog({
  survivorId = null,
  loserId = null,
  onDone = null,
  onCancel = null,
}) {
  const [previewOpen, setPreviewOpen] = useState(true);
  const [resultOpen, setResultOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [preview, setPreview] = useState(null);
  /** Set once `applyMerge` succeeds — `{ survivorName, cameAcross, dropped, undoUntil }`. */
  const [merged, setMerged] = useState(null);

  // Fetch preview on mount
  useEffect(() => {
    api
      .previewMerge(survivorId, loserId)
      .then((p) => {
        setPreview(p);
      })
      .catch((err) => {
        setError(formatError(err));
      })
      .finally(() => {
        setLoading(false);
      });
  }, [survivorId, loserId]);

  const nameField =
    preview?.fields.find((f) => f.field === "display_name") ?? null;
  const survivorName =
    (nameField?.survivorValue || "").trim() || "this person";
  const loserName =
    (nameField?.loserValue || "").trim() || "the other record";
  // ★ The name AFTER default survivorship — no overrides are offered by this dialog, so this is
  //   exactly what `applyMerge` will store (`src/records/merge.mjs:369-373`).
  const finalName =
    nameField
      ? (nameField.winner === "loser"
          ? nameField.loserValue
          : nameField.survivorValue) || survivorName
      : survivorName;

  const emailField =
    preview?.fields.find((f) => f.field === "email") ?? null;
  const phoneField =
    preview?.fields.find((f) => f.field === "mobile_phone") ?? null;
  const createdField =
    preview?.fields.find((f) => f.field === "created_at") ?? null;

  // ★ Buttons stay disabled while there is nothing loaded yet, or while the preview itself failed
  //   (including a 403 — "permission denied, plainly", never a silently-dead control).
  const uiBusy = busy || loading || (Boolean(error) && !preview);

  async function handleDismiss() {
    if (busy) return;
    setBusy(true);
    try {
      await api.dismissMergePair({
        personAId: survivorId,
        personBId: loserId,
      });
    } catch (err) {
      // ★ `DecisionModal`'s Cancel closes immediately (no `preventDefault` — AlertDialog.Cancel's
      //   default behaviour), so a failure here has nowhere left to show but a toast.
      toast.error("Couldn't record that", {
        description: formatError(err),
      });
    } finally {
      setBusy(false);
    }
    onCancel?.();
  }

  async function handleMerge() {
    if (busy || !preview) return;
    setBusy(true);
    setError(null);
    try {
      await api.applyMerge(survivorId, loserId);
      const cameAcross = preview.whatHappens.filter(
        (w) => w.verdict === "kept"
      );
      const dropped = preview.whatHappens.filter(
        (w) => w.verdict === "dropped"
      );
      setMerged({
        survivorName: finalName,
        cameAcross,
        dropped,
        undoUntil: preview.undoUntil,
      });
      setPreviewOpen(false);
      setResultOpen(true);
      toast.success(`Merged into ${finalName}.`, {
        description: `You have until ${formatDate(preview.undoUntil)} to undo it.`,
        action: {
          label: "Undo",
          onClick: handleUndo,
        },
        duration: 10000,
      });
    } catch (err) {
      setError(formatError(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleUndo() {
    if (busy) return;
    setBusy(true);
    try {
      await api.undoMergePeople(survivorId, loserId);
      toast.success("Undone. Both records are back.");
      closeResult();
    } catch (err) {
      toast.error("Couldn't undo", {
        description: formatError(err),
      });
    } finally {
      setBusy(false);
    }
  }

  // ★ Guarded so ONE `onDone` fires however the result closes — the explicit "Done" button, Undo,
  //   or the plain `Dialog`'s own Escape/backdrop dismissal
  const [resultNotified, setResultNotified] = useState(false);
  function closeResult() {
    setResultOpen(false);
    if (!resultNotified) {
      setResultNotified(true);
      onDone?.(survivorId);
    }
  }

  // Close result if it gets closed while merged is set
  useEffect(() => {
    if (merged && !resultOpen && !resultNotified) {
      setResultNotified(true);
      onDone?.(survivorId);
    }
  }, [merged, resultOpen, resultNotified, survivorId, onDone]);

  return (
    <>
      <MergeDialogMergePreviewModal
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        onCancel={handleDismiss}
        loading={loading}
        busy={busy}
        error={error}
        preview={preview}
        formatDate={formatDate}
        survivorName={survivorName}
        loserName={loserName}
        emailField={emailField}
        phoneField={phoneField}
        createdField={createdField}
        uiBusy={uiBusy}
        handleDismiss={handleDismiss}
        handleMerge={handleMerge}
      />

      {merged && (
        <MergeDialogModal6Modal
          open={resultOpen}
          onOpenChange={setResultOpen}
          busy={busy}
          merged={merged}
          survivorName={merged.survivorName}
          handleUndo={handleUndo}
          closeResult={closeResult}
        />
      )}
    </>
  );
}
