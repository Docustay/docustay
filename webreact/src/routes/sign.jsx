// ═══════════════════════════════════════════════════════════════════════════════════════════════
// SIGN A DOCUMENT (R3.026, webui routes/sign/+page.svelte; DocsSignPhone.frame.html) — the signer's own page, reached
// from an emailed link `/sign?t=<token>`. The token is read once and stripped from the address bar (replaceState).
// ★ Phone at 375px is the primary case: the whole page is a phone-width column on a quiet backdrop.
// ★ Seven phases, each its own sentence: loading · refused (a bad link vs trouble — two copies, one state) · ready ·
//   signing · signed · declined · waiting ("<role> signs first", from the 409's own detail).
// ★ Signing needs a typed name AND ink on the canvas; the mark is a PNG data URL under 200 KB or it is refused here.
// ★ Every call is a public route (view/sign/decline) and goes through performWrite — the one write path.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useEffect, useRef, useState } from "react";
import { ApiError } from "@/lib/api.js";
import { performWrite } from "@/lib/permissions/write.js";
import { Button, buttonVariants } from "@/lib/components/ui/button";
import { Input } from "@/lib/components/ui/input";
import { Textarea } from "@/lib/components/ui/textarea";
import PageTitle from "@/lib/components/kit/PageTitle.jsx";
import { cn } from "@/lib/utils";
import { renderSectionBlocks } from "@/lib/screens/documents/renderContractBlocks.jsx";

const LINK_REFUSED_COPY = "That link is not valid. It may have been used already, expired, or been cancelled — ask them for a new one.";
const TROUBLE_COPY = "Something went wrong loading this. Try reloading the page.";
const ROLE_LABEL = { pir: "Person in recovery", parent: "Parent", coach: `Coach`, client: "Client", consultant: "Consultant", familyMember: "Family member", recipient: "Recipient" };
const roleLabel = (role) => ROLE_LABEL[role] ?? role;
const ROLE_CHIP = { pir: "bg-signer-client-bg text-signer-client-ink", client: "bg-signer-client-bg text-signer-client-ink", parent: "bg-signer-parent-bg text-signer-parent-ink", familyMember: "bg-signer-parent-bg text-signer-parent-ink" };
const pub = (key, body) => performWrite(null, key, [{ body }]);
const Label = ({ htmlFor, children }) => <label htmlFor={htmlFor} className="mb-1.5 block text-ui font-medium text-ink">{children}</label>;
const Center = ({ testId, title, children }) => <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-16 text-center" data-testid={testId}>{title ? <PageTitle>{title}</PageTitle> : null}{children}</div>;
const Body = ({ children, ...rest }) => <p className="m-0 max-w-[40ch] text-body text-ink" {...rest}>{children}</p>;
const Problem = ({ testId, children }) => <p className="m-0 text-meta text-bad" role="alert" data-testid={testId}>{children}</p>;

// ★★★ FIX, 30 Sep 2026 — THIS WAS THE ACTUAL SIGNING PAGE SHOWING NO AGREEMENT TEXT AT ALL.
//     `b.type === "text"` (the old line here) can never be true: the schema's real block types are
//     `prose`/`variable`/`signature`/`paragraphBreak`/`lineBreak`/`list` (src/documents/body.mjs) —
//     never `"text"`. Every real document rendered its section headings with nothing under them, and
//     `variable` blocks (a resolved name, a price) were never read at all, not even their unresolved
//     fallback label. `pdf.mjs` reads `"prose"` correctly, so the PDF and the live signing page were
//     already showing two different documents. `renderSectionBlocks` is now the ONE reader, shared
//     with the portal's own signing view (`DocumentSigning.jsx`) — see that shared file's own header.

/** The signer's own wall-clock date and IANA zone (they travel together or not at all). */
function localDateAndZone() {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!zone) return {};
    return { signerTimezone: zone, signedLocalDate: new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()) };
  } catch { return {}; }
}

