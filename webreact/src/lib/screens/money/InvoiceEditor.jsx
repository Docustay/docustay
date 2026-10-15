// ═══════════════════════════════════════════════════════════════════════════════════════════════
// InvoiceEditor.jsx — specs/INVOICE-SEND-FIX.md.
//
// ★★★ EDITING IS PLATFORM-ONLY. Every field change saves to the platform's own invoice/line-item rows
//     through the normal write routes (`/api/money/invoices/update`, `/api/money/line-items*`) —
//     nothing here ever calls Stripe. The ONE Stripe invoice is created, exactly once, at Send
//     (invoiceSend.mjs → pushInvoiceToStripe). The preview (PDF/Email/Payment-page tabs) is
//     `buildInvoiceView` (@keystone/money/invoiceView.mjs) called against this SAME local form
//     state — the identical function the server uses to build the PDF attached to the real email,
//     so what's previewed here and what gets sent can never diverge.
//
// ★ The previous version of this file (Part 3 rebuild, 1 Oct 2026) synced a live Stripe DRAFT on
//   every debounced edit (`POST /api/money/invoices/draft-sync`) and built its preview from that
//   draft's own Stripe object. Removed per the maintainer's ruling — see specs/INVOICE-SEND-FIX.md §1 for the
//   full reasoning (the due-date mismatch and "Send just saves" symptoms both traced back to that
//   design: two independently-fetched sources of the same invoice, racing).
//
// ★ EVERYTHING 20.68 ALREADY DID STAYS: footer, ≤4 custom fields, page size, rendering template,
//   reminders tri-state, Hide preview, the 3 tabs. The old file's own hard-won fixes (F816 local-
//   date math, F817 custom_fields array-not-object, F819 tri-state reminders, the card-on-file
//   audit) are carried forward verbatim, not re-derived.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useState, useEffect, useMemo, useRef } from "react";
import { useMutation } from "@tanstack/react-query";
import { usePDF } from "@react-pdf/renderer";
import { request, ApiError } from "@/lib/api.js";

import ScreenState from "@/lib/empty/ScreenState.jsx";
import ErrorPanel from "@/lib/empty/ErrorPanel.jsx";
import { Field, FieldLabel, FieldContent } from "@/lib/components/ui/field.jsx";
import { Input } from "@/lib/components/ui/input.jsx";
import { Textarea } from "@/lib/components/ui/textarea.jsx";
import Combobox from "@/lib/components/kit/Combobox.jsx";
import { Button } from "@/lib/components/ui/button.jsx";
import { RadioGroup, RadioGroupItem } from "@/lib/components/ui/radio-group.jsx";
import { Checkbox } from "@/lib/components/ui/checkbox.jsx";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/lib/components/ui/tabs.jsx";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/lib/components/ui/collapsible.jsx";

import LineItemTable from "@/lib/money/LineItemTable.jsx";
import SettingsAtAGlance from "@/lib/money/SettingsAtAGlance.jsx";

import InvoiceEditorModal1Modal from "./InvoiceEditorModal1Modal.jsx";

import { InvoiceDocument, registerInvoiceFonts } from "@keystone/money/invoicePdf.mjs";
import { buildInvoiceView } from "@keystone/money/invoiceView.mjs";

// ★ Registered once, at module load — the SAME filenames invoicePdfServer.mjs resolves locally
//   (F860: plain WOFF, not WOFF2 — fontkit cannot subset WOFF2 — see that finding for the full
//   measured reasoning). Served from webreact/public/fonts/pdf/ at this same path in production.
registerInvoiceFonts((filename) => `/fonts/pdf/${filename}`);

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August",
  "September", "October", "November", "December"];

