// ═══════════════════════════════════════════════════════════════════════════════════════════════
// R9.006 — DocumentSigning: rebuild from the frame on the archetype
//
// ★★★ SIGNATURE CANVAS AND DOCUMENT SIGNING
// Loads a document, renders its content, handles signature drawing and submission.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useEffect, useRef, useState } from "react";
import { request } from "@/lib/api.js";
import { loadStripe } from "@stripe/stripe-js";
import ScreenState from "@/lib/empty/ScreenState.jsx";
import { Button } from "@/lib/components/ui/button.jsx";
import { ChevronLeft } from "lucide-react";
import { renderSectionBlocks } from "@/lib/screens/documents/renderContractBlocks.jsx";

// ★ DOCUSTAY BUILD (29 Sep 2026) — SIGN-AND-PAY. `POST /api/app/documents/:id/checkout-session`
//   (src/routes/app.mjs) was already fully built: it verifies the instrument executed with a frozen
//   price, checks the per-practice charges-off kill switch, creates a Stripe embedded Checkout
//   Session through stripeConnectedRequest (the same Docustay main-account routing every other charge in
//   this app goes through), and returns a client secret. Nothing called it from anywhere. This is
//   `ui_mode: "embedded"` specifically (not a PaymentIntent/card-element flow like
//   VirtualTerminal.jsx's own Stripe integration) — the one existing Stripe integration in this repo
//   uses a different mode, so `initEmbeddedCheckout` is the correct, distinct API for THIS session
//   shape, per Stripe's own documented contract for ui_mode: "embedded".
/** The signer's own wall-clock date and IANA zone, and their drawn mark as a PNG data URL under 200 KB (halved once if the first capture is too big). */
function signerFacts(canvas) {
  const out = {};
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (zone) {
      out.signerTimezone = zone;
      out.signedLocalDate = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    }
  } catch { /* the server fills the practice's own zone */ }
  try {
    if (canvas) {
      let url = canvas.toDataURL("image/png");
      if (url.length > 190000) {
        const small = window.document.createElement("canvas");
        small.width = Math.round(canvas.width / 2); small.height = Math.round(canvas.height / 2);
        small.getContext("2d").drawImage(canvas, 0, 0, small.width, small.height);
        url = small.toDataURL("image/png");
      }
      if (url.startsWith("data:image/png;base64,") && url.length <= 204800) out.markImage = url;
    }
  } catch { /* a mark that cannot be captured is left out; the typed name still signs */ }
  return out;
}

