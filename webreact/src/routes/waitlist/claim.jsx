// A TIME HAS COME UP (R3.029, webui routes/waitlist/claim/+page.svelte) — the public page a waitlisted client lands on
// from the offer email. `data` = { peek, t } | { problem, t } from the loader (publicRoutes.js).
// ★ ONE generic error sentence, never a distinguishing one: a tenant-blind public page must not leak whether a token
//   exists. ★ "N other people were told" is OMITTED at 0 — never a zero-count sentence. ★ No location clause is
//   invented: `locationSentence` is null on every real row today, so the "where" is drawn only when it exists.
import { Suspense, useEffect, useState } from "react";
import { Skeleton } from "@/lib/components/ui/skeleton";
import { Button, buttonVariants } from "@/lib/components/ui/button";
import Figure from "@/lib/components/kit/Figure.jsx";
import { fileComponent } from "@/lib/app/lazyScreens.js";

const BookingConfirmation = fileComponent("lib/screens/engagements/BookingConfirmation.jsx");
const NUMBER_WORDS = ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"];
function toldOthersSentence(n) {
  if (!Number.isFinite(n) || n <= 0) return null;
  return `${NUMBER_WORDS[n] ?? String(n)} other ${n === 1 ? "person" : "people"} ${n === 1 ? "was" : "were"} told at the same time.`;
}
const H1 = ({ children }) => <h1 className="m-0 text-page-title font-medium text-ink">{children}</h1>;
const Line = ({ testId, children }) => <p className="mt-3 mb-0 max-w-[62ch] text-body text-ink-2" data-testid={testId}>{children}</p>;

export default function WaitlistClaimPage({ data }) {
  const peek = data?.peek ?? null;
  const t = data?.t ?? "";
  const [overrideState, setOverrideState] = useState(null);
  const [declineMessage, setDeclineMessage] = useState("");
  const [posting, setPosting] = useState(false);
  const [actionError, setActionError] = useState(false);
  useEffect(() => { document.title = "A time has come up"; }, []);
  const resultState = overrideState ?? peek?.state ?? null;
  const showError = Boolean(data?.problem) || actionError;

  const post = async (url, onOk) => {
    if (posting) return;
    setPosting(true); setActionError(false);
    try {
      const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ t, turnstileToken: null }) });
      await onOk(res);
    } catch { setActionError(true); } finally { setPosting(false); }
  };
  const takeIt = () => post("/api/public/waitlist/claim", async (res) => {
    if (res.status === 201) { await res.json(); setOverrideState("success"); }
    else if (res.status === 409) { const body = await res.json(); setOverrideState(body.state === "taken" ? "taken" : "expired"); }
    else setActionError(true);
  });
  const notThisOne = () => post("/api/public/waitlist/decline", async (res) => {
    if (!res.ok) { setActionError(true); return; }
    const body = await res.json();
    setDeclineMessage(body?.message || "Not this one — keep me on the list."); setOverrideState("declined");
  });

  let whenWith = null, heading = null, meta = "";
  if (peek?.startsAt) {
    const d = new Date(peek.startsAt);
    const f = (o) => d.toLocaleDateString(undefined, o);
    const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    whenWith = `${f({ weekday: "long" })} ${f({ day: "numeric" })} ${f({ month: "long" })} at ${time}${peek.hostName ? `, with ${peek.hostName}` : ""}${peek.locationSentence ? `, in ${peek.locationSentence}` : ""}.`;
    heading = `${f({ weekday: "long" })}, ${time}`;
  }
  if (peek) meta = [peek.hostName ? `${peek.serviceName} with ${peek.hostName}` : peek.serviceName, Number.isFinite(peek.durationMinutes) ? `${peek.durationMinutes} minutes` : null, peek.locationSentence].filter(Boolean).join(" · ");
  const told = toldOthersSentence(peek?.toldOthers);

  let body;
  if (showError) {
    body = <div className="mx-auto flex max-w-md flex-1 flex-col items-center justify-center gap-3 px-6 text-center" data-testid="waitlist-claim-problem" role="alert"><H1>This page isn't available.</H1><p className="m-0 text-control text-mute">Check the link, or contact the practice directly.</p></div>;
  } else if (!peek) {
    body = (
      <>
        <div className="flex items-center justify-end border-b border-line px-6 py-4.5 md:px-12" data-testid="waitlist-claim-loading"><Skeleton className="h-8 w-32" /></div>
        <div className="flex flex-col gap-6 px-6 py-10 md:px-12"><Skeleton className="h-9 w-96" /><Skeleton className="h-40 max-w-(--size-sheet) rounded-card" /></div>
      </>
    );
  } else {
    let inner;
    if (resultState === "success") inner = <Suspense fallback={null}><BookingConfirmation startsAt={peek.startsAt} coachName={peek.hostName} /></Suspense>;
    else if (resultState === "taken") inner = <div data-testid="waitlist-claim-taken"><H1>A time has come up</H1><Line testId="claim-taken-sentence">Someone beat you to it — you're still on the list.</Line></div>;
    else if (resultState === "expired") inner = <div data-testid="waitlist-claim-expired"><H1>A time has come up</H1><Line testId="claim-expired-sentence">This time has gone back on the booking page.</Line></div>;
    else if (resultState === "declined") inner = <div data-testid="waitlist-claim-declined"><H1>You're still on the list</H1><Line testId="claim-declined-sentence">{declineMessage}</Line></div>;
    else inner = (
      <>
        <div data-testid="waitlist-claim-open">
          <H1>A time has come up</H1>
          {whenWith ? <Line testId="claim-when-sentence">{whenWith}</Line> : null}
          {peek.preferenceSentence ? <Line testId="claim-preference-sentence">{peek.preferenceSentence}</Line> : null}
        </div>
        <div className="flex max-w-(--size-sheet) flex-col gap-1 rounded-card border border-line bg-surface p-6" data-testid="claim-details-card">
          {heading ? <Figure size="sm" testId="claim-card-heading">{heading}</Figure> : null}
          {meta ? <span className="mb-3 text-control text-mute" data-testid="claim-card-meta">{meta}</span> : null}
          {told ? <div className="mb-3 rounded-sm border border-warm-border bg-warn-soft px-3 py-2 text-meta text-warn" data-testid="claim-told-others"><b className="font-medium">{told}</b> Whoever takes it first gets it.</div> : null}
          <Button className="w-full" onClick={takeIt} disabled={posting} data-testid="claim-take-it">Take it</Button>
          <Button variant="outline" className="mt-2 w-full" onClick={notThisOne} disabled={posting} data-testid="claim-not-this-one">Not this one — keep me on the list.</Button>
        </div>
      </>
    );
    body = (
      <>
        <div className="flex items-center justify-end border-b border-line bg-surface px-6 py-4.5 md:px-12"><a className={buttonVariants({ variant: "outline" })} href="/login">Already a client? Sign in</a></div>
        <div className="flex flex-col gap-6 px-6 py-10 md:px-12" data-testid="waitlist-claim-body">{inner}</div>
      </>
    );
  }
  return <div className="flex min-h-dvh flex-col bg-surface" data-testid="eng-waitlist-claim">{body}</div>;
}
