// SIGN AN UPLOADED DOCUMENT (QUEUE §23.4.6) — the recipient's page, reached from `/sign/pdf?t=<token>`. The token is read once and stripped from the address bar.
// ★ Real pages with the sender's fields on top; only THIS person's fields are live. Signature and initials are drawn/typed/uploaded once and reused; "Next field" walks what is left;
//   "Save and finish later" keeps what is typed on the server (never evidence until signing). The same URL serves the sender's test link: it tries the real view, then the test view, and a test never signs.
// ★ The link is spent LAST — on sign or decline — so a reload mid-way still works.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError } from "@/lib/api.js";
import { performWrite } from "@/lib/documents/ports.js";
import { Button } from "@/lib/components/ui/button";
import { Input } from "@/lib/components/ui/input";
import { Textarea } from "@/lib/components/ui/textarea";
import PageTitle from "@/lib/components/kit/PageTitle.jsx";
import { usePdf, PdfPage } from "./pdf/pdfView.jsx";
import SignaturePad from "./pdf/SignaturePad.jsx";
import { makeT } from "./pdf/signI18n.js";
import PaymentBox from "./pdf/PaymentBox.jsx";
import { validateFieldValue } from "@keystone/documents/pdfBody.mjs";

const REFUSED = "That link is not valid. It may have been used already, expired, or been cancelled — ask them for a new one.";
const TROUBLE = "Something went wrong loading this. Try reloading the page.";
const MARKS = ["signature", "initials", "image", "stamp"];
const MAX_UPLOAD = 600 * 1024;

/** A chosen file → { name, data (base64) } the request can carry. A photo too big for the request body is shrunk first (a PDF cannot be). */
async function prepareFile(file) {
  const toB64 = (blob) => new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(",")[1] ?? ""); r.onerror = () => no(new Error("That file could not be read.")); r.readAsDataURL(blob); });
  if (file.size <= MAX_UPLOAD || !/^image\//.test(file.type)) {
    if (file.size > MAX_UPLOAD) throw new Error("That file is over 600 KB. Send a smaller one, or a photo of it.");
    return { name: file.name, data: await toB64(file) };
  }
  const bmp = await createImageBitmap(file);
  let scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height)), quality = 0.82, blob = null;
  for (let tries = 0; tries < 6; tries += 1) {
    const c = document.createElement("canvas"); c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
    c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
    blob = await new Promise((ok) => c.toBlob(ok, "image/jpeg", quality));
    if (blob && blob.size <= MAX_UPLOAD) break;
    scale *= 0.8; quality = Math.max(0.5, quality - 0.08);
  }
  if (!blob || blob.size > MAX_UPLOAD) throw new Error("That picture is too large to send. Try a smaller one.");
  return { name: file.name.replace(/\.[^.]+$/, "") + ".jpg", data: await toB64(blob) };
}

function zone() { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || null; } catch { return null; } }

