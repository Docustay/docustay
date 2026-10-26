<script>
  import { onMount } from "svelte";
  import { newKey } from "$lib/api.js";
  import { loadPdf } from "$lib/pdf.js";
  import { validateFieldValue } from "$lib/validate.js";
  import { hiddenNow, computeFormulas } from "$lib/rules/rules.js";
  import PdfPage from "$lib/PdfPage.svelte"; import Doodle from "$lib/doodle/Doodle.svelte";
  import { Coin, PayCard3D, ReceiptPrint } from "$lib/fx3d/index.js";
  import SignaturePad from "$lib/SignaturePad.svelte";
  import Ribbon from "$lib/ui/Ribbon.svelte"; import Seal from "$lib/ui/Seal.svelte";
  import { wordsFor, dirOf, fmt, serverMessage } from "$lib/i18n.js";
  import { modal } from "$lib/ui/modal.js";
  import { closeDetails } from "$lib/ui/closeDetails.js";

  const MARKS = ["signature", "initials", "image", "stamp"];
  let phase = $state("loading"), view = $state(null), token = null, test = $state(false), lastOne = $state(false), downloadUrl = $state(null);
  let vals = $state({}), marks = $state({}), name = $state(""), consent = $state(false), problem = $state(null), saved = $state(null);
  let pdf = $state(null), pdfError = $state(false), padFor = $state(null), declining = $state(false), reason = $state(""), code = $state(""), gateMsg = $state(null);
  let changing = $state(false), changeText = $state(""), changeSent = $state(false);   // R13-D052: "Ask for changes" (the server had it; no screen did)
  let method = $state(null), why = $state(""), delegating = $state(false), dName = $state(""), dEmail = $state(""), delegated = $state(null);
  let column = $state(null), width = $state(720), waitingFor = $state([]);
  // Run 8 J6: on a phone a date field opens the phone's own date picker (its value is YYYY-MM-DD, the format the field checks); a mouse keeps the plain box, which fits the paper
  const coarse = typeof matchMedia !== "undefined" && matchMedia("(pointer: coarse)").matches;
  // Part 30 item 4 — embedded in a customer's own page: events go to ONE parent website, and only if the organisation listed it
  let embedTo = $state(null), lastTold = null, embedQ = $state(false);
  function tell(type, extra = {}) { if (embedTo && window.parent !== window) window.parent.postMessage({ source: "docustay", version: 1, type, documentId: view?.documents?.[0]?.id ?? null, ...extra }, embedTo); }

  async function call(path, body) {
    // R13-D169: no network made fetch THROW "Failed to fetch" and the signer read that; say it is the connection and that nothing they entered is lost
    const r = await fetch(`/api/public/pdf/${path}`, { method: "POST", headers: { "content-type": "application/json", "idempotency-key": newKey() }, body: JSON.stringify({ presented: token, ...body }) }).catch(() => { throw Object.assign(new Error(T.sp.offline ?? "You seem to be offline. Nothing you entered is lost: check your connection, then press the button again."), { status: 0 }); });
    const json = await r.json().catch(() => null);
    if (!r.ok) throw Object.assign(new Error(json?.error?.message ? serverMessage(lang, json.error.message) : T.sp.wentWrong), { status: r.status, detail: json?.error?.detail });
    return json;
  }
  // Docustay v1: English only. A document sent earlier in another language is shown in English (the server answers "en"); the words table keeps its shape so nothing else changes.
  const lang = "en", browserLang = () => null;
  const T = $derived(wordsFor(lang));
  // Run 8 R8-70 (WCAG 3.1.1): the words were in the signer's language but <html lang> stayed "en" — a screen reader read the page as English; the page's own language follows what it shows
  $effect(() => { if (typeof document !== "undefined") { document.documentElement.lang = lang ?? "en"; document.documentElement.dir = dirOf(lang); } });
  async function openExtra(a) {
    try {
      const r = await fetch("/api/public/pdf/attachment", { method: "POST", headers: { "content-type": "application/json", "idempotency-key": newKey() }, body: JSON.stringify({ presented: token, fileId: a.id }) });
      if (!r.ok) throw new Error(String(r.status));
      const url = URL.createObjectURL(await r.blob()), el = document.createElement("a");
      el.href = url; el.download = a.name; el.click(); setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch { problem = T.sp.wentWrong; }
  }
  let roleDone = $state(null), roleComment = $state(""), busyRole = $state(false), upBusy = $state({}), payFor = $state(null), payMsg = $state(null), payBusy = $state(false);
  const doc = $derived(view?.documents?.[0]);
  // Run 9 — the same rules the server re-checks (src/documents/rules.mjs, copied to $lib/rules): what earlier people signed, what the sender locked, and this person's own answers decide which
  // boxes and pages are part of the document, and what a box that works itself out reads. The server decides again when they sign; this only shows it as they type.
  const known = $derived.by(() => {
    const k = {};
    for (const f of doc?.fields ?? []) { if (f.filled?.value != null) k[f.id] = f.filled.value; else if (f.locked && f.default != null) k[f.id] = String(f.default); }
    for (const f of doc?.fields ?? []) if (f.mine && !f.calc && typeof vals[f.id] === "string" && k[f.id] == null) k[f.id] = vals[f.id];
    return k;
  });
  const hidden = $derived(doc ? hiddenNow({ fields: doc.fields, pages: (view?.pageRules ?? []).find((r) => r.documentId === doc.id)?.rules ?? [] }, known) : { fields: new Set(), pages: new Set() });
  const worked = $derived(doc ? computeFormulas(doc.fields.filter((f) => !hidden.fields.has(f.id)), Object.fromEntries(Object.entries(known).filter(([id]) => !hidden.fields.has(id)))) : {});
  const mine = $derived((doc?.fields ?? []).filter((f) => f.mine && f.type !== "date_signed" && !hidden.fields.has(f.id)));
  let witnessing = $state(false), wName = $state(""), wEmail = $state(""), wMark = $state(null);
  const WITNESS_PAD = "signature";   // the pad's mode (a drawn signature), not words anyone reads
  const role = $derived(view?.party?.actionRole ?? "signer");
  const paidIds = $derived(new Set((view?.payments ?? []).filter((p) => p.paid).map((p) => p.fieldId)));
  const valueOf = (f) => f.calc ? (worked[f.id] ?? null) : (f.type === "signature" ? marks.signature : f.type === "initials" ? marks.initials : f.type === "payment" ? (paidIds.has(f.id) || vals[f.id] === "paid" ? "paid" : null) : vals[f.id]) ?? (f.default && !vals[f.id] ? f.default : null);
  // Run 9 Part 3.7 (R9-l): THE SIGNER PAYS LAST — a payment box never holds up Finish; the signature is kept while they pay, straight after
  // R13-D232: one check for every role's page — the server's own rule (validate.js). A helper fills nothing they must, so only a value in the wrong form holds them up; the message names the box and the rule.
  const checkOf = (f) => validateFieldValue(role === "assistant" ? { ...f, required: false } : f, valueOf(f));
  const open = $derived(role === "signer" || role === "assistant" ? mine.filter((f) => f.type !== "payment" && checkOf(f) !== null) : []);
  const whatsWrong = () => (open[0] ? `${role === "assistant" ? "" : `${T.needFields(open.length)} `}${open[0].label || T.sp.typeHere} ${checkOf(open[0])}.` : null);
  const policy = $derived(view?.policy ?? {});
  const accent = $derived(/^#[0-9a-fA-F]{6}$/.test(view?.brand?.accent ?? "") ? view.brand.accent : null);

  function settle(v) { view = v; name = v.party.name ?? ""; vals = v.progress ?? {}; for (const f of (v.documents ?? []).flatMap((d) => d.fields)) if (f.mine && f.locked && f.default != null && !vals[f.id]) vals = { ...vals, [f.id]: String(f.default) }; for (const f of (v.documents ?? []).flatMap((d) => d.fields)) if (f.mine && f.autofill && !vals[f.id]) { const x = f.autofill === "name" ? v.party.name : v.party.email; if (x) vals = { ...vals, [f.id]: x }; } phase = v.gate ? "gate" : v.party.signed ? "signed" : v.party.status === "closed" ? "closed" : v.party.status === "awaiting_payment" ? "pay" : v.waitingFor ? "waiting" : v.document.state === "declined" ? "declined" : "ready"; waitingFor = v.waitingFor ?? []; if (phase === "pay") heldUntil = v.party.holdExpiresAt ?? null; }
  onMount(async () => {
    const qp = new URLSearchParams(location.search), back = { paid: qp.get("paid"), cancelled: qp.get("cancelled") }, parent = qp.get("embed") === "1" ? qp.get("parent") : null; embedQ = qp.get("embed") === "1";
    let t = qp.get("t");
    // coming back from Stripe's payment page: the link's secret never went to Stripe, so it is read from this tab's own memory (set just before leaving)
    // D-059: the same memory carries a plain reload (a signer on a bad connection pulls to refresh): the secret leaves the address bar at once, and stays in this tab only
    if (!t) { try { t = sessionStorage.getItem("docustay:signtoken"); } catch { t = null; } }
    else { try { sessionStorage.setItem("docustay:signtoken", t); } catch { /* no memory: a reload needs the emailed link again */ } }
    history.replaceState(null, "", location.pathname);       // the link's secret leaves the address bar at once
    if (!t) { phase = "refused"; return; }
    token = t;
    if (parent) { try { const r = await call("embed-origins", {}); if ((r.origins ?? []).includes(parent)) embedTo = parent; } catch { /* no events without a listed parent */ } }
        try {
      let v; try { v = await call("view", { language: browserLang() }); } catch (e) { if (e.status === 403) { v = await call("test/view", {}); test = true; } else throw e; }
      settle(v);
      if (back.paid && !test) await afterStripe(back.paid);
      else if (phase === "pay") await nextPayment();
      else if (back.cancelled) problem = T.payCancelled ?? "The payment was cancelled. You have not been charged.";
    } catch (e) { phase = e.status === 403 ? "refused" : "trouble"; }
  });
  let zoomed = $state(false), narrow = $state(false);
  $effect(() => { if (!column) return; const z = zoomed; const fit = () => { const avail = column.clientWidth - 24; narrow = avail < 560; width = narrow ? (z ? 640 : Math.max(280, avail)) : Math.min(820, avail);   /* R13-D098: on a phone the whole page fits the screen first; "Zoom in" gives the readable size that pans sideways (P10-A-15), with a cue */ }; fit(); addEventListener("resize", fit); return () => removeEventListener("resize", fit); });
  $effect(() => { document.title = view?.document?.title ?? "Sign"; });
  $effect(() => {
    const p = phase, to = embedTo, map = { ready: "ready", gate: "ready", waiting: "waiting", signed: "completed", declined: "declined", refused: "error", trouble: "error" };
    if (!to || !map[p] || p === lastTold) return;
    lastTold = p; tell(map[p], map[p] === "error" ? { code: p } : {});
  });
  $effect(() => {
    if (!embedTo) return;
    const ro = new ResizeObserver(() => tell("resize", { height: Math.ceil(document.documentElement.scrollHeight) }));
    ro.observe(document.documentElement); return () => ro.disconnect();
  });
  $effect(() => {
    if (!doc || !["ready", "signing"].includes(phase) || pdf) return;
    (async () => {
      try { const r = await fetch(`/api/public/pdf/${test ? "test/" : ""}file`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ presented: token, documentId: doc.id }), cache: "no-store" }); if (!r.ok) throw new Error(); pdf = await loadPdf(await r.arrayBuffer()); }
      catch (e) { console.error("sign: the pages could not be loaded:", e?.name ?? "", e?.message ?? e); pdfError = true; }   // R13-D558: the reason was thrown away, so a signer on a browser the page drawing does not support saw only "could not be loaded" and support had nothing to go on
    })();
  });
  const zone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || null; } catch { return null; } };
  const payload = () => { const v = {}; for (const f of mine) { if (f.calc) continue; const x = valueOf(f); if (x != null && !["signature", "initials"].includes(f.type)) v[f.id] = x; } return v; };
  async function sign() {
    if (test) { problem = T.testNoSign; return; }
    if (!name.trim()) { problem = T.needName; return; }
    if (open.length) { problem = whatsWrong(); return; }
    if (!consent) { problem = T.needConsent; return; }
    if (policy.requireReason && !why.trim()) { problem = T.sp.signReasonHint; return; }
    // Run 9: a witness signs on this device straight after the signer; both go in the one request
    if (view.party?.witnessRequired && !(wName.trim() && wMark)) { problem = null; witnessing = true; return; }
    problem = null; phase = "signing";
    try { const res = await call("sign", { language: lang, typedName: name.trim(), consent: true, marks: { signature: marks.signature, initials: marks.initials }, values: payload(), signerTimezone: zone(), reason: why.trim() || null, signatureMethod: method, ...(view.party?.witnessRequired ? { witness: { name: wName.trim(), email: wEmail.trim() || null, mark: wMark } } : {}) });
      const out = res?.data ?? res; problem = null;
      if (out?.held) { heldUntil = out.holdExpiresAt ?? null; phase = "pay"; await nextPayment(); return; }
      lastOne = out?.completed === true; downloadUrl = out?.downloadUrl ?? null; phase = "signed"; }
    catch (e) {
      if (e.status === 403) phase = "refused";
      else if (e.status === 409 && e.detail?.code === "group_closed") { phase = "closed"; }
      else if (e.status === 409) { waitingFor = [e.detail?.waitingFor ?? "someone"].flat(); phase = e.detail?.code === "not_your_turn" ? "waiting" : "signed"; }
      else if (/^witness_/.test(e.detail?.code ?? "")) { problem = e.message; witnessing = true; phase = "ready"; }
      else { problem = e.message || T.signFailed; phase = "ready"; }
    }
  }
  async function delegateNow() {
    if (test) { problem = T.testNoRec; return; }
    try { const r = await call("delegate", { name: dName.trim(), email: dEmail.trim() }); delegated = r.to; phase = "delegated"; problem = null; } catch (e) { problem = e.message; }
  }
  async function sendChanges() {
    if (!changeText.trim()) { problem = T.askNeed ?? "Tell the sender what needs to change."; return; }
    if (test) { problem = T.testNoRec; return; }
    try { await call("request-changes", { message: changeText.trim() }); changeSent = true; changing = false; changeText = ""; problem = null; } catch (e) { problem = e.message; }
  }
  async function saveForLater() { try { await call("progress", { values: payload() }); saved = T.saved; } catch { saved = T.saveFailed; } }
  async function declineNow() {
    if (view.requireDeclineReason && !reason.trim()) { problem = T.needReason; return; }
    if (test) { problem = T.testNoRec; return; }
    try { await call("decline", { reason: reason.trim() || null }); phase = "declined"; } catch (e) { problem = e.message; }
  }
  async function askCode() { gateMsg = null; try { const r = await call("send-code", {}); gateMsg = fmt(T.sp.gateSent, r.to, r.validMinutes); settle(await call("view", {})); } catch (e) { gateMsg = e.message; } }
  async function submitCode() { gateMsg = null; try { const r = await call("verify", { code }); if (r.verified) { code = ""; settle(await call("view", {})); } else gateMsg = r.code === "locked" ? T.sp.gateLocked : r.code === "expired" ? T.sp.gateExpired : r.code === "wrong_code" ? `${T.sp.gateWrong}${r.triesLeft != null ? " " + fmt(T.sp.gateTries, r.triesLeft) : ""}` : serverMessage(lang, r.message); } catch (e) { gateMsg = e.message; } }
  function nextField() { const f = open[0]; if (!f) return; document.querySelector(`[data-field="${f.id}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" }); if (MARKS.includes(f.type) && f.type !== "image") padFor = f; else document.querySelector(`[data-field="${f.id}"] input, [data-field="${f.id}"] select`)?.focus(); }
  const cash = (minor, cur) => new Intl.NumberFormat("en-US", { style: "currency", currency: String(cur ?? "usd").toUpperCase() }).format(minor / 100);
  const everyWord = { week: "week", month: "month", year: "year" };
  const payLabel = (f) => (view?.payments ?? []).find((p) => p.fieldId === f.id)?.describe ?? (view?.payments ?? []).find((p) => p.fieldId === f.id)?.label
    ?? (f.amount_ask ? (T.payChoose ?? "Choose an amount") : f.amount_minor && f.deposit ? `${cash("percent" in f.deposit ? Math.round(f.amount_minor * f.deposit.percent / 100) : f.deposit.amount_minor, f.currency)} deposit`
      : f.amount_minor && f.plan ? `${cash(f.amount_minor, f.currency)} a ${everyWord[f.plan.every]}${f.plan.count ? `, ${f.plan.count} payments` : ""}` : f.amount_minor ? new Intl.NumberFormat("en-US", { style: "currency", currency: (f.currency ?? "usd").toUpperCase() }).format(f.amount_minor / 100) : "");
  async function uploadField(f, file) {
    if (!file) return; upBusy = { ...upBusy, [f.id]: true }; problem = null;
    try { const buf = new Uint8Array(await file.arrayBuffer()); let bin = ""; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      const r = await call("upload-file", { fieldId: f.id, name: file.name, data: btoa(bin) }); setVal(f.id, r.fileId); }
    catch (e) { problem = e.message || T.uploadFailed; } finally { upBusy = { ...upBusy, [f.id]: false }; }
  }
  const markPaid = (f, label) => { setVal(f.id ?? f, "paid"); view = { ...view, payments: [...(view.payments ?? []).filter((p) => p.fieldId !== (f.id ?? f)), { fieldId: f.id ?? f, paid: true, label }] }; };
  // The signer is back from Stripe: the server re-reads Stripe (never the address bar) and says whether it is really paid.
  async function afterStripe(fieldId) {
    payBusy = true;
    try { const c = await call("payment/confirm", { fieldId }); if (c.paid) { markPaid(fieldId, c.label); payMsg = null; if (await afterPaid(c, fieldId)) return; if (phase === "pay") await nextPayment(); } else { payMsg = T.payFailed; if (!payFor) problem = payMsg; if (phase === "pay") await nextPayment(); } }
    catch (e) { payMsg = e.message || T.payFailed; if (!payFor) problem = payMsg; } finally { payBusy = false; }
  }
  let polling = 0;
  async function pollPay(f, tries = 0) {   // embedded: Stripe's page cannot open inside a frame, so it opens in a new tab and this page waits
    const id = ++polling;
    if (id !== polling || !payFor || tries > 300) return;
    try { const c = await call("payment/confirm", { fieldId: f.id }); if (c.paid) { markPaid(f, c.label); payFor = null; if (!(await afterPaid(c, f.id)) && phase === "pay") await nextPayment(); return; } if (c.status === "expired") { payMsg = T.payFailed; payFor = null; return; } } catch { /* try again */ }
    setTimeout(() => pollPay(f, tries + 1), 3000);
  }
  let askFor = $state(null), askText = $state(""), askMsg = $state(null);
  const askBounds = (f) => ({ lo: f.amount_ask?.min_minor ?? 50, hi: f.amount_ask?.max_minor ?? 99999999 });
  function openAsk(f) { askFor = f; askMsg = null; askText = f.amount_ask?.suggested_minor ? (f.amount_ask.suggested_minor / 100).toFixed(2) : ""; }
  async function startPay(f, amount = null) {
    if (test) { problem = T.testNoRec; return; }
    if (f.amount_ask && amount === null) { openAsk(f); return; }
    payMsg = null; payBusy = true; problem = null;
    try {
      // the browser sends the values it has typed and where to come back to — never an amount: the server works the amount out
      const r = await call("payment/start", { fieldId: f.id, values: payload(), ...(amount !== null ? { amount } : {}), returnOrigin: location.origin, returnPath: location.pathname });
      if (r.paid) { markPaid(f, r.label); return; }
      if (!r.checkoutUrl) throw new Error(T.payUnavailable);
      try { sessionStorage.setItem("docustay:signtoken", token); } catch { /* no memory: the person signs in again from their email */ }
      try { await call("progress", { values: payload() }); } catch { /* the page still comes back; typed values may need re-entering */ }
      if (embedTo) { window.open(r.checkoutUrl, "_blank", "noopener"); payFor = { f, label: r.label }; pollPay(f); }
      else location.href = r.checkoutUrl;
    } catch (e) { problem = /not set up|Connect Stripe|not configured/i.test(e.message ?? "") || e.status === 503 ? T.payUnavailable : (e.message || T.payUnavailable); } finally { payBusy = false; }
  }
  // ── Run 9 Part 3.7 (Pay 2) · THE PAY STEP. The signature is held on the server (7 days); each payment still to make is paid in Stripe's own embedded box, on this page. Stripe says when it
  //    is done; the server re-reads Stripe and only then completes the signature. Inside a customer's own page (embedded), Stripe opens in a new tab instead, as before.
  let heldUntil = $state(null), payStep = $state(null), payEl = $state(null), receipt = $state(null);
  let checkout = null;
  const payFields = $derived(mine.filter((f) => f.type === "payment"));
  const unpaidFields = () => payFields.filter((f) => !paidIds.has(f.id) && vals[f.id] !== "paid");
  const longDate = (iso) => { try { return new Intl.DateTimeFormat(lang ?? "en", { dateStyle: "long" }).format(new Date(iso)); } catch { return ""; } };
  function closeCheckout() { try { checkout?.destroy(); } catch { /* already gone */ } checkout = null; }
  async function nextPayment(amount = null) {
    closeCheckout();
    const f = unpaidFields()[0];
    if (!f) { payStep = { status: "processing" }; await finishAfterPayments(); return; }
    if (f.amount_ask && amount === null) { payStep = { f, status: "choose", index: payFields.indexOf(f) }; openAsk(f); return; }
    payStep = { f, status: "loading", index: payFields.indexOf(f) };
    try {
      const r = await call("payment/start", { fieldId: f.id, values: payload(), ...(amount !== null ? { amount } : {}), returnOrigin: location.origin, returnPath: location.pathname, embedded: !embedTo });
      if (r.paid) { markPaid(f, r.label); if (!(await afterPaid(r, f.id))) await nextPayment(); return; }
      payStep = { ...payStep, label: r.describe ?? r.label };
      if (embedTo || !r.clientSecret || !r.stripe?.publishableKey) {
        if (!r.checkoutUrl) throw new Error(T.payUnavailable);
        try { sessionStorage.setItem("docustay:signtoken", token); } catch { /* no memory: the person opens their email link again */ }
        if (embedTo) { window.open(r.checkoutUrl, "_blank", "noopener"); payFor = { f, label: r.label }; pollPay(f); } else location.href = r.checkoutUrl;
        return;
      }
      try { sessionStorage.setItem("docustay:signtoken", token); } catch { /* a bank check that leaves the page needs the emailed link again */ }
      const { loadStripe } = await import("@stripe/stripe-js");
      const stripe = await loadStripe(r.stripe.publishableKey, r.stripe.stripeAccount ? { stripeAccount: r.stripe.stripeAccount } : undefined);
      if (!stripe) throw new Error(T.sp.payLoadFailed);
      payStep = { ...payStep, status: "ready" };
      await new Promise((ok) => requestAnimationFrame(() => ok()));   // the box's place is on the page before Stripe draws into it
      checkout = await stripe.createEmbeddedCheckoutPage({ fetchClientSecret: async () => r.clientSecret, onComplete: () => paidInStripe(f) });
      checkout.mount(payEl);
    } catch (e) { payStep = { ...(payStep ?? {}), f, status: "error", message: /not set up|not configured/i.test(e?.message ?? "") ? T.payUnavailable : (e?.message || T.sp.payLoadFailed) }; }
  }
  // Stripe's box says the payment went through: the coin turns while the server asks Stripe itself (a payment can take a moment to settle), then the signature completes
  async function paidInStripe(f) {
    closeCheckout(); payStep = { ...payStep, status: "processing" };
    for (let i = 0; i < 20; i += 1) {
      try { const c = await call("payment/confirm", { fieldId: f.id }); if (c.paid) { markPaid(f, c.label); if (!(await afterPaid(c, f.id))) await nextPayment(); return; } if (c.status === "expired") break; } catch { /* ask again */ }
      await new Promise((ok) => setTimeout(ok, 1500));
    }
    payStep = { ...payStep, status: "error", message: T.payFailed };
  }
  // ★ D537/D549 — every payment is made but the page has no "signed" answer (the webhook finished the signature first, or the answer was lost): ask the server again for a while, then show the paid screen; never sit on "Processing" for good
  async function finishAfterPayments() {
    for (let i = 0; i < 20; i += 1) {
      try { const c = await call("payment/confirm", { fieldId: payFields[payFields.length - 1]?.id }); if (c?.hold?.signed) { await afterPaid(c, payFields[payFields.length - 1]?.id); return; } } catch { /* ask again */ }
      await new Promise((ok) => setTimeout(ok, 1500));
    }
    payStep = { ...payStep, status: "error", message: "Your payment was received. We are still finishing your signature: refresh this page in a minute." };
  }
  // → true when this payment completed the held signature (the paid screen is showing)
  async function afterPaid(c, fieldId) {
    if (!c?.hold?.signed) return false;
    const f = payFields.find((x) => x.id === fieldId);
    receipt = { lines: [f?.label || "", view?.org?.name ?? "", c.label ?? "", longDate(new Date().toISOString())].filter(Boolean) };
    lastOne = c.hold.completed === true; downloadUrl = c.hold.downloadUrl ?? null; heldUntil = null; payStep = null; phase = "paid"; return true;
  }
  async function decideNow(decision) { busyRole = true; problem = null; try { await call("decide", { decision, comment: roleComment.trim() || null }); roleDone = T.approvedDone; } catch (e) { problem = e.message; } finally { busyRole = false; } }
  async function acknowledgeNow() { busyRole = true; problem = null; try { await call("acknowledge", {}); roleDone = T.viewDone; } catch (e) { problem = e.message; } finally { busyRole = false; } }
  async function assistNow(finish) { if (open.length) { problem = whatsWrong(); return; } busyRole = true; problem = null; try { await call("assist", { values: payload(), finish }); if (finish) roleDone = T.assistDone; else saved = T.saved; } catch (e) { problem = e.message; } finally { busyRole = false; } }
  let touched = $state({});   // a box the person has left: a value that will not count is flagged at once, not only after a refused Finish
  const setVal = (id, v) => (vals = { ...vals, [id]: v });
  const initials = (n) => n.split(/\s+/).map((w) => w[0] ?? "").join("").toUpperCase();
</script>

<svelte:head><meta name="robots" content="noindex" /></svelte:head>
<div class="paper-ground flex min-h-screen flex-col" dir={dirOf(lang)} lang={lang ?? "en"}>
{#if phase === "loading"}<p class="m-auto text-mute" data-testid="signpdf-loading">{T.loading}</p>
{:else if phase === "refused" || phase === "trouble"}
  <div class="m-auto max-w-[44ch] px-6 text-center" data-testid="signpdf-refused"><h1 class="text-2xl font-bold">{T.refusedTitle}</h1><p class="mt-3" role="alert">{phase === "refused" ? T.refused : T.trouble}</p></div>
{:else if phase === "gate"}
  <div class="m-auto max-w-[44ch] space-y-3 px-6 text-center" data-testid="signpdf-gate"><h1 class="text-2xl font-bold">{view.document.title}</h1>
    <p>{view.gate.kind === "email_code" ? `${fmt(T.sp.gateNeeds, view.org?.name ?? T.sp.theSender)} ${view.gate.codeSent ? fmt(T.sp.gateEnter, view.gate.email) : fmt(T.sp.gateWill, view.gate.email)}` : fmt(T.sp.gateAccess, view.org?.name ?? T.sp.theSender)}</p>
    {#if view.gate.locked}<p class="text-sm text-bad" role="alert">{T.sp.gateLocked}</p>
    {:else}<form class="mx-auto flex max-w-xs flex-col gap-2" onsubmit={(e) => { e.preventDefault(); submitCode(); }}>
      {#if view.gate.kind === "email_code"}<button type="button" class="btn" onclick={askCode}>{view.gate.codeSent ? T.sp.gateSendNew : T.sp.gateEmailMe}</button>{/if}
      <input class="field" bind:value={code} inputmode={view.gate.kind === "email_code" ? "numeric" : "text"} autocomplete="one-time-code" aria-label={T.sp.gateCode} /><button class="btn primary" disabled={!code.trim()}>{T.sp.gateOpen}</button></form>{/if}
    {#if gateMsg}<p class="text-sm text-mute" role="status">{gateMsg}</p>{/if}</div>
{:else if phase === "signed"}
  <div class="m-auto max-w-[44ch] px-6 text-center" data-testid="signpdf-signed"><div class="mx-auto mb-4 grid place-items-center">{#if lastOne}<Seal size={132} stamp />{:else}<Seal size={96} stamp />{/if}</div><h1 class="paper-serif text-[30px] font-medium leading-tight">{lastOne ? (T.sp.signedSealed ?? "Signed and sealed") : T.signedTitle}</h1><div class="mx-auto mt-6 max-w-[520px]"><Ribbon full slim facts={{ state: lastOne ? "executed" : "partially_signed", sentAt: true, openedCount: 1, signedCount: 1, totalCount: lastOne ? 1 : 2 }} names={{ Signed: (T.sp.ribbonSigning ?? "Signing") }} testid="signpdf-ribbon" /></div><p class="mt-6">{lastOne ? T.signedLastBody : T.signedBody}</p>{#if lastOne && downloadUrl}<p class="mt-4"><a class="btn" href={downloadUrl} target="_blank" rel="noopener" data-testid="signpdf-download">{T.sp.openSigned}</a></p>{/if}{#if view?.form?.thankYou}<p class="mt-3" data-testid="signpdf-thankyou">{view.form.thankYou}</p>{/if}{#if view?.form?.againUrl || view?.resubmitUrl}<p class="mt-4"><a class="btn" href={view?.form?.againUrl ? `${view.form.againUrl}${embedQ ? "?embed=1" : ""}` : view.resubmitUrl} data-testid="signpdf-resubmit">{T.sp.fillAgain}</a></p>{/if}</div>
{:else if phase === "pay"}
  <div class="mx-auto grid w-full max-w-[1100px] gap-6 px-4 py-8 md:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] md:py-12" data-testid="signpdf-pay">
    <section class="hidden rounded-2xl bg-card p-6 shadow-[0_30px_70px_rgb(30_20_70/.12)] md:block" aria-hidden="true">
      <div class="mx-auto flex max-w-[360px] flex-col gap-2.5 rounded bg-white p-7 text-[#16161d] shadow-[0_10px_30px_rgb(0_0_0/.08)]">
        <div class="font-semibold">{view.document.title}</div><span class="h-[3px] bg-[#e4e4ec]"></span><span class="h-[3px] w-4/5 bg-[#e4e4ec]"></span><span class="h-[3px] bg-[#e4e4ec]"></span>
        <div class="mt-4 flex gap-3"><div class="h-9 flex-1 border-b-[1.5px] border-[#16161d] text-xl italic text-[#3f2899]">{name || view.party.name}</div><div class="h-9 flex-1 border-b-[1.5px] border-[#16161d] pt-3 text-[13px]">{longDate(new Date().toISOString())}</div></div>
      </div>
    </section>
    <section class="flex flex-col gap-4 rounded-2xl bg-card p-6 shadow-[0_14px_34px_rgb(40_25_100/.08)]" aria-labelledby="pay-title">
      <p class="font-mono text-[11px] text-mute">{fmt(T.sp.payStep, 2 + Math.max(0, payStep?.index ?? 0), 1 + Math.max(1, payFields.length))}</p>
      <h1 id="pay-title" class="text-xl font-semibold">{T.sp.payTitle}</h1>
      {#if payStep?.f}<div class="flex justify-between gap-3 text-sm"><span class="text-mute">{fmt(T.sp.payFor, payStep.f.label || T.paid, view.org?.name ?? "")}</span>{#if payStep.label}<span class="font-semibold" data-testid="pay-amount">{payStep.label}</span>{/if}</div>{/if}
      {#if payStep?.status === "processing"}<div class="py-6" data-testid="pay-processing"><Coin label={`${T.sp.payProcessing} — ${T.sp.payProcessingBody}`} size={52} /></div>
      {:else if payStep?.status === "error"}<p class="text-sm text-bad" role="alert" data-testid="pay-error">{payStep.message}</p><button class="btn primary" onclick={() => nextPayment()} data-testid="pay-retry">{T.sp.payTryAgain}</button>
      {:else}
        <PayCard3D note={T.sp.payCardNote} amount={payStep?.label ?? ""} />
        {#if payStep?.status === "loading"}<p class="text-sm text-mute" role="status">{T.loading}</p>{/if}
        <div bind:this={payEl} class="min-h-[120px]" data-testid="pay-stripe-box"></div>
      {/if}
      <p class="text-center text-xs text-mute" data-testid="pay-kept">{heldUntil ? fmt(T.sp.payKeptUntil, longDate(heldUntil)) : T.sp.payKept}</p>
      {#if problem}<p class="text-sm text-bad" role="alert">{problem}</p>{/if}
    </section>
  </div>
  {#if askFor}
    <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" {@attach modal(() => (askFor = null))} aria-label={T.payChoose ?? "Choose an amount"} data-testid="pay-ask-dialog"><div class="w-full max-w-[420px] rounded-2xl bg-card p-5">
      <h2 class="mb-1 text-lg font-semibold">{T.payChoose ?? "Choose an amount"}</h2>
      <p class="mb-3 text-sm text-mute">{cash(askBounds(askFor).lo, askFor.currency)}{askFor.amount_ask?.max_minor ? ` – ${cash(askBounds(askFor).hi, askFor.currency)}` : ""}</p>
      <input class="field w-full" inputmode="decimal" bind:value={askText} aria-label={T.payChoose ?? "Choose an amount"} data-testid="pay-ask-input" />
      {#if askMsg}<p class="mt-2 text-sm text-bad" role="alert">{askMsg}</p>{/if}
      <div class="mt-3 flex gap-2"><button class="btn primary" data-testid="pay-ask-go" onclick={() => { const n = Math.round(Number(String(askText).replace(/[^0-9.]/g, "")) * 100); const { lo, hi } = askBounds(askFor); if (!(n >= lo && n <= hi)) { askMsg = `${cash(lo, askFor.currency)} – ${cash(hi, askFor.currency)}`; return; } askFor = null; nextPayment(String(askText).replace(/[^0-9.]/g, "")); }}>{T.continue ?? "Continue"}</button></div></div></div>
  {/if}
{:else if phase === "paid"}
  <div class="m-auto flex max-w-[52ch] flex-col items-center gap-5 px-6 py-10 text-center" data-testid="signpdf-paid">
    <ReceiptPrint title={T.sp.receipt} lines={receipt?.lines ?? []} stamp={T.sp.paidStamp} />
    <div class="w-28 sealpress"><Doodle name="seal" size="7rem" /></div>
    <h1 class="text-2xl font-bold">{T.sp.paidTitle}</h1>
    <p>{lastOne ? T.sp.paidBodyLast : T.sp.paidBodyMore}</p>{#if lastOne && downloadUrl}<p class="mt-4"><a class="btn" href={downloadUrl} target="_blank" rel="noopener" data-testid="signpdf-download">{T.sp.openSigned}</a></p>{/if}
  </div>
{:else if phase === "closed"}
  <div class="m-auto max-w-[44ch] px-6 text-center" data-testid="signpdf-closed"><h1 class="text-2xl font-bold">{T.sp.closedTitle}</h1><p class="mt-3">{view?.party?.closedBy ? fmt(T.sp.closedBody, view.party.closedBy, view.party.group ?? "") : fmt(T.sp.closedBodyAnon, view?.party?.group ?? "")}</p></div>
{:else if phase === "declined"}
  <div class="m-auto max-w-[44ch] px-6 text-center" data-testid="signpdf-declined"><h1 class="text-2xl font-bold">{T.declinedTitle}</h1><p class="mt-3">{T.declinedBody}</p></div>
{:else if phase === "delegated"}
  <div class="m-auto max-w-[44ch] px-6 text-center" data-testid="signpdf-delegated"><h1 class="text-2xl font-bold">{T.sp.passedOn}</h1><p class="mt-3">{fmt(T.sp.passedBody, delegated?.name, delegated?.email)}</p></div>
{:else if phase === "waiting"}
  <div class="m-auto max-w-[44ch] px-6 text-center" data-testid="signpdf-waiting"><h1 class="text-2xl font-bold">{T.waitingTitle}</h1><p class="mt-3">{T.waitingBody(waitingFor.join(", ") || T.someoneElse)}</p></div>
{:else}
  <div class="mx-auto w-full max-w-[860px] px-3 pb-64 pt-4 sm:pb-40" bind:this={column} data-testid="signpdf-ready">
    <header class="mb-4 space-y-1" style={accent ? `border-top:4px solid ${accent};padding-top:10px` : ""}>
      {#if view.brand?.showLogo !== false && view.org?.logoUrl}<img src={view.org.logoUrl} alt={view.org?.name ?? ""} class="mb-1 h-9 w-auto" />{/if}
      {#if view.org?.name}<p class="text-xs text-mute">{view.org.name}</p>{/if}
      <h1 class="paper-serif text-[26px] font-medium leading-tight sm:text-[32px]">{view.document.title}</h1>
      {#if test}<p class="rounded bg-card px-3 py-2 text-sm" role="status">{T.testNote}</p>{/if}
      {#if view.document.test}<p class="rounded border border-warn-line bg-warn-bg px-3 py-2 text-sm" role="status" data-testid="signpdf-testdoc">{T.sp.testDoc}</p>{/if}
      {#if view.brand?.note}<p class="text-sm text-mute">{view.brand.note}</p>{/if}
      {#if view.document.expiresAt && longDate(view.document.expiresAt)}<p class="text-sm text-mute" data-testid="signpdf-deadline">{fmt(T.sp.openUntil ?? "Open for signing until {0}.", longDate(view.document.expiresAt))}</p>{/if}   <!-- R13-D059: the signer is told the deadline the sender set -->
      {#if view.document.message}<p class="text-[15px]">{view.document.message}</p>{/if}
      {#if view.party?.group}<p class="rounded bg-card px-3 py-2 text-sm" role="note" data-testid="signpdf-group">{fmt(T.sp.groupNote, view.party.group)}</p>{/if}
      {#if view.attachments?.length}<div class="text-sm" data-testid="signpdf-extra-files"><p class="text-mute">{T.sp.extraFiles ?? "Files to read with this document"}</p><ul class="mt-1 space-y-1">{#each view.attachments as a}<li><button type="button" class="underline" onclick={() => openExtra(a)} data-testid={`extra-file-${a.id}`}>{a.name}</button></li>{/each}</ul></div>{/if}
    </header>
    <Ribbon full slim class="mb-5" facts={{ state: "sent", sentAt: true, openedCount: 1, totalCount: 1 }} names={{ Signed: (T.sp.ribbonSigning ?? "Signing") }} testid="signpdf-ribbon" />
    {#if pdfError}<p class="text-bad" role="alert">{T.pagesFailed}</p>{:else if !pdf}<p class="notice text-sm" role="status" aria-live="polite" data-testid="signpdf-pages-loading">{T.loading} {T.sp.pagesLoading ?? "The document is still arriving. Finish and sign turns on once every page has drawn."}</p>{/if}   <!-- R13-D100: on a slow network the sheet was blank for ~80 s while Finish was live -->
    {#if narrow}<div class="flex items-center justify-between gap-3 text-sm text-mute" data-testid="signpdf-zoom"><span>{zoomed ? (T.sp.panHint ?? "Swipe sideways to read each line.") : (T.sp.fitHint ?? "The whole page fits the screen.")}</span><button type="button" class="btn !min-h-0 !py-1.5" onclick={() => (zoomed = !zoomed)} aria-pressed={zoomed}>{zoomed ? (T.sp.fitPage ?? "Fit to screen") : (T.sp.zoomIn ?? "Zoom in")}</button></div>{/if}
    <div class="space-y-4 {width > column?.clientWidth - 24 ? 'overflow-x-auto' : ''}" aria-label={T.sp.docPages} data-testid="signpdf-pages">
      {#each doc?.file.pages ?? [] as _, i}
        {#if hidden.pages.has(i + 1)}<p class="rounded border border-dashed border-line px-3 py-2 text-center text-sm text-mute" data-testid={`signpdf-page-left-out-${i + 1}`}>{fmt(T.sp.leftOutPage, i + 1)}</p>{:else}
        <PdfPage {pdf} pageNumber={i + 1} {width}>
          {#each doc.fields.filter((f) => f.page === i + 1 && !hidden.fields.has(f.id)) as f (f.id)}
            {@const live = f.mine}
            {@const val = live ? valueOf(f) : (f.filled?.mark ?? f.filled?.value)}
            {@const box = `position:absolute;left:${f.x * 100}%;top:${f.y * 100}%;width:${f.w * 100}%;height:${f.h * 100}%`}
            {@const cls = live ? "fieldlive border-2 border-brand bg-accent/20" : "border border-dashed border-line"}
            {@const fs = Math.max(8, Math.min(14, f.h * width * 1.2))}
            {#if f.type === "date_signed"}<div style="{box};font-size:{Math.max(7, fs * 0.85)}px" class="flex items-center overflow-hidden whitespace-nowrap px-1 text-mute {cls}" data-field={f.id}><span class="truncate">{live ? T.dateOnSigning : ""}</span></div>
            {:else if MARKS.includes(f.type)}<button type="button" style={box} disabled={!live} onclick={() => (padFor = f)} class="flex items-center justify-center overflow-hidden {cls}" data-field={f.id} data-filled={val ? "1" : "0"} aria-label={f.label || f.type}>{#if val}<img src={val} alt="" class="max-h-full max-w-full object-contain" />{:else if live}<span class="text-xs">{f.type === "signature" ? T.pad.signHere : f.type === "initials" ? T.sp.initialMark : f.type === "stamp" ? T.sp.addStamp : T.sp.addPicture}{f.required ? "" : " " + T.sp.optionalSfx}</span>{/if}</button>
            {:else if live && f.calc}<div style={box} class="flex items-center overflow-hidden px-1 {cls} calcbox" data-field={f.id} data-calc="1" title={T.sp.worksOut}><span class="truncate" style="font-size:{fs}px" aria-label={`${f.label || ""}: ${val ?? ""}`}>{val ?? ""}</span></div>
            {:else if !live}<div style={box} class="overflow-hidden px-1 {cls}" data-field={f.id}>{#if f.type === "file" && val}<span class="text-xs">✓ {T.uploaded}</span>{:else if typeof val === "string" && !val.startsWith("data:")}<span class="text-xs">{val}</span>{/if}</div>
            {:else if f.type === "checkbox"}<!-- Run 8 J6: the whole box takes the tap (it was the 8px input inside a 15px box on a phone) --><label style={box} class="flex cursor-pointer items-center justify-center {cls}" data-field={f.id}><input type="checkbox" checked={val === "true"} onchange={(e) => setVal(f.id, e.currentTarget.checked ? "true" : "false")} aria-label={f.label || "Tick"} class="m-0 h-[85%] w-[85%] cursor-pointer" /></label>
            {:else if f.type === "dropdown"}<div style={box} class={cls} data-field={f.id}><select value={val ?? ""} disabled={Boolean(f.locked)} title={f.tooltip || undefined} onchange={(e) => setVal(f.id, e.currentTarget.value)} aria-label={f.label || "Choose"} class="fieldinput h-full w-full truncate bg-transparent px-1" style="font-size:{fs}px"><option value="">{f.label || "Choose…"}</option>{#each f.options ?? [] as o}<option value={o}>{o}</option>{/each}</select></div>
            {:else if f.type === "multiselect"}
              {@const chosen = (() => { try { return val ? JSON.parse(val) : []; } catch { return []; } })()}
              <details style={box} class="overflow-visible {cls}" data-field={f.id} {@attach closeDetails}><!-- Run 8 J7: once something is picked the summary shows only the picks; its name keeps the question --><summary class="cursor-pointer truncate px-1" style="font-size:{fs}px" aria-label={f.label && chosen.length ? `${f.label}: ${chosen.join(", ")}` : undefined}>{chosen.length ? chosen.join(", ") : (f.label || T.sp.pickAny)}</summary>
                <div role="group" aria-label={f.label || undefined} class="absolute left-0 top-full z-20 mt-1 min-w-[160px] space-y-1 rounded border border-line bg-card p-2 text-sm shadow">{#each f.options ?? [] as o}<label class="flex items-center gap-2"><input type="checkbox" checked={chosen.includes(o)} onchange={() => setVal(f.id, JSON.stringify(chosen.includes(o) ? chosen.filter((x) => x !== o) : [...chosen, o]))} />{o}</label>{/each}</div></details>
            {:else if f.type === "file"}<div style={box} class="flex items-center justify-center overflow-hidden px-1 text-xs {cls}" data-field={f.id}>
              {#if val}<span class="truncate" data-testid="file-done">✓ {T.uploaded}</span>{:else}<label class="cursor-pointer truncate underline">{upBusy[f.id] ? T.uploading : (f.label || T.upload)}<input type="file" class="sr-only" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" onchange={(e) => uploadField(f, e.currentTarget.files?.[0])} data-testid={`file-${f.id}`} /></label>{/if}</div>
            {:else if f.type === "payment"}<div style={box} class="flex items-center justify-center overflow-hidden px-1 text-xs {cls}" data-field={f.id}>
              {#if val === "paid"}<span data-testid="pay-done">✓ {T.paid}</span>{:else}<span class="truncate" data-testid={`pay-${f.id}`} title={T.sp.payKept}>{payLabel(f) ? `${payLabel(f)} · ` : ""}{T.sp.payAtEnd}</span>{/if}</div>
            {:else}<div style={box} class={cls} data-field={f.id}><input type={f.validation === "date" && coarse ? "date" : "text"} value={val ?? ""} readonly={Boolean((f.autofill && !f.editable && val) || f.locked)} title={f.tooltip || undefined} maxlength={f.max_length ?? 500} oninput={(e) => setVal(f.id, e.currentTarget.value)} onblur={() => (touched = { ...touched, [f.id]: true })} placeholder={(f.validation === "date" ? (f.placeholder && f.placeholder !== "YYYY-MM-DD" ? `${f.placeholder} (YYYY-MM-DD)` : "YYYY-MM-DD") : f.placeholder || f.label) || T.sp.typeHere}   aria-invalid={(Boolean(problem) && checkOf(f) !== null) || (touched[f.id] && val && checkOf(f) !== null) || undefined} aria-label={f.label || "Text"} inputmode={f.validation === "number" ? "decimal" : f.validation === "phone" ? "tel" : f.validation === "email" ? "email" : "text"} class="fieldinput h-full w-full truncate bg-transparent px-1 {f.sensitive ? 'masked' : ''}" autocomplete={f.sensitive ? "off" : undefined} data-sensitive={f.sensitive ? "1" : undefined} style="font-size:{fs}px" /></div>{/if}
          {/each}
        </PdfPage>{/if}
      {/each}
    </div>

    {#if view.brand?.poweredBy}<p class="mt-6 text-center text-xs text-mute" data-testid="signpdf-powered">{view.brand.poweredBy}</p>{/if}

    {#if padFor}
      <div class="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4" role="dialog" aria-modal="true" {@attach modal(() => (padFor = null))} aria-label={fmt(T.sp.addYour, padFor.type === "initials" ? T.pad.initials : padFor.type === "image" ? T.pad.picture : T.pad.signature)}>
        <div class="w-full max-w-[520px] rounded-t-2xl bg-card p-4 sm:rounded-2xl">
          <SignaturePad words={T} allowTyped={policy.allowTyped !== false} remember={policy.rememberSignature === true} label={padFor.type === "initials" ? "initials" : padFor.type === "image" ? "picture" : "signature"} defaultName={padFor.type === "initials" ? initials(name) : name}
            onDone={(url, m) => { if (padFor.type === "signature" || padFor.type === "initials") { marks = { ...marks, [padFor.type]: url }; if (padFor.type === "signature") method = m ?? null; } else setVal(padFor.id, url); padFor = null; }} onCancel={() => (padFor = null)} />
        </div></div>
    {/if}

    {#if witnessing}
      <div class="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4" role="dialog" aria-modal="true" {@attach modal(() => (witnessing = false))} aria-labelledby="witness-title" data-testid="witness-dialog">
        <div class="w-full max-w-[520px] space-y-3 rounded-t-2xl bg-card p-4 sm:rounded-2xl">
          <h2 id="witness-title" class="text-lg font-semibold">{T.sp.witnessTitle}</h2>
          <p class="text-sm text-mute">{T.sp.witnessBody}</p>
          {#if problem}<p class="text-sm text-bad" role="alert">{problem}</p>{/if}
          <input class="field" bind:value={wName} placeholder={T.sp.witnessName} aria-label={T.sp.witnessName} autocomplete="off" data-testid="witness-name" />
          <input class="field" type="email" bind:value={wEmail} placeholder={T.sp.witnessEmail} aria-label={T.sp.witnessEmail} autocomplete="off" data-testid="witness-email" />
          {#if wMark}<div class="flex items-center gap-3"><img src={wMark} alt={T.sp.witnessSign} class="h-12 max-w-[60%] rounded border border-line bg-white object-contain" /><button class="btn quiet" onclick={() => (wMark = null)}>{T.cancel}</button></div><p class="text-sm" role="status">{T.sp.witnessDone}</p>
          {:else if wName.trim()}<SignaturePad words={T} allowTyped={policy.allowTyped !== false} remember={false} label={WITNESS_PAD} defaultName={wName.trim()} onDone={(url) => { wMark = url; problem = null; }} onCancel={() => (witnessing = false)} />{/if}
          <div class="flex gap-2"><button class="btn primary flex-1" disabled={!wName.trim() || !wMark || phase === "signing"} onclick={() => { witnessing = false; sign(); }} data-testid="witness-finish">{T.finish}</button><button class="btn" onclick={() => (witnessing = false)}>{T.cancel}</button></div>
        </div></div>
    {/if}

    {#if askFor}
      <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" {@attach modal(() => (askFor = null))} aria-label={T.payChoose ?? "Choose an amount"} data-testid="pay-ask-dialog"><div class="w-full max-w-[420px] rounded-2xl bg-card p-5">
        <h2 class="mb-1 text-lg font-semibold">{T.payChoose ?? "Choose an amount"}</h2>
        <p class="mb-3 text-sm text-mute">{cash(askBounds(askFor).lo, askFor.currency)}{askFor.amount_ask?.max_minor ? ` – ${cash(askBounds(askFor).hi, askFor.currency)}` : " or more"}</p>
        <input class="field w-full" inputmode="decimal" bind:value={askText} aria-label={T.payChoose ?? "Choose an amount"} data-testid="pay-ask-input" />
        {#if askMsg}<p class="mt-2 text-sm text-bad" role="alert">{askMsg}</p>{/if}
        <div class="mt-3 flex gap-2"><button class="btn primary" data-testid="pay-ask-go" onclick={() => { const n = Math.round(Number(String(askText).replace(/[^0-9.]/g, "")) * 100); const { lo, hi } = askBounds(askFor); if (!(n >= lo && n <= hi)) { askMsg = `${cash(lo, askFor.currency)} – ${cash(hi, askFor.currency)}`; return; } const f = askFor; askFor = null; const amt = String(askText).replace(/[^0-9.]/g, ""); if (phase === "pay") nextPayment(amt); else startPay(f, amt); }}>{T.continue ?? "Continue"}</button><button class="btn" onclick={() => (askFor = null)}>{T.cancel}</button></div></div></div>
    {/if}

    {#if payFor}
      <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" {@attach modal()} aria-label={T.payStripe ?? "Pay with Stripe"} data-testid="pay-dialog"><div class="w-full max-w-[460px] rounded-2xl bg-card p-5">
        <h2 class="mb-3 text-lg font-semibold">{T.pay(payFor.label)}</h2>
        <p class="text-sm">{T.payWaiting ?? "Stripe's secure payment page opened in a new tab. Finish there; this page will notice."}</p>
        {#if payMsg}<p class="mt-2 text-sm text-bad" role="alert">{payMsg}</p>{/if}
        <p class="mt-2 text-xs text-mute">{T.payNote}</p>
        <div class="mt-3 flex gap-2"><button class="btn primary" onclick={() => afterStripe(payFor.f.id)} disabled={payBusy} data-testid="pay-confirm">{T.payCheck ?? "I have paid — check"}</button><button class="btn" onclick={() => { polling += 1; payFor = null; }}>{T.cancel}</button></div></div></div>
    {/if}

    <!-- The action bar is mobile first: one column on a phone (progress, name, agreement, a big Finish), a single row from 640px. Less-used actions sit under "More". -->
    <div class="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-card pb-[max(.75rem,env(safe-area-inset-bottom))] pt-3 shadow-[0_-6px_18px_rgb(0_0_0/.08)]" style="padding-inline: clamp(12px, 2.2vw, 32px)" data-testid="signpdf-bar">
      <div class="mx-auto flex max-w-[1760px] flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
        {#if roleDone}<span class="text-sm" role="status" data-testid="role-done">{roleDone}</span>
        {:else if role === "approver"}
          <span class="text-sm font-medium">{T.approveTitle}</span><input class="field sm:!w-[220px]" bind:value={roleComment} placeholder={T.comment} aria-label={T.comment} data-testid="approve-comment" />
          <div class="flex gap-2"><button class="btn primary flex-1" disabled={busyRole} onclick={() => decideNow("approve")} data-testid="approve-yes">{T.approve}</button><button class="btn flex-1" disabled={busyRole} onclick={() => decideNow("reject")} data-testid="approve-no">{T.reject}</button></div><span class="text-xs text-mute">{T.approverNote}</span>
        {:else if role === "viewer"}
          <span class="text-sm font-medium">{T.viewTitle}</span><button class="btn primary" disabled={busyRole} onclick={acknowledgeNow} data-testid="view-confirm">{T.viewConfirm}</button><span class="text-xs text-mute">{T.viewNote}</span>
        {:else if role === "assistant"}
          <span class="text-sm font-medium">{T.assistTitle(view.party.assistsName)}</span><div class="flex gap-2"><button class="btn flex-1" disabled={busyRole} onclick={() => assistNow(false)} data-testid="assist-save">{T.assistSave}</button><button class="btn primary flex-1" disabled={busyRole} onclick={() => assistNow(true)} data-testid="assist-finish">{T.assistFinish}</button></div><span class="text-xs text-mute">{T.assistNote}</span>
        {:else}
          <div class="flex items-center gap-3 sm:min-w-[200px]">
            <div class="h-1.5 flex-1 overflow-hidden rounded-full bg-tint sm:w-24 sm:flex-none" role="progressbar" aria-valuemin="0" aria-valuemax={mine.length} aria-valuenow={mine.length - open.length} aria-label={T.toFill(open.length)}><div class="barfill h-full rounded-full bg-brand" style="width:{mine.length ? ((mine.length - open.length) / mine.length) * 100 : 100}%"></div></div>
            <span class="text-sm text-mute" role="status" data-testid="signpdf-left">{open.length ? T.toFill(open.length) : T.allFilled}</span>
            <!-- R8-30: the next field's name sits INSIDE its button; beside the signer's own name box it read as that box's label ("Time to review: Pat Provider") -->{#if open.length}<button class="btn !min-h-9 max-w-[13rem] !px-3 !py-1" onclick={nextField} data-testid="signpdf-next"><span class="shrink-0 whitespace-nowrap">{T.nextField}</span>{#if open[0].label}<span class="ml-1.5 min-w-0 truncate text-xs font-normal text-mute" data-testid="signpdf-next-label">· {open[0].label}</span>{/if}</button>{/if}
          </div>
          <input class="field sm:!w-[170px]" bind:value={name} placeholder={T.yourName} aria-label={T.yourName} autocomplete="name" data-testid="signpdf-name" />
          {#if policy.requireReason}<input class="field sm:!w-[220px]" bind:value={why} maxlength="500" placeholder={T.sp.whySigning} aria-label={T.sp.whySigning} data-testid="signpdf-reason" />{/if}
          <label class="flex items-start gap-2 text-sm text-mute sm:max-w-[16rem] sm:text-xs"><input type="checkbox" class="mt-0.5 h-5 w-5 shrink-0 accent-[var(--brand)] sm:h-4 sm:w-4" bind:checked={consent} data-testid="signpdf-consent" /><span title={view.consent?.text}>{T.agree}</span></label>
          <div class="flex items-center gap-2 sm:ml-auto">
            <button class="btn primary !min-h-12 flex-1 !text-base sm:!min-h-10 sm:flex-none sm:!text-[.95rem]" disabled={phase === "signing" || !pdf} title={!pdf ? T.loading : undefined} onclick={sign} style={accent ? `background:${accent};border-color:${accent}` : ""} data-testid="signpdf-finish">{T.finish}</button>
            <details class="relative"><summary class="btn list-none" aria-label={T.more ?? "More"}>{T.more ?? "More"}</summary>
              <div class="absolute bottom-full right-0 mb-2 flex w-56 flex-col gap-1 rounded-lg border border-line bg-card p-2 shadow-lg" onclick={(e) => e.currentTarget.closest("details")?.removeAttribute("open")} role="presentation">
                <button class="btn quiet !justify-start" onclick={saveForLater}>{T.later}</button>
                {#if policy.allowDecline !== false}<button class="btn quiet !justify-start" onclick={() => (declining = !declining)} data-testid="signpdf-decline">{T.decline}</button>{/if}
                <button class="btn quiet !justify-start" onclick={() => (changing = !changing)} data-testid="signpdf-ask-changes">{T.askChanges ?? "Ask for changes"}</button>
                {#if policy.allowDelegate}<button class="btn quiet !justify-start" onclick={() => (delegating = !delegating)} data-testid="signpdf-delegate">{T.sp.passTo}</button>{/if}
              </div></details>
          </div>
        {/if}
      </div>
      {#if saved}<p class="mx-auto mt-1 max-w-[1760px] text-xs text-mute" role="status">{saved}</p>{/if}
      {#if problem}<p class="mx-auto mt-1 max-w-[1760px] text-sm text-bad" role="alert" data-testid="signpdf-problem">{problem}</p>{/if}
      {#if delegating}<form class="mx-auto mt-2 flex max-w-[1760px] flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center" onsubmit={(e) => { e.preventDefault(); delegateNow(); }}><input class="field sm:!w-[200px]" bind:value={dName} placeholder={T.sp.theirName} aria-label={T.sp.theirName} /><input class="field sm:!w-[240px]" type="email" bind:value={dEmail} placeholder={T.sp.theirEmail} aria-label={T.sp.theirEmail} /><button class="btn primary" disabled={!dName.trim() || !dEmail.trim()} data-testid="signpdf-delegate-send">{T.sp.sendThem}</button></form>{/if}
      {#if changing}<div class="mx-auto mt-2 max-w-[1760px] space-y-2"><textarea class="field" bind:value={changeText} maxlength="1000" placeholder={T.askWhy ?? "What needs to change?"} aria-label={T.askWhy ?? "What needs to change?"}></textarea><button class="btn" onclick={sendChanges} data-testid="signpdf-ask-send">{T.askSend ?? "Send to the sender"}</button></div>{/if}
      {#if changeSent}<p class="mx-auto mt-2 max-w-[1760px] text-sm" role="status" data-testid="signpdf-asked">{T.askDone ?? "Sent. The sender has been told what to change. You can sign once they have fixed it."}</p>{/if}
      {#if declining}<div class="mx-auto mt-2 max-w-[1760px] space-y-2"><textarea class="field" bind:value={reason} placeholder={view.requireDeclineReason ? T.declineWhyReq : T.declineWhy} aria-label={T.sp.declineReason}></textarea><button class="btn" onclick={declineNow} data-testid="signpdf-decline-confirm">{T.declineSend}</button></div>{/if}
    </div>
  </div>
{/if}
</div>
<style>
  details[data-field][open] { z-index: 40; }   /* P10-A-7: an open "Choose several" list sits above the next field */
  .barfill { transition: width .5s cubic-bezier(.22, 1, .36, 1); }
  /* a field box over the page is as tall as the printed blank (often 10 to 20 px): the input inside must not bring its own padding, line height or minimum height, or its text sits low and spills out of the box (found 5 Oct 2026 on a 390 px phone) */
  .fieldlive { z-index: 2; min-height: 28px; min-width: 28px; }   /* R10-58: on a phone the page is drawn small; a box to fill in stays a 24 px target (WCAG 2.5.8) */   /* a box this person fills in sits above anyone else's box it overlaps, so the click always lands on theirs */
  .fieldinput { display: block; vertical-align: top; padding-block: 0; min-height: 0; line-height: 1.1; box-sizing: border-box; }
  .fieldinput::placeholder { text-overflow: ellipsis; }
  .fieldinput[aria-invalid="true"] { outline: 2px solid #b91c1c; outline-offset: -1px; }   /* a box left with a value not in the form the field asks for, or any such box after a Finish that was refused */
  .fieldlive { transition: background-color .25s ease, box-shadow .25s ease; animation: fieldin .6s ease-out 1; }
  .fieldlive:focus-within, .fieldlive:hover { box-shadow: 0 0 0 4px color-mix(in srgb, var(--brand) 22%, transparent); }
  @keyframes fieldin { from { box-shadow: 0 0 0 0 color-mix(in srgb, var(--brand) 40%, transparent); } to { box-shadow: 0 0 0 10px transparent; } }
  .calcbox { background: color-mix(in srgb, var(--brand) 8%, transparent); border-style: dotted; cursor: default; }   /* a box that works itself out: visibly not for typing */
  .sealpress { animation: press .7s cubic-bezier(.22, 1.4, .36, 1) 1; }
  @keyframes press { from { transform: scale(1.6) rotate(-8deg); opacity: 0; } 60% { opacity: 1; } to { transform: none; } }
  @media (prefers-reduced-motion: reduce) { .barfill, .fieldlive, .sealpress { transition: none; animation: none; } }
</style>
