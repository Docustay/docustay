// THE ONE "THIS CAN'T BE UNDONE" DIALOG (QUEUE §3 A, the maintainer 2 Oct 2026). Every Delete in the product opens THIS — from a
// list row's menu (RowActions) or a record page (DeleteButton) — through `requestDelete()`; nothing else draws a delete
// confirm. It first asks the server for the PLAN (POST /api/records/delete with confirm:false): what else would go,
// and what blocks it. Delete is only offered when nothing blocks. A person with a Stripe customer gets one honest
// checkbox — also delete them in Stripe (their open invoices are voided and subscriptions cancelled there).
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel,
} from "@/lib/components/ui/alert-dialog.jsx";
import { Button } from "@/lib/components/ui/button.jsx";
import { api, ApiError } from "@/lib/api.js";
import { useAppState } from "@/lib/app/useAppState.js";
import { DELETABLE_TYPES, mayDelete } from "./deleteTypes.js";

const EVENT = "ks:request-delete";
const BULK_EVENT = "ks:request-bulk-delete";

/** Ask for the BULK confirm. Resolves true when the person confirms (the caller then runs the delete), false on cancel. The dialog states the
 *  aggregated plan first — how many can go, what else goes with them, what is refused and why, what Stripe will do. */
export function requestBulkDelete({ object, ids, labelOf = null }) {
  return new Promise((resolve) => window.dispatchEvent(new CustomEvent(BULK_EVENT, { detail: { object, ids, labelOf, resolve } })));
}