export default function SignPdfPage() {
  const [phase, setPhase] = useState("loading");        // loading | refused | trouble | ready | signing | signed | declined | waiting
  const [view, setView] = useState(null);
  const [test, setTest] = useState(false);
  const [vals, setVals] = useState({});
  const [marks, setMarks] = useState({});               // { signature, initials } reused across fields
  const [padFor, setPadFor] = useState(null);           // the field being signed
  const [name, setName] = useState("");
  const [consent, setConsent] = useState(false);
  const [problem, setProblem] = useState(null);
  const [saved, setSaved] = useState(null);
  const [decline, setDecline] = useState(false);
  const [reason, setReason] = useState("");
  const [why, setWhy] = useState(""), [method, setMethod] = useState(null);
  const [delegating, setDelegating] = useState(false), [dName, setDName] = useState(""), [dEmail, setDEmail] = useState(""), [passedTo, setPassedTo] = useState(null);
  const [width, setWidth] = useState(720);
  const t = useMemo(() => makeT(view?.language), [view?.language]);     // §23.5.6 — the language the sender chose (en | es | fr | de)
  const token = useRef(null), column = useRef(null), kiosk = useRef(false);

  const api = (path, body) => performWrite(null, `POST /api/public/pdf/${path}`, [{ body: { presented: token.current, ...body } }]);
  useEffect(() => {
    const qs = new URLSearchParams(window.location.search);
    const t = qs.get("t");
    kiosk.current = qs.get("k") === "1";
    window.history.replaceState(null, "", window.location.pathname);
    if (!t) { setPhase("refused"); return; }
    token.current = t;
    (async () => {
      try {
        let v; try { v = await api("view", {}); } catch (e) { if (e instanceof ApiError && e.status === 403) { v = await api("test/view", {}); setTest(true); } else throw e; }
        setView(v); setName(v.party.name ?? ""); setVals(v.progress ?? {});
        if (v.gate) { setPhase("gate"); return; }
        setPhase(v.party.signed ? "signed" : v.waitingFor ? "waiting" : v.document.state === "declined" ? "declined" : "ready");
      } catch (e) { setPhase(e instanceof ApiError && e.status === 403 ? "refused" : "trouble"); }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { document.title = view?.document?.title ?? "Sign"; }, [view]);
  // ★ kiosk: after the person has signed (or declined), the device goes back to the start for the next person
  useEffect(() => { if (!kiosk.current || (phase !== "signed" && phase !== "declined")) return undefined; const id = setTimeout(() => window.location.assign("/documents/kiosk"), 6000); return () => clearTimeout(id); }, [phase]);
  useEffect(() => { const f = () => setWidth(Math.max(280, Math.min(820, (column.current?.clientWidth ?? window.innerWidth) - 8))); f(); window.addEventListener("resize", f); return () => window.removeEventListener("resize", f); }, [phase]);

  const policy = view?.policy ?? {};     // the organisation's signing rules (src/documents/signingPolicy.mjs), read live by the server and drawn here exactly as the other signing page draws them
  const accent = /^#[0-9a-fA-F]{6}$/.test(view?.brand?.accent ?? "") ? view.brand.accent : null;     // §23.5.9 — the practice's own colour, only ever a plain hex
  const [payFor, setPayFor] = useState(null);                       // the payment field being paid (opens the card form)
  const paidOf = useMemo(() => Object.fromEntries((view?.payments ?? []).filter((p) => p.paid).map((p) => [p.fieldId, p])), [view]);
  const doc = view?.documents?.[0];
  const role = view?.party?.actionRole ?? "signer";            // signer | approver | viewer | assistant (QUEUE §23.5.16)
  const loadBytes = useCallback(async () => {
    const r = await fetch(`/api/public/pdf/${test ? "test/" : ""}file`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ presented: token.current, documentId: doc.id }), cache: "no-store" });
    if (!r.ok) throw new Error("the pages could not be loaded");
    return r.arrayBuffer();
  }, [doc?.id, test]);
  const { pdf, error: pdfError } = usePdf(loadBytes, phase === "loading" || !doc ? null : `${doc.id}:${test}`);

  const mine = useMemo(() => (doc?.fields ?? []).filter((f) => f.mine && f.type !== "date_signed"), [doc]);
  const valueOf = (f) => (f.type === "payment" ? (paidOf[f.id] ? "paid" : null) : f.type === "signature" ? marks.signature : f.type === "initials" ? marks.initials : vals[f.id]) ?? (f.default && !vals[f.id] ? f.default : null);
  const open = role === "signer" ? mine.filter((f) => validateFieldValue(f, valueOf(f)) !== null) : [];     // an assistant's details are all optional
  const set = (id, v) => setVals((s) => ({ ...s, [id]: v }));
  const [fileNames, setFileNames] = useState({});     // field id → the name of the file this person uploaded
  const uploadTo = (f) => async (file) => {
    setProblem(null);
    try { const { name: n, data } = await prepareFile(file); const r = await api("upload-file", { fieldId: f.id, name: n, data }); set(f.id, r.fileId); setFileNames((m) => ({ ...m, [f.id]: r.name })); }
    catch (e) { setProblem(e.message || t("That file could not be uploaded.")); }
  };
  const goNext = () => { const f = open[0]; if (!f) return; document.querySelector(`[data-field="${f.id}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" }); if (f.type === "payment") setPayFor(f); else if (MARKS.includes(f.type) && f.type !== "image") setPadFor(f); else document.querySelector(`[data-field="${f.id}"] input, [data-field="${f.id}"] select`)?.focus(); };

  const payload = () => {
    const values = {}; for (const f of mine) { const v = valueOf(f); if (v != null && !MARKS.includes(f.type) && f.type !== "payment") values[f.id] = v; if (f.type === "image" && vals[f.id]) values[f.id] = vals[f.id]; }
    return values;
  };
  // ★ §23.5.2 — the check before the document opens
  const [code, setCode] = useState("");
  const [gateMsg, setGateMsg] = useState(null);
  async function reload() {
    try { const v = await api("view", {}); setView(v); setName(v.party.name ?? ""); setVals(v.progress ?? {}); setPhase(v.gate ? "gate" : v.party.signed ? "signed" : v.waitingFor ? "waiting" : "ready"); }
    catch { setPhase("trouble"); }
  }
  async function askCode() {
    setGateMsg(null);
    try { const r = await api("send-code", {}); setGateMsg(t("We emailed a code to {{to}}. It works for {{minutes}} minutes.", { to: r.to, minutes: r.validMinutes })); await reload(); }
    catch (e) { setGateMsg(e.message || t("The code could not be sent.")); }
  }
  async function submitCode() {
    setGateMsg(null);
    try { const r = await api("verify", { code }); if (r.verified) { setCode(""); await reload(); } else { setGateMsg(r.message); if (r.code === "locked") await reload(); } }
    catch (e) { setGateMsg(e.message || t("Something went wrong. Try again.")); }
  }
  async function save() {
    try { await api("progress", { values: payload() }); setSaved(t("Saved. Use this same link to carry on.")); } catch { setSaved(t("That could not be saved. Try again.")); }
  }
  async function sign() {
    if (test) { setProblem(t("This is a test — nothing is recorded and you cannot sign.")); return; }
    if (!name.trim()) return setProblem(t("Type your full name to sign."));
    if (open.length) return setProblem(open.length === 1 ? t("{{n}} field still needs filling in.", { n: 1 }) : t("{{n}} fields still need filling in.", { n: open.length }));
    if (policy.requireReason && !why.trim()) return setProblem(t("Say why you are signing (for example, your role or capacity)."));
    if (!consent) return setProblem(t("Agree to sign electronically first."));
    setProblem(null); setPhase("signing");
    try { await api("sign", { typedName: name.trim(), consent: true, marks: { signature: marks.signature, initials: marks.initials }, values: payload(), signerTimezone: zone(), signatureMethod: method, ...(policy.requireReason ? { reason: why.trim() } : {}) }); setPhase("signed"); }
    catch (e) {
      if (e instanceof ApiError && e.status === 403) setPhase("refused");
      else if (e instanceof ApiError && e.status === 409) { setView((v) => ({ ...v, waitingFor: [e.body?.error?.detail?.waitingFor ?? "someone"].flat() })); setPhase(e.body?.error?.detail?.code === "not_your_turn" ? "waiting" : "signed"); }
      else { setProblem(e.message || t("Something went wrong sending your signature. Try again.")); setPhase("ready"); }
    }
  }
  // ★ §23.5.16 — the other roles. Each finishes with one call; the link is spent by the server only when their part is done.
  const [doneKind, setDoneKind] = useState("signed");
  const [comment, setComment] = useState("");
  const [changes, setChanges] = useState(false), [changesText, setChangesText] = useState("");
  const guard = (fn) => async () => {
    if (test) { setProblem(t("This is a test — nothing is recorded.")); return; }
    setProblem(null);
    try { await fn(); } catch (e) {
      if (e instanceof ApiError && e.status === 403) setPhase("refused");
      else if (e instanceof ApiError && e.status === 409 && e.body?.error?.detail?.code === "not_your_turn") setPhase("waiting");
      else setProblem(e.message || t("Something went wrong. Try again."));
    }
  };
  const decide = (decision) => guard(async () => {
    if (decision === "reject" && view.requireDeclineReason && !comment.trim()) { setProblem(t("Please tell them why you are rejecting it.")); return; }
    await api("decide", { decision, comment: comment.trim() || null }); if (decision === "reject") setPhase("declined"); else { setDoneKind("approved"); setPhase("signed"); }
  });
  const acknowledge = guard(async () => { await api("acknowledge", {}); setDoneKind("viewed"); setPhase("signed"); });
  const assist = (finish) => guard(async () => {
    const values = {}; for (const f of mine) if (vals[f.id] != null && vals[f.id] !== "") values[f.id] = vals[f.id];
    await api("assist", { values, finish }); if (finish) { setDoneKind("assisted"); setPhase("signed"); } else setSaved(t("Saved."));
  });
  const askChanges = guard(async () => {
    if (!changesText.trim()) { setProblem(t("Tell them what needs to change.")); return; }
    await api("request-changes", { message: changesText.trim() }); setSaved(t("Sent. They will get your note — you can still sign or decline.")); setChanges(false); setChangesText("");
  });
  async function delegateNow() {
    if (!dName.trim() || !dEmail.trim()) return setProblem(t("Give their name and email."));
    setProblem(null);
    try { const r = await api("delegate", { name: dName.trim(), email: dEmail.trim() }); setPassedTo(r?.to ?? { name: dName.trim(), email: dEmail.trim() }); setPhase("delegated"); } catch (e) { setProblem(e.message || t("Something went wrong. Try again.")); }
  }
  async function declineNow() {
    if (view.requireDeclineReason && !reason.trim()) return setProblem(t("Please tell them why you are declining."));
    if (test) { setProblem(t("This is a test — nothing is recorded.")); return; }
    try { await api("decline", { reason: reason.trim() || null }); setPhase("declined"); } catch (e) { setProblem(e.message || t("Something went wrong. Try again.")); }
  }

  const Center = ({ id, title, children }) => <div className="mx-auto flex max-w-[44ch] flex-1 flex-col items-center justify-center gap-3 px-6 py-16 text-center" data-testid={id}>{title && <PageTitle>{title}</PageTitle>}{children}</div>;
  let inner;
  if (phase === "loading") inner = <Center id="signpdf-loading"><p className="m-0 text-body text-mute">{t("Loading…")}</p></Center>;
  else if (phase === "refused" || phase === "trouble") inner = <Center id="signpdf-refused" title={t("This link isn't working")}><p role="alert" className="m-0 text-body">{phase === "refused" ? t(REFUSED) : t(TROUBLE)}</p></Center>;
  else if (phase === "gate") inner = (
    <Center id="signpdf-gate" title={view.document.title}>
      <p className="m-0 text-body" data-testid="signpdf-gate-text">{view.gate.kind === "email_code" ? `${t("{{org}} needs to check it's you.", { org: view.org?.name ?? t("The sender") })} ${view.gate.codeSent ? t("Enter the code we emailed to {{email}}.", { email: view.gate.email }) : t("We'll email a code to {{email}}.", { email: view.gate.email })}` : t("{{org}} gave you an access code for this document. Enter it to open it.", { org: view.org?.name ?? t("The sender") })}</p>
      {view.gate.locked ? <p role="alert" className="m-0 text-meta text-bad" data-testid="signpdf-gate-locked">{t("Too many wrong tries. Try again in a few minutes.")}</p> : (
        <form className="flex w-full max-w-[320px] flex-col gap-2" onSubmit={(e) => { e.preventDefault(); submitCode(); }}>
          {view.gate.kind === "email_code" && <Button type="button" variant="outline" onClick={askCode} data-testid="signpdf-send-code">{view.gate.codeSent ? t("Send a new code") : t("Email me a code")}</Button>}
          <Input value={code} onChange={(e) => setCode(e.currentTarget.value)} inputMode={view.gate.kind === "email_code" ? "numeric" : "text"} autoComplete="one-time-code" aria-label={view.gate.kind === "email_code" ? t("Code from your email") : t("Access code")} placeholder={view.gate.kind === "email_code" ? t("6-digit code") : t("Access code")} data-testid="signpdf-code" />
          <Button type="submit" disabled={!code.trim()} data-testid="signpdf-open">{t("Open the document")}</Button>
        </form>)}
      {gateMsg && <p role="status" className="m-0 text-meta text-ink-2" data-testid="signpdf-gate-msg">{gateMsg}</p>}
    </Center>
  );
  else if (phase === "signed") inner = <Center id="signpdf-signed" title={doneKind === "approved" ? t("You've approved it") : doneKind === "viewed" ? t("Thank you") : doneKind === "assisted" ? t("Details saved") : t("You've signed")}><p className="m-0 text-body">{kiosk.current ? t("Thank you — this screen will reset for the next person. ") : ""}{doneKind === "assisted" ? t("{{name}} will check what you filled in and sign it themselves. ", { name: view?.party?.assistsName ?? t("The signer") }) : doneKind === "viewed" ? t("We have noted that you looked at it. ") : ""}{view?.party?.name ? t("Thank you, {{name}}. ", { name: view.party.name }) : t("Thank you. ")}{view?.otherParties?.some((p) => p.actionRole === "signer" && p.status !== "signed") ? t("We'll tell everyone once the last person has signed.") : t("Everyone has signed — you'll get a copy by email.")}</p></Center>;
  else if (phase === "delegated") inner = <Center id="signpdf-delegated" title={t("Passed on")}><p className="m-0 text-body">{t("{{name}} has been sent this document to sign. You can close this page.", { name: passedTo?.name ?? t("They") })}</p></Center>;
  else if (phase === "declined") inner = <Center id="signpdf-declined" title={t("Declined")}><p className="m-0 text-body">{t("The sender has been told. You can close this page.")}</p></Center>;
  else if (phase === "waiting") inner = <Center id="signpdf-waiting" title={t("Not your turn yet")}><p className="m-0 text-body">{t("{{who}} signs first. We'll email you when it's your turn.", { who: (view?.waitingFor ?? []).join(", ") || t("Someone else") })}</p></Center>;
  else inner = (
    <div className="mx-auto w-full max-w-[860px] px-3 pb-32 pt-4" ref={column} data-testid="signpdf-ready">
      <header className="mb-3 space-y-1" style={accent ? { borderTop: `4px solid ${accent}`, paddingTop: 10 } : undefined} data-testid="signpdf-header">
        {view.brand?.showLogo !== false && view.org?.logoUrl ? <img src={view.org.logoUrl} alt={view.org?.name ?? ""} className="mb-1 h-9 w-auto" data-testid="signpdf-logo" /> : null}
        {view.org?.name && <p className="m-0 text-caption text-mute">{view.org.name}</p>}
        <PageTitle>{view.document.title}</PageTitle>
        {test && <p className="m-0 rounded bg-paper px-3 py-2 text-meta text-ink" role="status" data-testid="signpdf-test">{t("This is a test. It shows what the signer sees; nothing you do here is recorded.")}</p>}
        {view.brand?.note && <p className="m-0 text-meta text-mute" data-testid="signpdf-note">{view.brand.note}</p>}
        {view.document.message && <p className="m-0 text-body text-ink-2">{view.document.message}</p>}
      </header>
      {view.attachments?.length > 0 && (
        <div className="mb-3 rounded border border-line bg-surface p-3" data-testid="signpdf-attachments"><p className="m-0 mb-1 text-ui font-medium">{t("Also included — read these with the document")}</p>
          <ul className="m-0 list-none space-y-1 p-0">{view.attachments.map((a) => <li key={a.id}><button type="button" className="text-ui underline" onClick={async () => { const r = await fetch("/api/public/pdf/attachment", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ presented: token.current, fileId: a.id }), cache: "no-store" }); if (!r.ok) { setProblem(t("That file could not be opened.")); return; } const u = URL.createObjectURL(await r.blob()); const l = document.createElement("a"); l.href = u; l.download = a.name; l.click(); setTimeout(() => URL.revokeObjectURL(u), 5000); }}>{a.name}</button> <span className="text-caption text-mute">{Math.max(1, Math.round(a.size / 1024))} KB</span></li>)}</ul></div>)}
      {pdfError && <p role="alert" className="text-bad">{t("The pages could not be loaded.")}</p>}
      <div className="space-y-4" aria-label={t("Document pages")}>
        {(doc?.file.pages ?? []).map((_, i) => (
          <div key={i} className="mx-auto" style={{ width }}>
            <PdfPage pdf={pdf} pageNumber={i + 1} width={width}>
              {doc.fields.filter((f) => f.page === i + 1).map((f) => <FieldBox key={f.id} f={f} width={width} value={f.mine ? valueOf(f) : f.filled?.mark ?? f.filled?.value} live={f.mine} fileName={fileNames[f.id]} t={t} paid={paidOf[f.id]} onPay={() => setPayFor(f)} onSet={(v) => set(f.id, v)} onSign={() => setPadFor(f)} onFile={uploadTo(f)} />)}
            </PdfPage>
          </div>
        ))}
      </div>
      {payFor && <PaymentBox field={payFor} api={api} t={t} onClose={() => setPayFor(null)} onPaid={(label) => { setView((v) => ({ ...v, payments: [...(v.payments ?? []).filter((p) => p.fieldId !== payFor.id), { fieldId: payFor.id, paid: true, label }] })); setPayFor(null); }} />}
      {padFor && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={`Add your ${padFor.type}`}>
          <div className="w-full max-w-[520px] rounded-t-card bg-surface p-4 sm:rounded-card">
            <SignaturePad allowTyped={policy.allowTyped !== false} canRemember={!kiosk.current && policy.rememberSignature === true} label={padFor.type === "initials" ? "initials" : padFor.type === "image" ? "picture" : "signature"} defaultName={padFor.type === "initials" ? name.split(/\s+/).map((w) => w[0]).join("").toUpperCase() : name}
              onDone={(url, m) => { if (padFor.type === "signature" || padFor.type === "initials") { setMarks((mk) => ({ ...mk, [padFor.type]: url })); if (padFor.type === "signature") setMethod(m ?? null); } else set(padFor.id, url); setPadFor(null); }} onCancel={() => setPadFor(null)} />
          </div>
        </div>
      )}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface px-3 py-3" data-testid="signpdf-bar">
        {role === "approver" && (
          <div className="mx-auto flex max-w-[860px] flex-wrap items-center gap-3" data-testid="signpdf-approver">
            <span className="text-meta text-ink-2">{t("{{name}}: please look this over, then approve or reject.", { name: view.party.name })}</span>
            <Input className="min-w-[220px] flex-1" value={comment} onChange={(e) => setComment(e.currentTarget.value)} placeholder={view.requireDeclineReason ? t("A note (required if you reject)") : t("A note (optional)")} aria-label={t("A note for the sender")} data-testid="signpdf-comment" />
            <Button onClick={decide("approve")} data-testid="signpdf-approve">{t("Approve")}</Button>
            <Button variant="outline" onClick={decide("reject")} data-testid="signpdf-reject">{t("Reject")}</Button>
          </div>)}
        {role === "viewer" && (
          <div className="mx-auto flex max-w-[860px] flex-wrap items-center gap-3" data-testid="signpdf-viewer">
            <span className="text-meta text-ink-2">{t("You are asked only to look at this document.")}</span>
            <Button onClick={acknowledge} data-testid="signpdf-acknowledge">{t("I have viewed this document")}</Button>
          </div>)}
        {role === "assistant" && (
          <div className="mx-auto flex max-w-[860px] flex-wrap items-center gap-3" data-testid="signpdf-assistant">
            <span className="text-meta text-ink-2">{t("You are filling in details for {{name}}. They will check them and sign themselves.", { name: view.party.assistsName ?? t("the signer") })}</span>
            <Button variant="outline" onClick={assist(false)} data-testid="signpdf-assist-save">{t("Save")}</Button>
            <Button onClick={assist(true)} data-testid="signpdf-assist-finish">{t("Save and finish")}</Button>
          </div>)}
        {role === "signer" && <div className="mx-auto flex max-w-[860px] flex-wrap items-center gap-3">
          <span className="text-meta text-ink-2" role="status" data-testid="signpdf-left">{open.length ? t("{{n}} to fill in", { n: open.length }) : t("All filled in")}</span>
          {open.length > 0 && <Button size="sm" variant="outline" onClick={goNext} data-testid="signpdf-next">{t("Next field")}</Button>}
          <Input className="w-[200px]" value={name} onChange={(e) => setName(e.currentTarget.value)} placeholder={t("Your full name")} aria-label={t("Your full name")} data-testid="signpdf-name" />
          {policy.requireReason && <Input className="w-[220px]" value={why} onChange={(e) => setWhy(e.currentTarget.value)} maxLength={500} placeholder={t("Why you are signing")} aria-label={t("Why you are signing")} data-testid="signpdf-reason" />}
          <label className="flex items-center gap-2 text-caption text-ink-2"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} data-testid="signpdf-consent" /><span title={view.consent.text}>{t("I agree to sign electronically")}</span></label>
          <Button disabled={phase === "signing"} onClick={sign} style={accent ? { backgroundColor: accent, color: "#fff" } : undefined} data-testid="signpdf-finish">{t("Finish and sign")}</Button>
          <Button size="sm" variant="ghost" onClick={save} data-testid="signpdf-save">{t("Save and finish later")}</Button>
          {policy.allowDelegate === true && <Button size="sm" variant="ghost" onClick={() => setDelegating((d) => !d)} data-testid="signpdf-delegate">{t("Pass this to someone else")}</Button>}
          {policy.allowDecline !== false && <Button size="sm" variant="ghost" onClick={() => setDecline((d) => !d)} data-testid="signpdf-decline">{t("Decline")}</Button>}
        </div>}
        {(role === "signer" || role === "approver") && <div className="mx-auto mt-1 max-w-[860px]"><Button size="sm" variant="ghost" onClick={() => setChanges((c) => !c)} data-testid="signpdf-changes">{t("Ask for changes")}</Button></div>}
        {delegating && (
          <form className="mx-auto mt-2 flex max-w-[860px] flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); delegateNow(); }} data-testid="signpdf-delegate-box">
            <Input className="w-[200px]" value={dName} onChange={(e) => setDName(e.currentTarget.value)} placeholder={t("Their full name")} aria-label={t("Their full name")} />
            <Input className="w-[240px]" type="email" value={dEmail} onChange={(e) => setDEmail(e.currentTarget.value)} placeholder={t("Their email")} aria-label={t("Their email")} />
            <Button type="submit" variant="outline" data-testid="signpdf-delegate-send">{t("Pass it on")}</Button>
          </form>
        )}
        {changes && (
          <div className="mx-auto mt-2 max-w-[860px] space-y-2" data-testid="signpdf-changes-box">
            <Textarea value={changesText} onChange={(e) => setChangesText(e.currentTarget.value)} placeholder={t("What needs to change? They will see your note.")} aria-label={t("What needs to change")} maxLength={1000} />
            <Button variant="outline" onClick={askChanges} data-testid="signpdf-changes-send">{t("Send my note")}</Button>
          </div>
        )}
        {saved && <p className="m-0 mx-auto mt-1 max-w-[860px] text-caption text-mute" role="status">{saved}</p>}
        {problem && <p className="m-0 mx-auto mt-1 max-w-[860px] text-meta text-bad" role="alert" data-testid="signpdf-problem">{problem}</p>}
        {decline && (
          <div className="mx-auto mt-2 max-w-[860px] space-y-2" data-testid="signpdf-decline-box">
            <Textarea value={reason} onChange={(e) => setReason(e.currentTarget.value)} placeholder={view.requireDeclineReason ? t("Why are you declining? (required)") : t("Why are you declining? (optional)")} aria-label={t("Reason for declining")} />
            <Button variant="outline" onClick={declineNow} data-testid="signpdf-decline-confirm">{t("Decline this document")}</Button>
          </div>
        )}
      </div>
    </div>
  );
  return <div className="flex min-h-screen flex-col bg-paper">{inner}</div>;
}

/** One field drawn on its page. Other people's fields are shown quietly (their mark once signed); mine are live. */
function FieldBox({ f, width, value, live, onSet, onSign, onFile, fileName, t = (k) => k, paid = null, onPay = null }) {
  const style = { position: "absolute", left: `${f.x * 100}%`, top: `${f.y * 100}%`, width: `${f.w * 100}%`, height: `${f.h * 100}%` };
  const cls = live ? "border-2 border-ink bg-yellow-100/70" : "border border-dashed border-line bg-transparent";
  const fs = Math.max(8, Math.min(14, f.h * width * 1.2));
  if (f.type === "date_signed") return <div style={{ ...style, fontSize: Math.max(7, fs * 0.85) }} className={`flex items-center overflow-hidden whitespace-nowrap px-1 text-mute ${cls}`} data-field={f.id}><span className="truncate">{live ? t("Date (on signing)") : ""}</span></div>;
  if (MARKS.includes(f.type)) {
    return (
      <button type="button" style={style} disabled={!live} onClick={onSign} className={`flex items-center justify-center overflow-hidden ${cls}`} data-field={f.id} data-filled={value ? "1" : "0"} aria-label={`${f.label || f.type}${live ? "" : ` for ${f.seatName ?? "someone else"}`}`}>
        {value ? <img src={value} alt="" className="max-h-full max-w-full object-contain" /> : live ? <span className="text-caption text-ink">{f.type === "signature" ? t("Sign here") : f.type === "initials" ? t("Initial") : f.type === "stamp" ? t("Add stamp") : t("Add picture")}{f.required ? "" : t(" (optional)")}</span> : null}
      </button>
    );
  }
  if (f.type === "payment") return <button type="button" style={style} disabled={!live || Boolean(paid)} onClick={onPay} className={`flex items-center justify-center overflow-hidden px-1 text-caption ${cls}`} data-field={f.id} data-filled={paid ? "1" : "0"}>{paid ? `✓ ${t("Paid")} ${paid.label}` : live ? `${t("Pay")}${f.amount_minor ? ` ${new Intl.NumberFormat("en-US", { style: "currency", currency: (f.currency ?? "usd").toUpperCase() }).format(f.amount_minor / 100)}` : ""}` : ""}</button>;
  if (!live) return <div style={style} className={`overflow-hidden px-1 ${cls}`} data-field={f.id} />;
  if (f.type === "file") return <label style={style} className={`flex cursor-pointer items-center gap-1 overflow-hidden px-1 text-caption ${cls}`} data-field={f.id}><input type="file" accept="image/png,image/jpeg,application/pdf,.docx,.xlsx,.pptx" className="sr-only" onChange={(e) => { const x = e.target.files?.[0]; if (x) onFile?.(x); e.target.value = ""; }} aria-label={f.label || t("Upload a file")} />{value ? `✓ ${fileName ?? t("file added")}` : `${f.label || t("Upload a file")}${f.required ? "" : t(" (optional)")}`}</label>;
  if (f.type === "multiselect") {
    let chosen = []; try { chosen = value ? JSON.parse(value) : []; } catch { chosen = []; }
    const toggle = (o) => onSet(JSON.stringify(chosen.includes(o) ? chosen.filter((x) => x !== o) : [...chosen, o]));
    return <details style={style} className={`overflow-visible ${cls}`} data-field={f.id}><summary className="cursor-pointer truncate px-1" style={{ fontSize: fs }}>{chosen.length ? chosen.join(", ") : (f.label || t("Pick any"))}</summary><div className="absolute left-0 top-full z-20 mt-1 min-w-[160px] space-y-1 rounded border border-line bg-surface p-2 shadow">{(f.options ?? []).map((o) => <label key={o} className="flex items-center gap-2 text-ui"><input type="checkbox" checked={chosen.includes(o)} onChange={() => toggle(o)} />{o}</label>)}</div></details>;
  }
  if (f.type === "checkbox") return <div style={style} className={`flex items-center justify-center ${cls}`} data-field={f.id}><input type="checkbox" checked={value === "true"} onChange={(e) => onSet(e.target.checked ? "true" : "false")} aria-label={f.label || t("Tick")} className="h-[70%] w-[70%]" /></div>;
  if (f.type === "dropdown") return <div style={style} className={cls} data-field={f.id}><select value={value ?? ""} onChange={(e) => onSet(e.target.value)} aria-label={f.label || t("Choose…")} className="h-full w-full bg-transparent px-1" style={{ fontSize: fs }}><option value="">{f.label || t("Choose…")}</option>{(f.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}</select></div>;
  return <div style={style} className={cls} data-field={f.id}><input value={value ?? ""} maxLength={f.max_length ?? 500} onChange={(e) => onSet(e.target.value)} placeholder={f.label || t("Type here")} aria-label={f.label || "Text"} inputMode={f.validation === "number" ? "decimal" : f.validation === "phone" ? "tel" : f.validation === "email" ? "email" : undefined} className="h-full w-full bg-transparent px-1 outline-none" style={{ fontSize: fs }} /></div>;
}
