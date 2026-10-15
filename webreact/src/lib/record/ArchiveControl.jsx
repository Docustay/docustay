// ═══════════════════════════════════════════════════════════════════════════════════════════════
// S4.3 — ARCHIVE AND RESTORE, ON THE ONE SURFACE ALL NINE ARCHIVABLE TYPES SHARE.
//
// ★★★ `POST /api/records/archive` AND `/restore` HAD NO CLIENT CALL AT ALL. [MEASURED by
//     `p7_every_write_is_reachable`, which enumerates `app.routes` at runtime] they were two of
//     the last seventeen write routes no screen could reach — and unlike the others they belong to
//     NO SECTION, which is exactly why they were still there when every section had finished.
//   ★★ Nine object types are archivable. Building the control nine times would be nine chances to
//      drift; the record page is the surface all nine share, so it is built once, here.
//
// ★★★ THE REASON FIELD IS THE ITEM, NOT A NICETY. P2.9 is *"archive not delete, DECIDED WITH A
//     REASON"*. A row taken out of circulation with no recorded why is indistinguishable from data
//     loss when somebody asks in six months. The reason is kept in `keystone.record_reason`, one row
//     per archive EVENT (R46, migration 0140) — never in the event payload (§2.4 forbids typed text
//     there), and not as a column on the record, which a second archiving would overwrite. Staff
//     History shows it beside the event.
//
// ★★ AND ARCHIVING IS CONFIRMED, NEVER ONE CLICK. It ends a person's live sessions and removes the
//    row from every list in the product. A single-press control for that is the same defect class
//    as a cancel button that cancels on hover.
//
// ★ RANK: both routes are `minRank: "admin"` server-side. This hides below that so the product
//   does not promise a coach something that answers 403 — hiding is a PAYLOAD decision, the server
//   is the boundary (§K3), and both are true at once.
//
// ★★★ HARD LIMIT 4 — NO DELETING REAL CLIENT DATA. This control cannot delete and there is no
//     route that could: archive sets a timestamp and restore clears it. That is the whole point of
//     the feature and it is why it is safe to put on every record page.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useState } from "react";
import { Button } from "@/lib/components/ui/button.jsx";
import { Input } from "@/lib/components/ui/input.jsx";
import { api, ApiError } from "@/lib/api.js";
import { ARCHIVABLE_TYPES, mayArchive } from "./archive.js";

export default function ArchiveControl({ type, id, archived = false, rank = null, onDone = null }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(null);

  // ★★ NOT DRAWN AT ALL rather than drawn-and-disabled, for a type the server cannot archive or a
  //    viewer the server would refuse. A disabled control says "not now"; absence says nothing and
  //    is the honest rendering when the answer is "never, for you".
  const shown = ARCHIVABLE_TYPES.includes(type) && mayArchive(rank);

  async function run() {
    setBusy(true);
    setProblem(null);
    try {
      if (archived) {
        // ★ The server refuses if the row is NOT archived, so a double-press cannot invent a restore
        //   that did not happen.
        await api.restoreRecord({ object: type, id });
      } else {
        await api.archiveRecord({ object: type, id, reason: reason.trim() || undefined });
      }
      setOpen(false);
      setReason("");
      // ★★★ RE-READ, NEVER PATCH. Archiving a PERSON also ends their live sessions — that is the
      //     server's job and is not something this tap can or should reproduce, so what the screen
      //     shows afterwards must be what the server actually did.
      onDone?.();
    } catch (err) {
      setProblem(err instanceof ApiError ? err.message : String(err?.message ?? err));
    } finally {
      setBusy(false);
    }
  }

  if (!shown) return null;

  return (
    <span className="inline-flex items-center gap-1.5 flex-wrap" data-testid="archive-control" data-type={type} data-archived={archived ? "true" : undefined}>
      {!open ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-testid={archived ? "restore-open" : "archive-open"}
          onClick={() => setOpen(true)}
        >
          {archived ? "Restore" : "Archive"}
        </Button>
      ) : (
        <span className="inline-flex items-center gap-1.5" role="group" aria-label={archived ? "Confirm restore" : "Confirm archive"}>
          {!archived && (
            <>
              <label htmlFor={`archive-reason-${id}`} className="sr-only">Why are you archiving this?</label>
              <Input
                id={`archive-reason-${id}`}
                data-testid="archive-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength="500"
                placeholder="Why? (optional, recorded)"
                className="min-w-[220px] h-[30px]"
              />
            </>
          )}
          <Button
            type="button"
            variant="default"
            size="sm"
            data-testid="archive-confirm"
            disabled={busy}
            onClick={run}
          >
            {busy ? "Working…" : (archived ? "Yes, restore" : "Yes, archive")}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-testid="archive-cancel"
            disabled={busy}
            onClick={() => {
              setOpen(false);
              setProblem(null);
            }}
          >
            Cancel
          </Button>
        </span>
      )}

      {problem && (
        <span className="text-destructive" data-testid="archive-error" role="alert">
          {problem}
        </span>
      )}
    </span>
  );
}