function BulkDeleteHost() {
  const [req, setReq] = useState(null);
  const [plan, setPlan] = useState(null);
  const [problem, setProblem] = useState(null);
  useEffect(() => {
    const on = (e) => { setReq(e.detail); setPlan(null); setProblem(null); };
    window.addEventListener(BULK_EVENT, on);
    return () => window.removeEventListener(BULK_EVENT, on);
  }, []);
  useEffect(() => {
    if (!req) return undefined;
    let live = true;
    api.bulkRecords({ action: "delete", object: req.object, ids: req.ids, confirm: false })
      .then((p) => { if (live) setPlan(p); })
      .catch((err) => { if (live) setProblem(err instanceof ApiError ? err.message : String(err?.message ?? err)); });
    return () => { live = false; };
  }, [req]);
  const close = (answer) => { req?.resolve(answer); setReq(null); };
  const n = req?.ids?.length ?? 0;
  return (
    <AlertDialog open={!!req} onOpenChange={(o) => { if (!o) close(false); }}>
      <AlertDialogContent data-testid="bulk-delete-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {n} {n === 1 ? "item" : "items"}?</AlertDialogTitle>
          <AlertDialogDescription>This can&apos;t be undone.</AlertDialogDescription>
        </AlertDialogHeader>
        <div className="flex flex-col gap-3 text-ui text-ink-2" data-testid="bulk-delete-plan">
          {!plan && !problem && <p>Checking what this touches…</p>}
          {plan && <p className="m-0" data-testid="bulk-delete-counts"><strong>{plan.deletable}</strong> of {plan.requested} can be deleted{plan.blocked.length ? `; ${plan.blocked.length} can't (below)` : ""}.</p>}
          {plan && plan.alsoRemoves.length > 0 && (
            <div data-testid="bulk-delete-also-removes">
              <p className="m-0 font-medium text-ink">This also deletes:</p>
              <ul className="m-0 mt-1 list-disc pl-5">{plan.alsoRemoves.map((a) => <li key={a.what}>{a.count} {a.what}</li>)}</ul>
            </div>
          )}
          {plan && plan.blocked.length > 0 && (
            <div data-testid="bulk-delete-blocked" role="alert">
              <p className="m-0 font-medium text-danger">These will be skipped:</p>
              <ul className="m-0 mt-1 list-disc pl-5">{plan.blocked.slice(0, 8).map((b) => <li key={b.id}>{b.label ?? req?.labelOf?.(b.id) ?? "An item"} — {b.reasons.join(", ")}</li>)}{plan.blocked.length > 8 && <li>…and {plan.blocked.length - 8} more</li>}</ul>
            </div>
          )}
          {plan && plan.notes.length > 0 && <ul className="m-0 list-disc pl-5" data-testid="bulk-delete-notes">{plan.notes.map((x) => <li key={x}>{x}</li>)}</ul>}
          {problem && <p className="m-0 text-danger" role="alert">{problem}</p>}
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => close(false)}>Cancel</AlertDialogCancel>
          <Button type="button" variant="destructive" disabled={!plan || plan.deletable === 0} onClick={() => close(true)} data-testid="bulk-delete-confirm">
            Delete {plan?.deletable ?? ""}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** Ask for the dialog. `detail`: { object, id, label?, onDone? } */
export function requestDelete(detail) {
  window.dispatchEvent(new CustomEvent(EVENT, { detail }));
}

export function DeleteHost() {
  const app = useAppState();
  const [req, setReq] = useState(null);
  const [plan, setPlan] = useState(null);
  const [problem, setProblem] = useState(null);
  const [busy, setBusy] = useState(false);
  const [alsoStripe, setAlsoStripe] = useState(false);

  useEffect(() => {
    const on = (e) => { setReq(e.detail); setPlan(null); setProblem(null); setAlsoStripe(false); };
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, []);

  const options = alsoStripe ? { deleteStripeCustomer: true } : undefined;

  useEffect(() => {
    if (!req) return undefined;
    let live = true;
    setPlan(null); setProblem(null);
    api.deleteRecord({ object: req.object, id: req.id, confirm: false, options })
      .then((p) => { if (live) setPlan(p); })
      .catch((err) => { if (live) setProblem(err instanceof ApiError ? err.message : String(err?.message ?? err)); });
    return () => { live = false; };
  }, [req, alsoStripe]); // eslint-disable-line react-hooks/exhaustive-deps

  async function run() {
    setBusy(true); setProblem(null);
    try {
      await api.deleteRecord({ object: req.object, id: req.id, confirm: true, options });
      toast.success(`${plan?.label ?? "It"} was deleted.`);
      const done = req.onDone;
      setReq(null);
      app.refetchSignal += 1;      // re-read, never patch
      app.loadCounts?.();
      done?.();
    } catch (err) {
      setProblem(err instanceof ApiError ? err.message : String(err?.message ?? err));
    } finally {
      setBusy(false);
    }
  }

  const label = plan?.label ?? req?.label ?? "this record";
  const hasStripeOption = plan?.object === "person" && (plan?.notes ?? []).some((n) => /Stripe/i.test(n));
  return (
    <>
    <BulkDeleteHost />
    <AlertDialog open={!!req} onOpenChange={(o) => { if (!o && !busy) setReq(null); }}>
      <AlertDialogContent data-testid="delete-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {label}?</AlertDialogTitle>
          <AlertDialogDescription>This can&apos;t be undone.</AlertDialogDescription>
        </AlertDialogHeader>
        <div className="flex flex-col gap-3 text-ui text-ink-2" data-testid="delete-plan">
          {!plan && !problem && <p>Checking what this touches…</p>}
          {plan && plan.alsoRemoves.length > 0 && (
            <div data-testid="delete-also-removes">
              <p className="m-0 font-medium text-ink">This also deletes:</p>
              <ul className="m-0 mt-1 list-disc pl-5">{plan.alsoRemoves.map((a) => <li key={a.what}>{a.count} {a.what}</li>)}</ul>
            </div>
          )}
          {plan && plan.blockers.length > 0 && (
            <div data-testid="delete-blockers" role="alert">
              <p className="m-0 font-medium text-danger">It can&apos;t be deleted yet:</p>
              <ul className="m-0 mt-1 list-disc pl-5">{plan.blockers.map((b) => <li key={b.what}>{b.count} {b.what}{b.hint ? ` — ${b.hint}` : ""}</li>)}</ul>
            </div>
          )}
          {plan && plan.notes.length > 0 && <ul className="m-0 list-disc pl-5" data-testid="delete-notes">{plan.notes.map((n) => <li key={n}>{n}</li>)}</ul>}
          {plan?.object === "person" && (hasStripeOption || plan.blockers.some((b) => /open invoices|subscriptions/.test(b.what))) && (
            <label className="flex items-start gap-2" data-testid="delete-also-stripe">
              <input type="checkbox" checked={alsoStripe} onChange={(e) => setAlsoStripe(e.target.checked)} />
              <span>Also delete them in Stripe (voids their open invoices and cancels their subscriptions there)</span>
            </label>
          )}
          {problem && <p className="m-0 text-danger" role="alert" data-testid="delete-problem">{problem}</p>}
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <Button type="button" variant="destructive" disabled={busy || !plan || !plan.canDelete} onClick={run} data-testid="delete-confirm">
            {busy ? "Deleting…" : "Delete"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
}

/** The record page's Delete button — Owner/Admin only, for a type the server can delete. */
export function DeleteButton({ type, id, label = null, rank = null, onDone = null }) {
  if (!DELETABLE_TYPES.includes(type) || !mayDelete(rank)) return null;   // absent, not disabled: the answer is "never, for you"
  return (
    <Button type="button" variant="outline" size="sm" data-testid="record-delete-open" data-type={type}
      onClick={() => requestDelete({ object: type, id, label, onDone })}>
      Delete
    </Button>
  );
}