export default function SignPage() {
  const [phase, setPhase] = useState("loading");
  const [refusedReason, setRefusedReason] = useState("link");
  const [waitingFor, setWaitingFor] = useState(null);
  const [doc, setDoc] = useState(null);
  const [typedName, setTypedName] = useState("");
  const [formProblem, setFormProblem] = useState(null);
  const [showDecline, setShowDecline] = useState(false);
  const [declineReason, setDeclineReason] = useState("");
  const [declineBusy, setDeclineBusy] = useState(false);
  const [declineProblem, setDeclineProblem] = useState(null);
  const [hasInk, setHasInk] = useState(false);
  // ★ QUEUE §23.3.5 — the SMS code step is gone from Documents (an email code / access code may return in Part 5A).
  const token = useRef(null);
  const canvas = useRef(null);
  const pen = useRef({ drawing: false, x: 0, y: 0 });

  useEffect(() => { document.title = doc?.document?.title ?? "Sign"; }, [doc]);
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("t");
    window.history.replaceState(null, "", window.location.pathname);
    if (!t) { setRefusedReason("link"); setPhase("refused"); return; }
    token.current = t;
    pub("POST /api/public/documents/view", { presented: t })
      .then((d) => { setDoc(d); setPhase("ready"); })
      .catch((err) => { setRefusedReason(err instanceof ApiError && err.status === 403 ? "link" : "trouble"); setPhase("refused"); });
  }, []);
  // Size the canvas to its box at the device's pixel ratio, once it is on screen.
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    el.width = Math.max(1, Math.round(rect.width * dpr)); el.height = Math.max(1, Math.round(rect.height * dpr));
    const ctx = el.getContext("2d"); if (!ctx) return;
    ctx.scale(dpr, dpr); ctx.lineWidth = 2.25; ctx.lineCap = "round"; ctx.lineJoin = "round";
    ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue("--color-ink").trim() || "black";
  }, [phase === "ready" || phase === "signing"]); // eslint-disable-line react-hooks/exhaustive-deps

  const at = (e) => { const r = canvas.current.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  const ptDown = (e) => { if (phase !== "ready" || !canvas.current) return; const [x, y] = at(e); pen.current = { drawing: true, x, y }; canvas.current.setPointerCapture?.(e.pointerId); e.preventDefault(); };
  const ptMove = (e) => {
    if (!pen.current.drawing || !canvas.current) return;
    const [x, y] = at(e); const ctx = canvas.current.getContext("2d");
    if (ctx) { ctx.beginPath(); ctx.moveTo(pen.current.x, pen.current.y); ctx.lineTo(x, y); ctx.stroke(); }
    pen.current.x = x; pen.current.y = y; setHasInk(true); e.preventDefault();
  };
  const ptUp = () => { pen.current.drawing = false; };
  const clearSignature = () => { const el = canvas.current; if (!el) return; el.getContext("2d")?.clearRect(0, 0, el.width, el.height); setHasInk(false); };

  const signNow = async () => {
    if (phase !== "ready") return;
    if (!typedName.trim()) { setFormProblem("Type your name to sign."); return; }
    if (!hasInk) { setFormProblem("Sign with your finger first."); return; }
    const markDataUrl = canvas.current.toDataURL("image/png");
    if (!markDataUrl.startsWith("data:image/png;base64,") || markDataUrl.length > 204800) { setFormProblem("That signature couldn't be captured — clear it and try again."); return; }
    setFormProblem(null); setPhase("signing");
    try { await pub("POST /api/public/documents/sign", { presented: token.current, typedName: typedName.trim(), markDataUrl, ...localDateAndZone() }); setPhase("signed"); }
    catch (err) {
      if (err instanceof ApiError && err.status === 403) { setRefusedReason("link"); setPhase("refused"); }
      else if (err instanceof ApiError && err.status === 409) { setWaitingFor(err.body?.error?.detail?.expectedRole ?? null); setPhase("waiting"); }
      else { setFormProblem("Something went wrong sending your signature. Try again."); setPhase("ready"); }
    }
  };
  const declineNow = async () => {
    if (phase !== "ready" || declineBusy) return;
    setDeclineBusy(true); setDeclineProblem(null);
    try { await pub("POST /api/public/documents/decline", { presented: token.current, reason: declineReason.trim() || null }); setPhase("declined"); }
    catch (err) { if (err instanceof ApiError && err.status === 403) { setRefusedReason("link"); setPhase("refused"); } else setDeclineProblem("Something went wrong. Try again."); }
    finally { setDeclineBusy(false); }
  };

  let inner;
  if (phase === "loading") inner = <Center testId="sign-loading"><p className="m-0 text-body text-mute">Loading…</p></Center>;
  else if (phase === "refused") inner = <Center testId="sign-refused" title="This link isn't working"><Body role="alert">{refusedReason === "link" ? LINK_REFUSED_COPY : TROUBLE_COPY}</Body></Center>;
  else if (phase === "signed") {
    // ★★★ FIX, 30 Sep 2026 — the "Signed" screen: dropped the serif `PageTitle`/`Center` combo (a
    //   plain heading matches item 12's plain-font ruling elsewhere in this app), stopped saying
    //   "Signed" twice (title + first word of the body), and added a real way to see the copy — the
    //   same `doc.snapshot` already loaded for signing, rendered inline with the same reader the
    //   agreement itself used, plus Print/Save as PDF via the browser's own print dialog. A fresh
    //   fetch was NOT an option here: the sign link is single-use (`redeemed_at` set by signing) and
    //   cannot be re-peeked afterward, by design (CCR-10) — the PDF email (item 1) is the durable
    //   copy; this is the immediate one.
    const signedSections = doc?.snapshot?.template?.sections ?? [];
    inner = (
      <Center testId="sign-signed">
        <h2 className="m-0 text-heading font-medium text-ink">All set</h2>
        <Body>You'll get a PDF copy by email. Your copy is also below.</Body>
        {signedSections.length > 0 && (
          <div className="mt-4 w-full max-w-[40ch] rounded-card border border-line bg-surface p-4 text-left max-h-[280px] overflow-y-auto print:max-h-none print:overflow-visible">
            {signedSections.map((section, i) => (
              <div key={i} className="mb-3 last:mb-0">
                {section.title ? <h3 className="mt-0 mb-1.5 text-ui font-medium text-ink">{section.title}</h3> : null}
                {renderSectionBlocks(section.blocks, doc?.snapshot?.variables ?? {})}
              </div>
            ))}
          </div>
        )}
        <div className="mt-4 flex flex-col gap-2 print:hidden">
          <Button type="button" variant="outline" onClick={() => window.print()} data-testid="sign-signed-print">
            Print / Save as PDF
          </Button>
          {/* ★ Not every signer has a portal account (an in-person co-signer, a family member with no
              login) — this link is safe either way: it lands on sign-in for someone with no account,
              and on their own portal home for someone who does, rather than assuming either. */}
          <a href="/" className="text-center text-meta text-brand" data-testid="sign-signed-portal-link">
            Back to your account
          </a>
        </div>
      </Center>
    );
  }
  else if (phase === "declined") inner = <Center testId="sign-declined" title="Declined"><Body>Declined — nothing was signed.</Body></Center>;
  else {
    const sections = doc?.snapshot?.template?.sections ?? [];
    const variables = doc?.snapshot?.variables ?? {};
    inner = (
      <>
        <header className="flex flex-col gap-1 border-b border-line px-4 pt-6 pb-2">
          <PageTitle>{doc?.document?.title ?? "Untitled"}</PageTitle>
          {doc?.practice?.name ? <p className="m-0 text-meta text-mute">From {doc.practice.name}</p> : null}
          {doc?.signer?.role ? <span className={cn("inline-flex h-5.5 items-center self-start rounded-pill px-2.5 text-caption font-medium", ROLE_CHIP[doc.signer.role] ?? "bg-signer-practice-bg text-signer-practice-ink")} data-role={doc.signer.role}>Signing as {roleLabel(doc.signer.role)}</span> : null}
        </header>
        <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 py-4">
          {doc?.context_line ? <div className="rounded-card border border-line bg-surface-2 px-4 py-3 text-control text-ink-2">{doc.context_line}</div> : null}
          <div className="rounded-card border border-line bg-surface p-4">
            {!doc?.snapshot ? <p className="m-0 text-ui text-ink-2">This document's frozen wording is missing, so there is nothing here to sign.</p>
              : sections.length ? sections.map((section, i) => (
                <div key={i} className="mb-4 last:mb-0">
                  {section.title ? <h3 className="mt-0 mb-2 text-heading font-medium text-ink">{section.title}</h3> : null}
                  {renderSectionBlocks(section.blocks, variables)}
                </div>
              )) : <p className="m-0 text-ui text-ink-2">No content to display</p>}
          </div>
          {phase === "waiting" ? (
            <div className="flex flex-col gap-3 rounded-card border border-line p-4" data-testid="sign-waiting" role="status">
              <Body>{waitingFor ? `${roleLabel(waitingFor)} signs first.` : "Someone else signs first."} We'll email you when it's your turn.</Body>
              <Button type="button" variant="outline" onClick={() => setPhase("ready")} data-testid="sign-try-again">Try again</Button>
            </div>
          ) : (
            <div className="flex flex-col gap-2" data-testid="sign-ready">
              <Label htmlFor="sig-canvas">Sign with your finger</Label>
              <div className="h-40 rounded-card border border-line bg-surface">
                <canvas id="sig-canvas" ref={canvas} className={cn("size-full touch-none rounded-card", phase !== "ready" && "opacity-60")} data-disabled={phase !== "ready"}
                  onPointerDown={ptDown} onPointerMove={ptMove} onPointerUp={ptUp} onPointerCancel={ptUp} data-testid="sign-canvas" />
              </div>
              <div className="flex justify-end"><Button type="button" variant="ghost" size="sm" onClick={clearSignature} disabled={phase !== "ready" || !hasInk} data-testid="sign-clear">Clear</Button></div>
              <Label htmlFor="typed-name">Type your name</Label>
              <Input id="typed-name" value={typedName} onChange={(e) => setTypedName(e.target.value)} placeholder="Your full name" disabled={phase !== "ready"} data-testid="sign-typed-name" />
              <p className="m-0 text-caption text-mute">Signing records the date, time and device. You'll get a PDF by email and a copy stays here.</p>
              {formProblem ? <Problem testId="sign-form-problem">{formProblem}</Problem> : null}
              <div className="mt-2 flex flex-col gap-2">
                <Button type="button" onClick={signNow} disabled={phase !== "ready"} data-testid="sign-submit">{phase === "signing" ? "Signing…" : "Agree and sign"}</Button>
                {doc?.practice?.supportEmail ? <a className={buttonVariants({ variant: "outline" })} href={`mailto:${doc.practice.supportEmail}`} data-testid="sign-ask-first">Ask {doc.practice.name} about it first</a> : null}
              </div>
              {!showDecline ? (
                <Button type="button" variant="link" className="self-center" onClick={() => setShowDecline(true)} disabled={phase !== "ready"} data-testid="sign-decline-open">Decline instead</Button>
              ) : (
                <div className="mt-2 flex flex-col gap-2 rounded-card border border-bad-border bg-bad-bg p-4" data-testid="sign-decline-box">
                  <Label htmlFor="decline-reason">What's wrong with it?</Label>
                  <Textarea id="decline-reason" value={declineReason} onChange={(e) => setDeclineReason(e.target.value)} rows={4} placeholder="Tell them what's wrong — they'll see this." disabled={declineBusy} data-testid="sign-decline-reason" />
                  {declineProblem ? <Problem testId="sign-decline-problem">{declineProblem}</Problem> : null}
                  <div className="flex justify-end gap-2">
                    <Button type="button" variant="outline" disabled={declineBusy} data-testid="sign-decline-cancel" onClick={() => { setShowDecline(false); setDeclineReason(""); setDeclineProblem(null); }}>Never mind</Button>
                    <Button type="button" variant="destructive" onClick={declineNow} disabled={declineBusy} data-testid="sign-decline-submit">{declineBusy ? "Sending…" : "Decline"}</Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </>
    );
  }
  return (
    // ★ the maintainer, 29 Sep 2026 — FOUND LIVE: `min-h-dvh` lets this column grow taller than the viewport
    //   instead of being capped by it, so the `overflow-y-auto` body below the header never gets a
    //   bounded box to scroll within — and theme.css's `html, body { overflow: hidden }` (every
    //   screen is expected to scroll INTERNALLY, Shell.jsx's own `h-dvh overflow-hidden` pattern)
    //   means there is no page-level scroll to fall back on either. The document text plus the
    //   signature form is routinely taller than a phone screen, so this froze scrolling on mobile
    //   every time. `h-dvh` (bounded, matching Shell.jsx and signup.jsx) instead of `min-h-dvh`.
    <div className="flex h-dvh justify-center bg-paper">
      <div className="flex h-dvh w-full max-w-120 flex-col bg-surface" data-testid="sign-page" data-phase={phase}>{inner}</div>
    </div>
  );
}
