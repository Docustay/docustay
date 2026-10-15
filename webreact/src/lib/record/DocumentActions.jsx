// ═══════════════════════════════════════════════════════════════════════════════════════════════
// A5.3 — THE FOUR IRREVERSIBLE CONFIRMS. **DECLINE · EXECUTE · WITHDRAW · NEW VERSION.**
//
// ★★★ ALL FOUR ARE `alert-dialog`, NOT `dialog`, AND THAT IS A CORRECTNESS CHOICE. An alert dialog
//     is DEFINED as interrupting for a response: `role="alertdialog"`, focus trapped, and — the
//     part that matters here — **not dismissable by a stray scrim click or a loose Escape.** Each
//     of these four is irreversible; answering one by accident is not a thing the product may
//     permit. We were using the wrong component for them.
//
// ★★★ AND THERE IS NO EDIT CONTROL ANYWHERE ON AN EXECUTED DOCUMENT. That is already enforced one
//     layer up — `RecordPage` renders "Executed — read only" and the Edit branch is the `{:else}`,
//     so an executed instrument offers NO control at all rather than a disabled one. **Unreachable,
//     not merely refused.** ★★ And that is only half of U25: the DATABASE trigger is the other
//     half, because *a flag is not a refusal.* This component adds nothing to that surface for an
//     executed instrument except the actions that remain legal on one.
//
// ★★ EACH CONFIRM NAMES THE OBJECT AND THE CONSEQUENCE — never "Are you sure?". The `ConfirmAction`
//    contract makes that structural: `object` and `consequence` are required props with no
//    defaults, so a confirm cannot be written without them.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useState } from "react";
import { ApiError, request } from "@/lib/api.js";
import { RANK_ORDER } from "@/lib/permissions/rank.js";
import { Button } from "@/lib/components/ui/button.jsx";
import { Field, FieldLabel, FieldContent } from "@/lib/components/ui/field.jsx";
import { Switch } from "@/lib/components/ui/switch.jsx";
import { Badge } from "@/lib/components/ui/badge.jsx";
import { Alert } from "@/lib/components/ui/alert.jsx";
import DocumentActionsDocDeclineConfirm from "./DocumentActionsDocDeclineConfirm.jsx";
import DocumentActionsDocExecuteConfirm from "./DocumentActionsDocExecuteConfirm.jsx";
import DocumentActionsDocWithdrawConfirm from "./DocumentActionsDocWithdrawConfirm.jsx";
import DocumentActionsDocVersionConfirm from "./DocumentActionsDocVersionConfirm.jsx";

