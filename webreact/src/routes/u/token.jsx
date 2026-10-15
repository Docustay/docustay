// ONE-CLICK UNSUBSCRIBE (R3.028, webui routes/u/[token]/+page.svelte). The loader already unsubscribed (POST
// /go/unsubscribe); this page says so, lists what still arrives, and offers "put me back on" (POST .../undo).
// ★ Fixes carried over, found porting (27 Sep): the Svelte button used Svelte 4's `on:click` on a component in a runes
//   file, so it never fired; and the copy guessed the owner's gender from a first name ("…told him why") — it is
//   "them". After a real undo the server answers `resubscribed`, which the Svelte page would have shown as
//   "Processing…" forever; it is a one-line confirmation here.
import { useEffect, useState } from "react";
import { Button } from "@/lib/components/ui/button";

const STILL_GET = [["checkmark-booking", "Confirmations when you book something"], ["checkmark-reminder", "Reminders before a session"], ["checkmark-invoice", "Invoices and receipts"], ["checkmark-documents", "Documents to sign"]];

export default function UnsubscribePage({ data }) {
  const [state, setState] = useState(() => ({ status: data?.status ?? null, practiceName: data?.practiceName ?? null, ownerFirstName: data?.ownerFirstName ?? null }));
  const fetchError = Boolean(data?.fetchError);
  const [resubscribing, setResubscribing] = useState(false);
  const [resubscribeError, setResubscribeError] = useState(false);
  useEffect(() => { document.title = `Unsubscribe${state.practiceName ? ` · ${state.practiceName}` : ""}`; }, [state.practiceName]);

  const handleResubscribe = async () => {
    setResubscribing(true); setResubscribeError(false);
    try {
      const token = window.location.pathname.split("/")[2];
      const res = await fetch("/go/unsubscribe/undo", { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify({ token }), cache: "no-store" });
      if (!res.ok) setResubscribeError(true);
      else { const result = await res.json(); setState((s) => ({ ...s, ...result })); }
    } catch { setResubscribeError(true); } finally { setResubscribing(false); }
  };

  const center = "mx-auto flex max-w-md flex-1 flex-col items-center justify-center gap-3 px-6 text-center";
  let body;
  if (fetchError) {
    body = <div className={center} data-testid="unsubscribe-error" role="alert"><h1 className="m-0 text-page-title font-medium text-ink">We couldn't reach the server</h1><p className="m-0 text-control text-mute">Try the link again.</p></div>;
  } else if (state.status === "resubscribed") {
    body = <div className={center} data-testid="unsubscribe-resubscribed" role="status"><h1 className="m-0 text-empty-title font-medium text-ink">You're back on</h1><p className="m-0 text-control text-mute">You'll get these emails again.</p></div>;
  } else if (state.status === "unsubscribed") {
    body = (
      <div className="mx-auto flex w-full max-w-(--size-modal) flex-1 flex-col items-center justify-center px-6 py-10" data-testid="unsubscribe-success">
        <div className="w-full rounded-card border border-line bg-surface p-10">
          {state.practiceName ? <div className="mb-5 text-empty-title font-medium text-ink" data-testid="practice-name">{state.practiceName}</div> : null}
          <h1 className="mt-0 mb-2.5 text-modal-title font-medium text-ink" data-testid="headline">You won't get any more emails like that one</h1>
          <p className="mt-0 mb-6 text-ui text-ink-2">Done. No confirmation needed, no second click, nothing to log into.</p>
          <div className="border-t border-hair pt-5">
            <h2 className="mt-0 mb-3 text-ui font-medium text-ink">You'll still get</h2>
            <div className="mb-3.5 flex flex-col gap-2">
              {STILL_GET.map(([tid, text]) => <div key={tid} className="flex gap-2.5 text-control text-ink-2" data-testid={tid}><span className="shrink-0 text-ok">✓</span><span>{text}</span></div>)}
            </div>
            <p className="mt-0 mb-5 text-caption text-mute">
              Those aren't marketing — they're how your appointments work. If you want to stop those too, you'd need to stop being a client, and{" "}
              {state.ownerFirstName
                ? <span data-testid="owner-name-variant">{state.ownerFirstName} would rather you just told them why.</span>
                : <span data-testid="generic-variant">we'd rather you just told us why.</span>}
            </p>
            <Button onClick={handleResubscribe} disabled={resubscribing} className="w-full" variant="outline" data-testid="resubscribe-button">{resubscribing ? "Processing..." : "Actually, put me back on"}</Button>
            {resubscribeError ? <p className="mt-3 mb-0 text-meta text-bad" data-testid="resubscribe-error">We couldn't process that. Try again.</p> : null}
          </div>
        </div>
      </div>
    );
  } else {
    body = <div className={center} data-testid="unsubscribe-loading"><p className="m-0 text-control text-mute">Processing...</p></div>;
  }
  return <div className="flex min-h-dvh flex-col bg-paper" data-testid="unsubscribe-page">{body}</div>;
}