// ★ F816 (carried forward, verbatim reasoning) — parsing "YYYY-MM-DD" directly, never through a
//   Date object, so no viewer-timezone can step the shown day back or forward.
function formatDateStringLong(s) {
  if (!s) return "";
  const [y, m, d] = s.split("-").map(Number);
  if (!y || !m || !d) return "";
  return `${MONTH_NAMES[m - 1]} ${d}`;
}
function addDaysLocal(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function formatAmount(minor) {
  if (minor == null) return "$0.00";
  return `$${(minor / 100).toFixed(2)}`;
}

const DUE_DATE_PRESETS = [1, 3, 7, 14, 30, 60, 90];
const PAYMENT_METHOD_TYPE_LABELS = { card: "Card", us_bank_account: "US bank transfer (ACH)", link: "Link" };
const SAVE_DEBOUNCE_MS = 500;

export default function InvoiceEditor({
  path = null,
  params = null,
  app = null,
  onNavigate = null,
  onRefetch = null,
  initialPayerUserId = null,
}) {
  // ── Screen lifecycle ──────────────────────────────────────────────────────────────────────
  const [screenPhase, setScreenPhase] = useState("loading"); // loading, ready, denied, error
  const [error, setError] = useState(null);
  // { id, status, invoice_number, updated_at, issued_at, hosted_invoice_url, paid_minor, amount_remaining_minor }
  const [invoice, setInvoice] = useState(null);
  const [isSent, setIsSent] = useState(false);
  const [peopleOptions, setPeopleOptions] = useState([]);

  // ── Form state (ported from the pre-rebuild editor, same names) ─────────────────────────────
  const [payerUserId, setPayerUserId] = useState("");
  const [payerLabel, setPayerLabel] = useState("");
  const [payerCard, setPayerCard] = useState(null);
  const [payerEmail, setPayerEmail] = useState("");
  const [lineItems, setLineItems] = useState([]); // [{id, name, unitAmount, quantity, discount, tax, sourceType, sourceId}]
  const [dueAt, setDueAt] = useState("");
  const [memo, setMemo] = useState("");
  const [footer, setFooter] = useState("");
  const [customFields, setCustomFields] = useState([]);
  const [pageSize, setPageSize] = useState("a4");
  const [remindersEnabled, setRemindersEnabled] = useState(null); // F819 tri-state
  const [reminders, setReminders] = useState([]);
  const [collectionMethod, setCollectionMethod] = useState("send_invoice");
  const [paymentMethodTypes, setPaymentMethodTypes] = useState(["card"]);

  // ── Screen-only UI state ──────────────────────────────────────────────────────────────────
  const [hidePreview, setHidePreview] = useState(false);
  const [previewTab, setPreviewTab] = useState("pdf"); // pdf, email, payment
  const [expandedSetting, setExpandedSetting] = useState(null);
  const [moreOptionsOpen, setMoreOptionsOpen] = useState(false);
  const [step, setStep] = useState("edit"); // edit, review
  const [showDiscardGuard, setShowDiscardGuard] = useState(false);
  const [showAddLineForm, setShowAddLineForm] = useState(false);

  const [saveStatus, setSaveStatus] = useState("idle"); // idle, saving, saved, error
  const [saveError, setSaveError] = useState(null);
  const [sending, setSending] = useState(false);
  const firstRenderRef = useRef(true);
  const creatingInvoiceRef = useRef(false);
  const lineItemsRef = useRef(lineItems);
  lineItemsRef.current = lineItems;
  const lineDebounceRefs = useRef({}); // lineId -> timeout handle

  // ── Fetch invoice + people roster on mount ───────────────────────────────────────────────
  useEffect(() => {
    const invoiceId = params?.id;
    if (!invoiceId || invoiceId === "new") {
      setInvoice({ id: "new", status: "draft" });
      setPayerUserId(initialPayerUserId ?? "");
      setScreenPhase("ready");
    } else {
      fetchInvoice(invoiceId);
    }
  }, [params?.id]);

  useEffect(() => {
    let live = true;
    request("/api/list/people/all")
      .then((r) => { if (live) setPeopleOptions((r?.rows ?? []).map((p) => ({ value: p.id, label: p.display_name ?? p.email ?? p.id }))); })
      .catch(() => { if (live) setPeopleOptions([]); });
    return () => { live = false; };
  }, []);

  async function fetchInvoice(invoiceId) {
    try {
      setScreenPhase("loading");
      const res = await request(`/api/money/invoices/${invoiceId}/editor`);
      const inv = res?.invoice ?? null;
      if (!inv) { setScreenPhase("error"); setError(new Error("Invoice not found")); return; }

      setInvoice(inv);
      setPayerUserId(inv.payer_user_id || "");
      setPayerLabel(inv.payer_display_name || "");
      setPayerEmail(inv.payer_email || "");
      setPayerCard(res?.payerCard ?? null);
      setCollectionMethod(inv.collection_method || "send_invoice");
      setPaymentMethodTypes(Array.isArray(inv.payment_method_types) && inv.payment_method_types.length ? inv.payment_method_types : ["card"]);
      setDueAt(inv.due_at ? inv.due_at.split("T")[0] : "");
      setMemo(inv.memo || "");
      // ★ F817 (carried forward) — custom_fields defaults to a jsonb OBJECT ('{}'), never trust it as an array without checking.
      setCustomFields(Array.isArray(inv.custom_fields) ? inv.custom_fields : []);
      const rendering = inv.rendering || {};
      setFooter(rendering.footer || "");
      setPageSize(rendering.page_size || "a4");
      setRemindersEnabled(inv.reminders_enabled === true || inv.reminders_enabled === false ? inv.reminders_enabled : null);
      setLineItems((res?.lineItems ?? []).map((l) => ({
        id: l.id, name: l.name ?? l.name_snapshot, unitAmount: l.unitAmount ?? l.unit_amount_minor,
        quantity: l.quantity ?? 1, discount: l.discount ?? l.discount_minor ?? 0, tax: l.tax ?? l.tax_minor ?? 0,
        sourceType: l.sourceType ?? null, sourceId: l.sourceId ?? null,
      })));
      setReminders(res?.reminders ?? []);
      setIsSent(inv.status !== "draft");
      setScreenPhase("ready");
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) setScreenPhase("denied");
      else if (err instanceof ApiError && err.status === 404) { setScreenPhase("error"); setError(new Error("Invoice not found")); }
      else { setScreenPhase("error"); setError(err); }
    }
  }

  // ── Header save — debounced, local only, never touches Stripe ───────────────────────────
  const headerSaveMutation = useMutation({
    mutationFn: (body) => request("/api/money/invoices/update", { method: "POST", body }),
    onMutate: () => { setSaveStatus("saving"); setSaveError(null); },
    onSuccess: (res) => {
      setSaveStatus("saved");
      if (res?.updated_at) setInvoice((prev) => (prev ? { ...prev, updated_at: res.updated_at } : prev));
    },
    onError: (err) => { setSaveStatus("error"); setSaveError(err); },
  });

  const headerDebounceRef = useRef(null);
  useEffect(() => {
    if (firstRenderRef.current) { firstRenderRef.current = false; return; }
    if (!invoice || invoice.id === "new" || isSent) return;
    clearTimeout(headerDebounceRef.current);
    headerDebounceRef.current = setTimeout(() => {
      headerSaveMutation.mutate({
        invoiceId: invoice.id, expectedUpdatedAt: invoice.updated_at,
        payerUserId, dueAt: dueAt ? new Date(dueAt).toISOString() : null,
        collectionMethod, paymentMethodTypes,
        footer: footer || null, memo: memo || null, customFields,
        rendering_page_size: pageSize, remindersEnabled,
      });
    }, SAVE_DEBOUNCE_MS);
    return () => clearTimeout(headerDebounceRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payerUserId, dueAt, collectionMethod, paymentMethodTypes, footer, memo, customFields, pageSize, remindersEnabled]);

  // ── Handlers ──────────────────────────────────────────────────────────────────────────────
  async function handlePayerChange(value) {
    setPayerUserId(value);
    const selected = peopleOptions.find((p) => p.value === value);
    setPayerLabel(selected?.label || "");
    // ★ "When an invoice is started (customer chosen), create the invoice row" — a brand-new
    //   invoice has no real row at all yet; mint one the moment a payer is picked, so the header
    //   save effect above has a real invoiceId to work with from here on.
    //   ★ FOUND LIVE, first real browser test: some comboboxes fire onValueChange twice for one
    //   pick (once on highlight, once on commit) — `invoice?.id === "new"` alone is not enough to
    //   stop a second, near-simultaneous call from also passing the check, because `setInvoice`
    //   has not re-rendered yet when the second call reads the same stale closure. A real,
    //   synchronous ref (not state) is what actually blocks the race.
    if (invoice?.id === "new" && value && !creatingInvoiceRef.current) {
      creatingInvoiceRef.current = true;
      try {
        const created = await request("/api/money/invoices", { method: "POST", body: { payerUserId: value, amountMinor: 0, currency: "USD" } });
        setInvoice({ id: created.id, status: "draft", invoice_number: created.invoice_number, updated_at: created.updated_at });
      } catch (err) {
        creatingInvoiceRef.current = false;
        setSaveStatus("error");
        setSaveError(err);
      }
    }
  }

  function handleDueAtPreset(days) { setDueAt(addDaysLocal(days)); }
  function handleCollectionMethodChange(value) { setCollectionMethod(value); }
  function handlePaymentMethodTypeToggle(type) {
    setPaymentMethodTypes((prev) => {
      const has = prev.includes(type);
      if (has && prev.length === 1) return prev; // at least one must stay checked
      return has ? prev.filter((t) => t !== type) : [...prev, type];
    });
  }
  function handleRemindersEnabledChange(value) { setRemindersEnabled(value === "on" ? true : value === "off" ? false : null); }

  // ── Lines — each a direct, immediate call against the platform's own line-item routes. No Stripe
  //    call is ever made for a line; the one Stripe invoice is built from whatever these rows say
  //    at Send time. ───────────────────────────────────────────────────────────────────────────
  async function handleAddLine(line) {
    const tempId = `local:${crypto.randomUUID()}`;
    setLineItems((prev) => [...prev, {
      id: tempId, name: line.name, unitAmount: line.unitAmountMinor,
      quantity: line.quantity, discount: 0, tax: 0, sourceType: line.sourceType, sourceId: line.sourceId,
    }]);
    setShowAddLineForm(false);
    if (!invoice?.id || invoice.id === "new") return;
    try {
      setSaveStatus("saving");
      const created = await request("/api/money/line-items", {
        method: "POST",
        body: {
          parentType: "invoice", parentId: invoice.id,
          sourceType: line.sourceType ?? "custom", sourceId: line.sourceId ?? null,
          nameSnapshot: line.name, unitAmountMinor: line.unitAmountMinor, quantity: line.quantity ?? 1,
          discountMinor: 0, taxMinor: 0, currency: "USD",
        },
      });
      setLineItems((prev) => prev.map((l) => (l.id === tempId ? { ...l, id: created.id } : l)));
      setSaveStatus("saved");
    } catch (err) {
      setSaveStatus("error");
      setSaveError(err);
    }
  }

  async function handleRemoveLine(lineId) {
    setLineItems((prev) => prev.filter((l) => l.id !== lineId));
    clearTimeout(lineDebounceRefs.current[lineId]);
    delete lineDebounceRefs.current[lineId];
    // ★ A still-unresolved temp id has no server-side row yet — nothing to void.
    if (typeof lineId === "string" && lineId.startsWith("local:")) return;
    if (!invoice?.id || invoice.id === "new") return;
    try {
      await request("/api/money/line-items/void", { method: "POST", body: { lineItemId: lineId, invoiceId: invoice.id } });
    } catch (err) {
      setSaveStatus("error");
      setSaveError(err);
    }
  }

  // ★ the maintainer, 1 Oct 2026 — real-time edit of an existing line's qty/price. Updates `lineItems`
  //   immediately (the preview reacts right away); the save to the platform is debounced per-line, the
  //   same 500ms rhythm the header fields use.
  function handleEditLine(lineId, patch) {
    setLineItems((prev) => prev.map((l) => (l.id === lineId ? { ...l, ...patch } : l)));
    // ★ A line still waiting on its own Add create-call has no real id to PATCH yet — skip. The
    //   next edit after that create resolves will carry the latest values through normally.
    if (typeof lineId === "string" && lineId.startsWith("local:")) return;
    if (!invoice?.id || invoice.id === "new") return;
    clearTimeout(lineDebounceRefs.current[lineId]);
    lineDebounceRefs.current[lineId] = setTimeout(async () => {
      const current = lineItemsRef.current.find((l) => l.id === lineId);
      if (!current) return;
      try {
        setSaveStatus("saving");
        await request("/api/money/line-items/update", {
          method: "POST",
          body: {
            lineItemId: lineId, invoiceId: invoice.id, nameSnapshot: current.name,
            unitAmountMinor: current.unitAmount, quantity: current.quantity ?? 1,
            discountMinor: current.discount ?? 0, taxMinor: current.tax ?? 0,
          },
        });
        setSaveStatus("saved");
      } catch (err) {
        setSaveStatus("error");
        setSaveError(err);
      }
    }, SAVE_DEBOUNCE_MS);
  }

  function handleAddCustomField() {
    if (customFields.length >= 4) { setSaveError(new Error("Custom fields are limited to 4.")); return; }
    setCustomFields([...customFields, { name: "", value: "" }]);
  }
  function handleRemoveCustomField(idx) { setCustomFields(customFields.filter((_, i) => i !== idx)); }
  function handleCustomFieldChange(idx, field, val) {
    const updated = customFields.map((f, i) => (i === idx ? { ...f, [field]: val } : f));
    setCustomFields(updated);
  }

  async function handleDiscard() {
    if (invoice?.id && invoice.id !== "new") {
      try { await request("/api/money/invoices/delete-draft", { method: "POST", body: { invoiceId: invoice.id } }); }
      catch (err) { /* best effort — navigating away regardless, same as before */ }
    }
    onNavigate?.("/money/invoices");
  }

  function handleClose() {
    if ((payerUserId || lineItems.length > 0) && !showDiscardGuard) { setShowDiscardGuard(true); return; }
    onNavigate?.("/money/invoices");
  }

  // ── Send — the ONE Stripe invoice is created here, server-side, exactly once ────────────
  async function handleSend() {
    if (sending || !invoice?.id || invoice.id === "new" || lineItems.length === 0) return;
    setSending(true);
    setSaveError(null);
    try {
      const res = await request(`/api/money/invoices/send`, { method: "POST", body: { invoiceId: invoice.id } });
      setInvoice({ ...invoice, status: res?.status || "open" });
      setIsSent(true);
      setStep("edit");
    } catch (err) {
      if (err instanceof ApiError && err.status === 503) { setInvoice({ ...invoice, status: "open" }); setIsSent(true); }
      // ★ A retry whose FIRST attempt actually committed (sent_at set) hits sendInvoice's own
      //   existing "Already sent" conflict (409) on the second click. That is success, not failure.
      else if (err instanceof ApiError && err.status === 409) { setInvoice({ ...invoice, status: "open" }); setIsSent(true); }
      else setSaveError(err);
    } finally {
      setSending(false);
    }
  }

  // ── Derived ───────────────────────────────────────────────────────────────────────────────
  const dueDateLong = useMemo(() => formatDateStringLong(dueAt), [dueAt]);

  // ★ ONE view-model builder, called against this screen's own local form state — the exact same
  //   function the server uses to build the PDF attached to the real email (specs/INVOICE-SEND-
  //   FIX.md §1). Never a second, independent computation of totals.
  const previewInvoiceRow = useMemo(() => ({
    status: invoice?.status ?? "draft",
    currency: "usd",
    invoice_number: invoice?.invoice_number || null,
    due_at: dueAt ? new Date(dueAt).toISOString() : null,
    issued_at: invoice?.issued_at ?? new Date().toISOString(),
    custom_fields: customFields,
    rendering: { footer: footer || null, page_size: pageSize },
    memo: memo || null,
    hosted_invoice_url: invoice?.hosted_invoice_url ?? null,
    paid_minor: invoice?.paid_minor ?? 0,
    amount_remaining_minor: invoice?.amount_remaining_minor ?? null,
  }), [invoice, dueAt, customFields, footer, pageSize, memo]);

  const previewLines = useMemo(() => lineItems.map((l) => ({
    name_snapshot: l.name, unit_amount_minor: l.unitAmount ?? 0, quantity: l.quantity ?? 1,
    discount_minor: l.discount ?? 0, tax_minor: l.tax ?? 0,
  })), [lineItems]);

  const view = useMemo(() => {
    try {
      return buildInvoiceView({
        invoice: previewInvoiceRow, lines: previewLines,
        payer: { display_name: payerLabel || null, email: payerEmail || null },
        practiceBranding: { name: app?.practiceName || "Your practice", logoUrl: null, phone: null },
      });
    } catch (err) {
      return null;
    }
  }, [previewInvoiceRow, previewLines, payerLabel, payerEmail, app]);

  // ── Phases ────────────────────────────────────────────────────────────────────────────────
  if (screenPhase === "loading") return <ScreenState phase="loading" />;
  if (screenPhase === "denied") return <ScreenState phase="denied" />;
  if (screenPhase === "error") return <ErrorPanel error={error} onBack={() => onNavigate?.("/money/invoices")} />;
  if (screenPhase !== "ready" || !invoice || !view) return null;

  if (step === "review") {
    return (
      <ReviewStep
        view={view} payerLabel={payerLabel} payerEmail={payerEmail} payerCard={payerCard}
        collectionMethod={collectionMethod} sending={sending} error={saveError}
        onBack={() => setStep("edit")} onSend={handleSend}
      />
    );
  }

  return (
    <div className="flex h-dvh flex-col bg-canvas" data-testid="money-invoice-editor">
      {/* ── Top bar ── */}
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-line px-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={handleClose} data-testid="invoice-close-btn">Close</Button>
          <span className="text-ui font-medium text-ink">{isSent ? `Invoice ${invoice.invoice_number || ""}` : "Create invoice"}</span>
          <SaveStatusBadge status={saveStatus} />
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setHidePreview(!hidePreview)} data-testid="invoice-hide-preview-btn">
            {hidePreview ? "Show preview" : "Hide preview"}
          </Button>
          <Button size="sm" onClick={() => setStep("review")} disabled={isSent || !payerUserId || lineItems.length === 0} data-testid="invoice-review-btn">
            Review invoice
          </Button>
        </div>
      </div>

      {saveError && (
        <div className="border-b border-line bg-bad-soft px-6 py-2">
          <p className="m-0 text-sm text-bad">{saveError.message || "Could not save this change."}</p>
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        {/* ── Left column: the form ── */}
        <div className="w-1/2 overflow-y-auto border-r border-line px-8 py-6">
          <div className="flex flex-col gap-6 max-w-xl">
            <Field>
              <FieldLabel htmlFor="invoice-bill-to">Customer</FieldLabel>
              <FieldContent>
                <Combobox id="invoice-bill-to" options={peopleOptions} value={payerUserId} onValueChange={handlePayerChange}
                  placeholder="Search people and accounts" disabled={isSent} />
                {payerLabel && <p className="mt-1.5 text-sm text-mute">{payerLabel}</p>}
              </FieldContent>
            </Field>

            <Field>
              <FieldLabel>Currency</FieldLabel>
              <FieldContent>
                <div className="flex h-9 items-center rounded-md border border-line bg-surface-2 px-3 text-sm text-ink-2">USD</div>
              </FieldContent>
            </Field>

            <Field>
              <FieldLabel>Items</FieldLabel>
              <FieldContent>
                <LineItemTable lineItems={lineItems} onAddLine={handleAddLine} onRemoveLine={handleRemoveLine} onEditLine={handleEditLine} onAddDiscount={() => {}} />
              </FieldContent>
            </Field>

            <Field>
              <FieldLabel htmlFor="invoice-due-preset">Payment collection</FieldLabel>
              <FieldContent>
                <RadioGroup value={collectionMethod} onValueChange={handleCollectionMethodChange} disabled={isSent} className="flex flex-col gap-2 mb-3">
                  <label className="flex items-start gap-2 text-sm text-ink">
                    <RadioGroupItem value="send_invoice" className="mt-0.5" /><span>Request payment by the due date</span>
                  </label>
                  <label className="flex items-start gap-2 text-sm text-ink">
                    <RadioGroupItem value="charge_automatically" className="mt-0.5" />
                    <span>
                      Autocharge the card on file
                      {payerCard
                        ? <span className="block text-xs text-mute mt-0.5">{payerCard.brand?.[0]?.toUpperCase()}{payerCard.brand?.slice(1)} •••• {payerCard.lastFour}</span>
                        : <span className="block text-xs text-bad mt-0.5">No card on file — this would fail until one is added</span>}
                    </span>
                  </label>
                </RadioGroup>
                <div className="flex flex-wrap gap-1.5" id="invoice-due-preset">
                  {DUE_DATE_PRESETS.map((days) => {
                    const active = dueAt === addDaysLocal(days);
                    return (
                      <button key={days} type="button" onClick={() => handleDueAtPreset(days)} disabled={isSent} aria-pressed={active}
                        className={"rounded-full border px-3 py-1 text-sm font-medium transition-colors " +
                          (active ? "border-accent bg-accent text-white" : "border-line bg-surface text-ink-2 hover:bg-surface-2") +
                          (isSent ? " opacity-50 cursor-not-allowed" : " cursor-pointer")}>
                        {days}d
                      </button>
                    );
                  })}
                </div>
                <p className="mt-1.5 text-sm text-mute">{dueAt ? `Due ${dueDateLong}.` : "Pick a due date."}</p>
              </FieldContent>
            </Field>

            <Collapsible open={moreOptionsOpen} onOpenChange={setMoreOptionsOpen}>
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="sm" className="justify-start px-0">{moreOptionsOpen ? "Hide" : "Show"} more options</Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="flex flex-col gap-5 pt-3">
                <Field>
                  <FieldLabel htmlFor="invoice-memo">Memo <span className="text-xs text-mute">shown on the invoice</span></FieldLabel>
                  <FieldContent><Textarea id="invoice-memo" value={memo} onChange={(e) => setMemo(e.target.value)} disabled={isSent} rows={2} /></FieldContent>
                </Field>
                <Field>
                  <FieldLabel htmlFor="invoice-footer">Footer</FieldLabel>
                  <FieldContent><Textarea id="invoice-footer" value={footer} onChange={(e) => setFooter(e.target.value)} disabled={isSent} rows={2} /></FieldContent>
                </Field>
                <Field>
                  <FieldLabel>Custom fields <span className="text-xs text-mute">up to 4</span></FieldLabel>
                  <FieldContent>
                    <div className="flex flex-col gap-2">
                      {customFields.map((f, idx) => (
                        <div key={idx} className="flex gap-2">
                          <Input placeholder="Name" value={f.name || ""} onChange={(e) => handleCustomFieldChange(idx, "name", e.target.value)} disabled={isSent} className="w-1/2" />
                          <Input placeholder="Value" value={f.value || ""} onChange={(e) => handleCustomFieldChange(idx, "value", e.target.value)} disabled={isSent} className="w-1/2" />
                          <Button variant="ghost" size="sm" onClick={() => handleRemoveCustomField(idx)} disabled={isSent}>Remove</Button>
                        </div>
                      ))}
                      {customFields.length < 4 && <Button variant="ghost" size="sm" className="justify-start px-0" onClick={handleAddCustomField} disabled={isSent}>+ Add a custom field</Button>}
                    </div>
                  </FieldContent>
                </Field>
                <Field>
                  <FieldLabel>Page size</FieldLabel>
                  <FieldContent>
                    <RadioGroup value={pageSize} onValueChange={setPageSize} disabled={isSent} className="flex gap-4">
                      <label className="flex items-center gap-2 text-sm text-ink"><RadioGroupItem value="a4" />A4</label>
                      <label className="flex items-center gap-2 text-sm text-ink"><RadioGroupItem value="letter" />Letter</label>
                    </RadioGroup>
                  </FieldContent>
                </Field>
                <Field>
                  <FieldLabel>Reminders</FieldLabel>
                  <FieldContent>
                    <RadioGroup value={remindersEnabled === true ? "on" : remindersEnabled === false ? "off" : "default"} onValueChange={handleRemindersEnabledChange} disabled={isSent} className="flex flex-col gap-2">
                      <label className="flex items-start gap-2 text-sm text-ink"><RadioGroupItem value="default" className="mt-0.5" /><span>Use your practice's default</span></label>
                      <label className="flex items-start gap-2 text-sm text-ink"><RadioGroupItem value="on" className="mt-0.5" /><span>Send reminders</span></label>
                      <label className="flex items-start gap-2 text-sm text-ink"><RadioGroupItem value="off" className="mt-0.5" /><span>No reminders</span></label>
                    </RadioGroup>
                  </FieldContent>
                </Field>
                <Field>
                  <FieldLabel>Delivery — ways to pay</FieldLabel>
                  <FieldContent>
                    <div className="flex flex-col gap-2">
                      {Object.entries(PAYMENT_METHOD_TYPE_LABELS).map(([type, label]) => (
                        <label key={type} className="flex items-center gap-2 text-sm text-ink">
                          <Checkbox checked={paymentMethodTypes.includes(type)} onCheckedChange={() => handlePaymentMethodTypeToggle(type)} disabled={isSent} />
                          {label}
                        </label>
                      ))}
                    </div>
                  </FieldContent>
                </Field>
              </CollapsibleContent>
            </Collapsible>
          </div>
        </div>

        {/* ── Right column: Preview, or the settings panel when hidden ── */}
        <div className="w-1/2 overflow-y-auto bg-surface-2 px-8 py-6">
          {hidePreview ? (
            <SettingsAtAGlance
              expandedKey={expandedSetting}
              onToggleKey={setExpandedSetting}
              rows={[
                { key: "sending", title: "Sending", value: collectionMethod === "charge_automatically" ? "Charged automatically" : `By email${payerEmail ? ` to ${payerEmail}` : ""}`, content: null },
                { key: "waysToPay", title: "Ways to pay", value: paymentMethodTypes.map((t) => PAYMENT_METHOD_TYPE_LABELS[t] ?? t).join(", "), content: null },
                { key: "paymentOptions", title: "Payment options", value: "Set by your practice's Money settings", content: <p className="m-0 text-sm text-ink-2">Card-on-file and part-payments follow your practice's Money settings — no per-invoice override yet.</p> },
                { key: "tipping", title: "Tipping", value: "Off", content: <p className="m-0 text-sm text-ink-2">Tipping follows your practice's Money settings — no per-invoice override yet.</p> },
                { key: "reminders", title: "Reminders", value: remindersEnabled === false ? "Off" : remindersEnabled === true ? "On" : "Your practice's default", content: null },
                { key: "stripe", title: "Stripe", value: isSent ? "Sent" : "Created at Send", content: (
                    <div className="flex flex-col gap-1.5 text-sm text-ink-2">
                      {view.hostedInvoiceUrl
                        ? <a href={view.hostedInvoiceUrl} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">View in Stripe ↗</a>
                        : <p className="m-0">The Stripe invoice is created when you send — nothing is sent to Stripe while you're editing.</p>}
                    </div>
                  ) },
              ]}
            />
          ) : (
            <Tabs value={previewTab} onValueChange={setPreviewTab}>
              <TabsList>
                <TabsTrigger value="pdf">Invoice PDF</TabsTrigger>
                <TabsTrigger value="email">Email</TabsTrigger>
                <TabsTrigger value="payment">Payment page</TabsTrigger>
              </TabsList>
              <TabsContent value="pdf"><PdfPreview view={view} pageSize={pageSize} /></TabsContent>
              <TabsContent value="email"><EmailPreview view={view} payerEmail={payerEmail} /></TabsContent>
              <TabsContent value="payment"><PaymentPagePreview view={view} isSent={isSent} /></TabsContent>
            </Tabs>
          )}
        </div>
      </div>

      {showDiscardGuard && (
        <InvoiceEditorModal1Modal
          open={showDiscardGuard} onOpenChange={setShowDiscardGuard} invoice={invoice} showDiscardGuard={showDiscardGuard}
          handleClose={() => { setShowDiscardGuard(false); handleDiscard(); }}
        />
      )}
    </div>
  );
}

function SaveStatusBadge({ status }) {
  if (status === "idle") return null;
  const label = status === "saving" ? "Saving…" : status === "saved" ? "Saved" : "Not saved";
  const cls = status === "error" ? "text-bad" : "text-mute";
  return <span className={`text-xs ${cls}`} data-testid="invoice-sync-status">{label}</span>;
}

// ★ The PDF preview — the SAME InvoiceDocument component the server renders for the attachment
//   (invoicePdfServer.mjs), via @react-pdf/renderer's own browser build (usePDF → a blob URL).
function PdfPreview({ view, pageSize }) {
  const [instance] = usePDF({ document: <InvoiceDocument view={view} pageSize={pageSize} /> });
  if (instance.loading) return <div className="flex h-[600px] items-center justify-center text-sm text-mute">Rendering…</div>;
  if (instance.error) return <div className="flex h-[600px] items-center justify-center text-sm text-bad">Could not render the PDF: {instance.error}</div>;
  return (
    <div className="mx-auto max-w-[620px] rounded-lg bg-white shadow-sm" data-testid="invoice-pdf-preview">
      <iframe src={instance.url} title="Invoice PDF preview" className="h-[800px] w-full rounded-lg border-0" />
    </div>
  );
}

// ★ A faithful mock of money.invoice_issued's real rendered shape (src/email/send.mjs's
//   emailChromeFor + notificationEmail.mjs) — not a live backend render, so this never depends on
//   a real notification row existing. Every value comes straight from the SAME `view`.
function EmailPreview({ view, payerEmail }) {
  return (
    <div className="mx-auto max-w-[480px] rounded-xl bg-white p-6 shadow-sm" data-testid="invoice-email-preview">
      <p className="m-0 mb-4 text-xs text-mute">To: {payerEmail || "client@example.com"}</p>
      <p className="m-0 mb-1 text-sm font-semibold text-ink-2">{view.practice.name}</p>
      <p className="m-0 mb-1 text-3xl font-semibold text-ink">{formatAmount(view.amountDue)} due</p>
      {view.dueDate && <p className="m-0 mb-4 text-xs text-mute">Due {new Date(view.dueDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</p>}
      <p className="m-0 mb-4 text-lg font-medium text-ink">{view.practice.name}: invoice {view.invoiceNumber} for {formatAmount(view.amountDue)}</p>
      <p className="m-0 mb-4 whitespace-pre-wrap text-sm text-ink-2">
        {`Invoice ${view.invoiceNumber} for ${formatAmount(view.amountDue)} is now available${view.dueDate ? `, due ${new Date(view.dueDate).toLocaleDateString()}` : ""}.\n\n`}
        {view.lines.map((l) => `${l.description} x${l.quantity}: ${formatAmount(l.amount)}`).join("\n")}
      </p>
      <div className="mb-3 inline-block rounded-md bg-accent px-5 py-2.5 text-sm font-semibold text-white">Pay invoice</div>
      <p className="m-0 text-sm text-accent underline">Download the PDF</p>
      <hr className="my-4 border-line" />
      <p className="m-0 text-xs text-mute">Sent by {view.practice.name}.</p>
    </div>
  );
}

// ★ Draft: a labelled preview of Stripe's own secure payment page. Sent: the real hosted page.
function PaymentPagePreview({ view, isSent }) {
  if (isSent && view.hostedInvoiceUrl) {
    return (
      <div className="flex h-[600px] flex-col items-center justify-center gap-3 rounded-lg bg-white p-6 text-center shadow-sm" data-testid="invoice-payment-page-preview">
        <p className="m-0 text-sm text-ink-2">This invoice has been sent — the real Stripe payment page is live.</p>
        <a href={view.hostedInvoiceUrl} target="_blank" rel="noopener noreferrer" className="text-accent underline">Open the payment page ↗</a>
      </div>
    );
  }
  return (
    <div className="mx-auto max-w-[480px] rounded-xl bg-white p-6 shadow-sm" data-testid="invoice-payment-page-preview">
      <p className="m-0 mb-4 text-xs text-mute">Preview — what the client will see on Stripe's secure payment page</p>
      <p className="m-0 mb-1 text-sm text-ink-2">{view.practice.name}</p>
      <p className="m-0 mb-4 text-2xl font-semibold text-ink">{formatAmount(view.amountDue)}</p>
      {view.dueDate && <p className="m-0 mb-4 text-sm text-mute">Due {new Date(view.dueDate).toLocaleDateString()}</p>}
      <div className="mb-4 rounded-md border border-line p-3">
        {view.lines.map((l, i) => (
          <div key={i} className="flex justify-between py-1 text-sm text-ink-2">
            <span>{l.description} × {l.quantity}</span><span>{formatAmount(l.amount)}</span>
          </div>
        ))}
      </div>
      <div className="rounded-md bg-accent px-5 py-2.5 text-center text-sm font-semibold text-white">Pay {formatAmount(view.amountDue)}</div>
    </div>
  );
}

// ★ The Review step — recipient, amount, due date, collection method, PDF thumbnail → Send
//   invoice. No editing from here — the Stripe invoice this is about to create is immutable once
//   finalized, so "going back" means going back to the draft, never patching a frozen one.
function ReviewStep({ view, payerLabel, payerEmail, payerCard, collectionMethod, sending, error, onBack, onSend }) {
  return (
    <div className="flex h-dvh flex-col bg-canvas" data-testid="invoice-review-step">
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-line px-6">
        <Button variant="ghost" size="sm" onClick={onBack} disabled={sending}>Back</Button>
        <span className="text-ui font-medium text-ink">Review invoice</span>
        <Button size="sm" onClick={onSend} disabled={sending} data-testid="invoice-send-btn">{sending ? "Sending…" : "Send invoice"}</Button>
      </div>
      {error && <div className="border-b border-line bg-bad-soft px-6 py-2"><p className="m-0 text-sm text-bad">{error.message || "Could not send this invoice."}</p></div>}
      <div className="mx-auto flex max-w-3xl flex-1 gap-8 overflow-y-auto px-8 py-8">
        <div className="w-1/2 flex flex-col gap-4 text-sm">
          <div><span className="text-mute">Recipient</span><p className="m-0 font-medium text-ink">{payerLabel || "—"} {payerEmail ? `(${payerEmail})` : ""}</p></div>
          <div><span className="text-mute">Amount due</span><p className="m-0 text-xl font-semibold text-ink">{formatAmount(view.amountDue)}</p></div>
          {view.dueDate && <div><span className="text-mute">Due date</span><p className="m-0 text-ink">{new Date(view.dueDate).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</p></div>}
          <div><span className="text-mute">Collection method</span><p className="m-0 text-ink">{collectionMethod === "charge_automatically" ? "Autocharge card on file" : "Email, pay when ready"}</p></div>
          {collectionMethod === "charge_automatically" && (
            <div><span className="text-mute">Card</span><p className="m-0 text-ink">{payerCard ? `${payerCard.brand} •••• ${payerCard.lastFour}` : "No card on file"}</p></div>
          )}
          <div><span className="text-mute">Email subject</span><p className="m-0 text-ink">{view.practice.name}: invoice {view.invoiceNumber} for {formatAmount(view.amountDue)}</p></div>
        </div>
        <div className="w-1/2">
          <PdfPreview view={view} pageSize="a4" />
        </div>
      </div>
    </div>
  );
}