export default function DocumentActions({ document = null, template = null, rank = null, onDone = null }) {
  const isAdmin = RANK_ORDER.indexOf(rank ?? "") >= RANK_ORDER.indexOf("admin");

  // ★★ EACH ACTION IS OFFERED ONLY IN THE STATE THE SERVER ACCEPTS IT. `declineInstance` refuses
  //    anything that is not `sent` or `partially_signed`; `executeInstance` refuses a re-execute.
  //    Drawing a control the server would refuse is the dead-control rule with an audit trail.
  const canDecline = document?.state === "sent" || document?.state === "partially_signed";
  const canExecute = isAdmin && document?.state === "partially_signed";
  const isExecuted = document?.state === "executed";

  const [open, setOpen] = useState(null);        // "decline" | "execute" | "withdraw" | "version"
  // ★★ R46 — MOCKUPS: "Declined: reason captured". Optional; kept in `record_reason` beside the
  //    decline event (never in the event payload) and shown on the staff History. Blank sends nothing.
  const [declineReason, setDeclineReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(null);

  async function run(fn) {
    if (busy) return;
    setBusy(true);
    setProblem(null);
    try {
      await fn();
      setOpen(null);
      onDone?.();
    } catch (err) {
      // ★★ VERBATIM. `executeInstance`'s refusal explains that an executed instrument is immutable;
      //    `updateTemplateBody`'s names the version to create instead. Both are better than anything
      //    written here, and both name the rule that actually said no.
      setProblem(err instanceof ApiError ? err.message : String(err?.message ?? err));
    } finally {
      setBusy(false);
    }
  }

  const named = document?.title ?? "this document";
  const forWhom = document?.subject_name ? ` for ${document.subject_name}` : "";

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  // G29 (14.73) — THE SHARE TOGGLE ON A SESSION NOTE. Named part: "the share block", rendered only
  // when `doc.is_session_note` is true.
  //
  // ★★★ THE PRIVACY GUARANTEE BELOW IS KEPT BY THE SERVER — CHECKED, NOT ASSUMED. MEASURED:
  //     `db/migrations/0420_session_note_share.sql:179-182` — the non-staff branch of
  //     `keystone.document_is_visible` refuses a guardian/parent UNCONDITIONALLY for a session note,
  //     BEFORE it ever looks at `shared_with_client_at`: `IF v_via_guard OR v_viewer.role = 'parent'
  //     THEN RETURN false; END IF;` runs first, so sharing can never widen who besides the note's own
  //     subject may read it. The same migration's own self-check (§d, block 1, assertions (1)-(3),
  //     EXECUTED at migrate time) proves exactly this scenario: the subject sees nothing unshared,
  //     sees it once shared (positive control), and the subject's OWN GUARDIAN sees nothing even once
  //     shared — the same fact this helper sentence promises, held by the row it renders under, not
  //     invented here.
  //
  // ★ Default OFF, and the switch reflects `shared_with_client_at` — never local state that drifts
  //   from it. `shared` is recomputed from `doc` every render; the only thing that ever moves it is a
  //   successful server response re-read through `onDone?.()` (ArchiveControl.svelte's own "RE-READ,
  //   NEVER PATCH" rule, followed here) — there is no optimistic flip anywhere below.
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  const isSessionNote = document?.is_session_note === true;
  const shared = !!document?.shared_with_client_at;
  // ★ The only name this component has for the note's subject. Falls back to a neutral noun rather
  //   than rendering "Share with " with nothing after it.
  const clientFirstName = (document?.subject_name ?? "").trim().split(/\s+/)[0] || "the client";

  const SHARE_NOT_PERMITTED = `Only the note's writer, their coach or the owner can share it.`;
  const [shareBusy, setShareBusy] = useState(false);
  const [shareRefused, setShareRefused] = useState(null);

  async function toggleShare(next) {
    if (shareBusy || !document?.id) return;
    setShareBusy(true);
    setShareRefused(null);
    try {
      // ★ `request()`/`ApiError` directly (§0.4 E) — this call has no response body worth a wrapper,
      //   and api.js's wrappers destructure a fixed field list and silently drop anything not named.
      await request(`/api/notes/${document.id}/${next ? "share" : "unshare"}`, { method: "POST" });
      onDone?.();
    } catch (err) {
      // ★★★ A 404 HERE MEANS "YOU MAY NOT", NOT "NOT FOUND". `shareNote`
      //     (`src/documents/noteShare.mjs:62`) answers 404 alike for a nonexistent id and for a
      //     visible-but-not-permitted actor (the same enumeration-oracle discipline `notFound()`
      //     keeps everywhere else) — so this is the one place in the file that supplies its own
      //     sentence instead of the server's generic "not found" body, and only for this status.
      setShareRefused(
        err instanceof ApiError && err.status === 404
          ? SHARE_NOT_PERMITTED
          : err instanceof ApiError
            ? err.message
            : String(err?.message ?? err)
      );
    } finally {
      // ★ Never a dead spinner. Nothing above ever moved `shared` before this line, so a refusal
      //   leaves the switch exactly where it was — a switch shown on while the note is private
      //   would be a privacy lie.
      setShareBusy(false);
    }
  }

  if (!document) return null;

  return (
    <>
      {canDecline && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-testid="doc-decline-trigger"
          onClick={() => {
            setProblem(null);
            setOpen("decline");
          }}
        >
          Decline
        </Button>
      )}

      {canExecute && (
        <Button
          type="button"
          variant="default"
          size="sm"
          data-testid="doc-execute-trigger"
          onClick={() => {
            setProblem(null);
            setOpen("execute");
          }}
        >
          Execute
        </Button>
      )}

      {/* ★★★ NOTHING THAT CHANGES AN EXECUTED INSTRUMENT IS DRAWN. Not disabled — absent. The only
           thing offered on an executed document is the statement that it is one. */}
      {isExecuted && (
        <Badge variant="outline" data-testid="doc-executed" data-value="executed">
          Executed
        </Badge>
      )}

      {/* ═══ G29 (14.73) — THE SHARE BLOCK. Absent, not disabled, for anything that is not a session
           note (field 14's "not-a-note" state). ═══════════════════════════════════════════════════ */}
      {isSessionNote && (
        <div
          className="border-t border-line py-3 mt-1"
          data-testid="doc-share-row"
          data-state={shareBusy ? "saving" : shareRefused ? "refused" : shared ? "on" : "off"}
        >
          <Field orientation="horizontal" className="gap-1 max-w-[420px]">
            <FieldLabel htmlFor="doc-share-toggle" className="flex-auto">
              Share with {clientFirstName}
            </FieldLabel>
            <FieldContent className="gap-1">
              <Switch
                id="doc-share-toggle"
                checked={shared}
                disabled={shareBusy}
                onCheckedChange={(v) => toggleShare(v)}
                data-testid="doc-share-toggle"
              />
              <p className="text-xs text-ink-muted mt-1.5">
                They'll see it under Documents → From your sessions. Their parent never will.
              </p>
            </FieldContent>
          </Field>
          {shareBusy && (
            <span className="text-xs text-ink-muted inline-block mt-1.5" data-testid="doc-share-saving">
              Saving…
            </span>
          )}
          {shareRefused && (
            <Alert variant="destructive" className="mt-3" role="alert">
              <p className="m-0" data-testid="doc-share-error">
                {shareRefused}
              </p>
            </Alert>
          )}
        </div>
      )}

      {template && isAdmin && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-testid="doc-version-trigger"
          onClick={() => {
            setProblem(null);
            setOpen("version");
          }}
        >
          New version
        </Button>
      )}

      <Button
        type="button"
        variant="outline"
        size="sm"
        data-testid="doc-withdraw-trigger"
        onClick={() => {
          setProblem(null);
          setOpen("withdraw");
        }}
      >
        Withdraw consent
      </Button>

      {/* ═══ 1 · DECLINE ═══════════════════════════════════════════════════════════════════════════ */}
      <DocumentActionsDocDeclineConfirm
        open={open === "decline"}
        onOpenChange={(v) => setOpen(v ? "decline" : null)}
        document={document}
        doc={document}
        declineReason={declineReason}
        onDeclineReasonChange={setDeclineReason}
        busy={busy}
        problem={problem}
        run={run}
        named={named}
        forWhom={forWhom}
      />

      {/* ═══ 2 · EXECUTE ══════════════════════════════════════════════════════════════════════════ */}
      <DocumentActionsDocExecuteConfirm
        open={open === "execute"}
        onOpenChange={(v) => setOpen(v ? "execute" : null)}
        doc={document}
        busy={busy}
        problem={problem}
        run={run}
        named={named}
        forWhom={forWhom}
      />

      {/* ═══ 3 · WITHDRAW THE DISCLOSURE CONSENT ═══════════════════════════════════════════════════ */}
      <DocumentActionsDocWithdrawConfirm
        open={open === "withdraw"}
        onOpenChange={(v) => setOpen(v ? "withdraw" : null)}
        doc={document}
        busy={busy}
        problem={problem}
        run={run}
      />

      {/* ═══ 4 · A NEW TEMPLATE VERSION ════════════════════════════════════════════════════════════ */}
      <DocumentActionsDocVersionConfirm
        open={open === "version"}
        onOpenChange={(v) => setOpen(v ? "version" : null)}
        doc={document}
        template={template}
        busy={busy}
        problem={problem}
        run={run}
      />
    </>
  );
}