export default function DocumentSigning({ documentId, onClose = null, onAskHost = null }) {
  const [document, setDocument] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [signingInProgress, setSigningInProgress] = useState(false);
  const [signatureData, setSignatureData] = useState(null);
  const [typedName, setTypedName] = useState("");
  const canvasRef = useRef(null);
  const isDrawingRef = useRef(false);

  // ── Sign-and-pay ───────────────────────────────────────────────────────────────────────────
  // ★ "awaiting" briefly covers the gap between a successful sign and knowing whether a checkout
  //   session is even needed (executeIfComplete's result names whether THIS signature completed the
  //   instrument — a co-signed agreement's first signer sees no price yet, correctly, since nothing
  //   executed for them to pay against).
  const [paymentPhase, setPaymentPhase] = useState(null); // null | "checking" | "paying" | "error"
  const [paymentInfo, setPaymentInfo] = useState(null); // {amountMinor, currency}
  const [paymentError, setPaymentError] = useState(null);
  const checkoutMountRef = useRef(null);
  const embeddedCheckoutRef = useRef(null);

  // Load the document on mount
  useEffect(() => {
    if (documentId) {
      setLoading(true);
      setError(null);
      request(`/api/app/documents/${documentId}`)
        .then((doc) => {
          setDocument(doc);
        })
        .catch((err) => {
          setError(err.message || "Failed to load document");
        })
        .finally(() => {
          setLoading(false);
        });
    }
  }, [documentId]);

  // Initialize canvas on mount and when document changes
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !document?.snapshot) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    canvas.width = canvas.offsetWidth;
    canvas.height = 110;

    // Clear and initialize
    ctx.fillStyle = getComputedStyle(window.document.documentElement).getPropertyValue("--color-surface-2").trim();
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = getComputedStyle(window.document.documentElement).getPropertyValue("--color-line").trim();
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, canvas.height - 1);
    ctx.lineTo(canvas.width, canvas.height - 1);
    ctx.stroke();

    // Setup touch/mouse events for signature
    const startDrawing = () => {
      isDrawingRef.current = true;
      setSignatureData("drawing");
    };

    const draw = (e) => {
      if (!isDrawingRef.current) return;
      const rect = canvas.getBoundingClientRect();
      const clientX = e.clientX || (e.touches && e.touches[0] && e.touches[0].clientX);
      const clientY = e.clientY || (e.touches && e.touches[0] && e.touches[0].clientY);

      if (clientX === undefined || clientY === undefined) return;

      const x = clientX - rect.left;
      const y = clientY - rect.top;

      ctx.fillStyle = getComputedStyle(window.document.documentElement).getPropertyValue("--color-ink").trim();
      ctx.beginPath();
      ctx.arc(x, y, 2, 0, Math.PI * 2);
      ctx.fill();
    };

    const stopDrawing = () => {
      isDrawingRef.current = false;
    };

    canvas.addEventListener("mousedown", startDrawing);
    canvas.addEventListener("mousemove", draw);
    canvas.addEventListener("mouseup", stopDrawing);
    canvas.addEventListener("touchstart", startDrawing);
    canvas.addEventListener("touchmove", draw);
    canvas.addEventListener("touchend", stopDrawing);

    return () => {
      canvas.removeEventListener("mousedown", startDrawing);
      canvas.removeEventListener("mousemove", draw);
      canvas.removeEventListener("mouseup", stopDrawing);
      canvas.removeEventListener("touchstart", startDrawing);
      canvas.removeEventListener("touchmove", draw);
      canvas.removeEventListener("touchend", stopDrawing);
    };
  }, [document?.snapshot]);

  // Format date
  function formatDateFullMonth(dateStr) {
    if (!dateStr) return "";
    const d = new Date(dateStr);
    return d.toLocaleDateString("en-US", { day: "numeric", month: "long" });
  }

  // Handle agree and sign
  async function handleSign() {
    if (!signatureData) {
      setError("Please sign before submitting");
      return;
    }
    if (!typedName.trim()) {
      setError("Type your full name to sign");
      return;
    }

    setSigningInProgress(true);
    setError(null);
    try {
      // ★ QUEUE §23.2.4/§23.2.5 — send what the signer actually did: the drawn mark, and THEIR OWN date and zone (the server records its own clock too). Before this the
      //   drawn mark was thrown away and the signed copy carried no date.
      const result = await request(`/api/app/documents/${documentId}/sign`, {
        method: "POST",
        body: { typedName: typedName.trim(), ...signerFacts(canvasRef.current) },
      });
      // ★ Sign-and-pay: this signature completed the instrument (executeIfComplete actually executed
      //   it, not just recorded a signature waiting on a co-signer) AND the frozen snapshot named a
      //   price — the "a service requiring an agreement" case. Anything else (still waiting on
      //   another party, or a plain agreement with no price) closes exactly as before.
      if (result?.state === "executed" && result?.snapshot?.price?.amount_minor) {
        setPaymentInfo({
          amountMinor: result.snapshot.price.amount_minor,
          currency: result.snapshot.price.currency ?? "usd",
        });
        await startCheckout();
        return;
      }
      onClose?.();
    } catch (err) {
      setError(err.message || "Failed to sign document");
    } finally {
      setSigningInProgress(false);
    }
  }

  async function startCheckout() {
    setPaymentPhase("checking");
    setPaymentError(null);
    try {
      const session = await request(`/api/app/documents/${documentId}/checkout-session`, {
        method: "POST",
      });
      const stripe = await loadStripe(session.publishableKey);
      if (!stripe) throw new Error("Payment could not load. Try again.");
      setPaymentPhase("paying");
      // ★ Mounted in the effect below, once the container ref exists (paymentPhase==="paying").
      embeddedCheckoutRef.current = { stripe, clientSecret: session.clientSecret };
    } catch (err) {
      // ★ A charges-off practice hits this as a clean 503 (ChargePathDisabled) — the instrument is
      //   already executed either way; only the payment step failed, so the document itself is not
      //   lost. Told plainly rather than silently closing as if nothing needed paying.
      setPaymentError(err.message || "Payment is not available right now. The agreement was signed — ask them how to pay.");
      setPaymentPhase("error");
    }
  }

  // Mount Stripe's embedded checkout once its container is in the DOM.
  useEffect(() => {
    if (paymentPhase !== "paying" || !checkoutMountRef.current || !embeddedCheckoutRef.current) return undefined;
    const { stripe, clientSecret } = embeddedCheckoutRef.current;
    let checkout;
    let cancelled = false;
    stripe.initEmbeddedCheckout({ clientSecret }).then((c) => {
      if (cancelled) { c.destroy(); return; }
      checkout = c;
      checkout.mount(checkoutMountRef.current);
    });
    return () => { cancelled = true; checkout?.destroy(); };
  }, [paymentPhase]);

  // Handle clear signature
  function clearSignature() {
    if (!canvasRef.current) return;
    const ctx = canvasRef.current.getContext("2d");
    if (ctx) {
      ctx.fillStyle = getComputedStyle(window.document.documentElement).getPropertyValue("--color-surface-2").trim();
      ctx.fillRect(0, 0, canvasRef.current.width, canvasRef.current.height);
      ctx.strokeStyle = getComputedStyle(window.document.documentElement).getPropertyValue("--color-line").trim();
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, canvasRef.current.height - 1);
      ctx.lineTo(canvasRef.current.width, canvasRef.current.height - 1);
      ctx.stroke();
    }
    setSignatureData(null);
  }

  const snapshot = document?.snapshot;
  const docInfo = document?.document;

  // Error state
  if (error && !loading) {
    return (
      <div className="flex flex-col h-full bg-white -mx-[18px] -mt-[2px]">
        <div className="flex items-center gap-2.5 px-[18px] py-2.5 pb-2.5 border-b border-line flex-shrink-0">
          <button
            className="text-base text-brand w-5 h-8 border-0 bg-transparent cursor-pointer p-0 flex items-center justify-center"
            onClick={onClose}
            data-testid="document-sign-back"
          >
            <ChevronLeft size={20} strokeWidth={2.25} aria-hidden="true" />
          </button>
          <div className="text-base font-medium text-ink">
            {docInfo?.title || "Document"}
          </div>
        </div>
        <ScreenState phase="error" error={error} subject="signing" />
      </div>
    );
  }

  // Loading state
  if (loading) {
    return (
      <div className="flex flex-col h-full bg-white -mx-[18px] -mt-[2px]">
        <div className="flex items-center gap-2.5 px-[18px] py-2.5 pb-2.5 border-b border-line flex-shrink-0">
          <button
            className="text-base text-brand w-5 h-8 border-0 bg-transparent cursor-pointer p-0 flex items-center justify-center"
            onClick={onClose}
          >
            <ChevronLeft size={20} strokeWidth={2.25} aria-hidden="true" />
          </button>
          <div className="text-base font-medium text-ink">Loading...</div>
        </div>
        <ScreenState phase="loading" />
      </div>
    );
  }

  // ── Sign-and-pay: the checkout step, in place of the whole normal form ──────────────────────
  if (paymentPhase) {
    return (
      <div className="flex flex-col h-full bg-white -mx-[18px] -mt-[2px]">
        <div className="flex items-center gap-2.5 px-[18px] py-2.5 pb-2.5 border-b border-line flex-shrink-0">
          <div className="flex-1">
            <div className="text-base font-medium text-ink">Signed — now, pay</div>
            {paymentInfo && (
              <div className="text-[12.5px] text-mute mt-0.5">
                {`$${(paymentInfo.amountMinor / 100).toFixed(2)} ${paymentInfo.currency.toUpperCase()}`}
              </div>
            )}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-[18px] py-3">
          {paymentPhase === "checking" && (
            <ScreenState phase="loading" />
          )}
          {paymentPhase === "error" && (
            <>
              <div className="bg-bad-soft text-bad p-3 rounded-[8px] text-[13px] mb-3" role="alert">
                {paymentError}
              </div>
              <Button onClick={() => onClose?.()} className="h-[38px] rounded-[8px]" variant="primary" data-testid="document-payment-close">
                Done
              </Button>
            </>
          )}
          {paymentPhase === "paying" && (
            <div ref={checkoutMountRef} data-testid="document-payment-checkout" />
          )}
        </div>
      </div>
    );
  }

  // Main signing form
  if (document) {
    return (
      <div className="flex flex-col h-full bg-white -mx-[18px] -mt-[2px]">
        {/* Header */}
        <div className="flex items-center gap-2.5 px-[18px] py-2.5 pb-2.5 border-b border-line flex-shrink-0">
          <button
            className="text-base text-brand w-5 h-8 border-0 bg-transparent cursor-pointer p-0 flex items-center justify-center"
            onClick={onClose}
            data-testid="document-sign-back"
          >
            <ChevronLeft size={20} strokeWidth={2.25} aria-hidden="true" />
          </button>
          <div className="flex-1">
            <div className="text-base font-medium text-ink">{docInfo?.title}</div>
            {docInfo?.sent_at && (
              <div className="text-[12.5px] text-mute mt-0.5">
                Updated {formatDateFullMonth(docInfo.sent_at)}
              </div>
            )}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-[18px] py-1.5 pb-[22px]">
          {snapshot && (
            <>
              {/* ★★★ FIX, 30 Sep 2026 — the "What changed" card here was hardcoded, fabricated copy
                  ("the cancellation window went from 48 hours to 24…") with NO backing field anywhere
                  in `document`/`snapshot` — it showed on every document, amended or not, real client or
                  test. Removed rather than left showing an invented amendment to a real signer; an
                  actual diff-on-resend feature needs its own data model and is out of this item's scope
                  (flagged separately). */}

              {/* Agreement text — FIX, 30 Sep 2026: `block.type === "text"` never matched the real
                  schema (`prose`/`variable`/…, src/documents/body.mjs), so this rendered section
                  headings with no body text at all, same defect as the emailed sign link
                  (`webreact/src/routes/sign.jsx`) — now the same shared reader both use. */}
              <div className="border border-line rounded-[14px] p-4 text-[13.5px] leading-[1.75] text-ink-2 max-h-[300px] overflow-y-auto mb-3.5">
                {snapshot.template?.sections && snapshot.template.sections.map((section, idx) => (
                  <div key={idx} className="mb-3">
                    {section.title && (
                      <h3 className="font-medium text-[14.5px] text-ink m-0 mb-2.5">
                        {section.title}
                      </h3>
                    )}
                    {renderSectionBlocks(section.blocks, snapshot.variables ?? {})}
                  </div>
                ))}
              </div>

              {/* Signature section */}
              <div className="mb-3.5">
                <label className="text-[12.5px] font-medium text-mute block mt-4.5 mb-1.5">
                  Sign here
                </label>
                <canvas
                  ref={canvasRef}
                  className="w-full h-[110px] border border-dashed border-line rounded-[14px] bg-hair cursor-crosshair block"
                  data-testid="signature-pad"
                />
                <label
                  htmlFor="ds-typed-name"
                  className="text-[12.5px] font-medium text-mute block mt-4.5 mb-1.5"
                >
                  Your full name
                </label>
                <input
                  id="ds-typed-name"
                  type="text"
                  autoComplete="name"
                  value={typedName}
                  onChange={(e) => setTypedName(e.target.value)}
                  className="w-full mt-2 p-2 border border-line rounded-[8px] font-inherit text-sm text-ink"
                  data-testid="document-typed-name"
                />
                <div className="text-[12px] text-mute mt-3 leading-[1.6]">
                  Signing records the date, the time and the device. You'll get a PDF by email and a copy stays in your Documents.
                </div>
              </div>

              {/* Error message */}
              {error && (
                <div
                  className="bg-bad-soft text-bad p-3 rounded-[8px] text-[13px] mt-3"
                  role="alert"
                >
                  {error}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex flex-col gap-2 px-[18px] py-2.5 pb-7 bg-white border-t border-hair flex-shrink-0">
          {/* ★ [TY, RULED 1 Oct 2026] site-readiness brief, Part 3 — this signs the PRACTICE's own
              document (its own terms govern the agreement itself); this note is about using
              the platform, the platform the signature runs through, same pairing the public lead form
              on the Docustay site makes ("By sending this you agree to our Terms and Privacy Policy"). */}
          <p className="text-[11.5px] leading-snug text-center" style={{ color: "var(--color-structure-600)" }} data-testid="document-sign-workbench-note">
            Signing is handled by Workbench, under its{" "}
            <a href="/legal/terms" target="_blank" rel="noopener noreferrer" className="hover:underline" style={{ color: "var(--color-action-600)" }}>Terms</a>
            {" "}and{" "}
            <a href="/legal/privacy" target="_blank" rel="noopener noreferrer" className="hover:underline" style={{ color: "var(--color-action-600)" }}>Privacy Policy</a>.
          </p>
          <Button
            onClick={handleSign}
            disabled={signingInProgress || !signatureData || !typedName.trim()}
            className="h-[38px] rounded-[8px]"
            variant="primary"
            data-testid="document-sign-submit"
          >
            {signingInProgress ? "Signing..." : "Agree and sign"}
          </Button>
          <Button
            onClick={() => {
              onAskHost?.();
              onClose?.();
            }}
            disabled={signingInProgress}
            className="h-[38px] rounded-[8px]"
            variant="outline"
            data-testid="document-ask-host"
          >
            Ask about it first
          </Button>
        </div>
      </div>
    );
  }

  return null;
}
