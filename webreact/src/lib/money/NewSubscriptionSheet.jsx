// ═══════════════════════════════════════════════════════════════════════════════════════════════
// NewSubscriptionSheet — the in-depth subscription creator the maintainer asked for, matching Stripe's own:
// pick a customer, add any mix of services/packages/plans with quantities, trial days, billing
// collection method. Ported to: POST /api/money/subscriptions → createMultiItemSubscription
// (src/money/subscriptions.mjs), which calls Stripe's real Subscriptions API directly — no
// embedded Stripe UI, per the maintainer's ruling 28 Sep 2026.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useEffect, useState } from "react";
import { request, ApiError } from "@/lib/api.js";
import SideSheet from "@/lib/forms/SideSheet.jsx";
import Combobox from "@/lib/components/kit/Combobox.jsx";
import { Field, FieldLabel, FieldDescription } from "@/lib/components/ui/field.jsx";
import { Input } from "@/lib/components/ui/input.jsx";
import { Button } from "@/lib/components/ui/button.jsx";
import { NativeSelect, NativeSelectOption } from "@/lib/components/ui/native-select.jsx";
import ProgramGate from "@/lib/components/ProgramGate.jsx";

export default function NewSubscriptionSheet({ onCancel, onCreated }) {
  const [people, setPeople] = useState([]);
  const [catalogue, setCatalogue] = useState([]);
  const [loadingContext, setLoadingContext] = useState(false);
  // ★ the maintainer, 29 Sep 2026 (life coaching brief) — asked once per subscription, not once per line: a
  //   subscription's own items are coherently one group, the same way its own billing is one method.
  const [group, setGroup] = useState(null);

  const [personId, setPersonId] = useState("");
  const [lines, setLines] = useState([{ sourceId: "", quantity: 1, amountMinor: "" }]);
  const [trialDays, setTrialDays] = useState("");
  const [collectionMethod, setCollectionMethod] = useState("send_invoice");
  const [description, setDescription] = useState("");

  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(null);

  useEffect(() => {
    loadContext();
  }, []);

  async function loadContext() {
    setLoadingContext(true);
    try {
      const [peopleRes, servicesRes, packagesRes, plansRes] = await Promise.all([
        request("/api/list/people/all").catch(() => ({ rows: [] })),
        request("/api/list/items/services").catch(() => ({ rows: [] })),
        request("/api/list/items/packages").catch(() => ({ rows: [] })),
        request("/api/list/items/plans").catch(() => ({ rows: [] })),
      ]);
      setPeople(peopleRes?.rows ?? []);
      setCatalogue([
        ...(servicesRes?.rows ?? []).map((r) => ({ id: r.id, name: r.name, amountMinor: r.price_amount_minor, sourceType: "service", programId: r.program_id ?? null })),
        ...(packagesRes?.rows ?? []).map((r) => ({ id: r.id, name: r.name, amountMinor: r.price_amount_minor, sourceType: "package", programId: r.program_id ?? null })),
        ...(plansRes?.rows ?? []).map((r) => ({ id: r.id, name: r.name, amountMinor: r.price_amount_minor, sourceType: "plan", programId: r.program_id ?? null })),
      ]);
    } finally {
      setLoadingContext(false);
    }
  }

  function itemOf(id) {
    return catalogue.find((c) => c.id === id) ?? null;
  }

  function setLine(i, patch) {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  function addLine() {
    setLines((prev) => [...prev, { sourceId: "", quantity: 1, amountMinor: "" }]);
  }

  function removeLine(i) {
    setLines((prev) => prev.filter((_, idx) => idx !== i));
  }

  const totalMinor = lines.reduce((sum, l) => {
    const amt = String(l.amountMinor).trim() === "" ? 0 : Math.round(parseFloat(l.amountMinor) * 100);
    return sum + amt * (Number(l.quantity) || 1);
  }, 0);

  const canSubmit = !!personId && lines.some((l) => l.sourceId && String(l.amountMinor).trim() !== "");

  async function handleSubmit() {
    if (!canSubmit || busy) return;
    setBusy(true);
    setProblem(null);
    try {
      const items = lines
        .filter((l) => l.sourceId)
        .map((l) => {
          const item = itemOf(l.sourceId);
          return {
            sourceId: l.sourceId,
            sourceType: item?.sourceType ?? "service",
            name: item?.name ?? "Item",
            quantity: Number(l.quantity) || 1,
            amountMinor: Math.round(parseFloat(l.amountMinor) * 100),
          };
        });
      const res = await request("/api/money/subscriptions", {
        method: "POST",
        body: {
          personId,
          items,
          trialDays: trialDays ? Number(trialDays) : 0,
          collectionMethod,
          description: description.trim() || null,
        },
      });
      onCreated?.(res);
    } catch (err) {
      setProblem(err instanceof ApiError ? err.message : String(err?.message ?? err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SideSheet
      title="New subscription"
      testId="new-subscription-sheet"
      onCancel={onCancel}
      onSave={handleSubmit}
      saveLabel={busy ? "Creating…" : "Create subscription"}
      busy={busy}
      error={problem}
    >
      <div className="flex flex-col gap-4">

        <Field>
          <FieldLabel>Who pays</FieldLabel>
          <Combobox
            options={people.map((p) => ({ value: p.id, label: p.display_name ?? p.email }))}
            value={personId}
            onChange={setPersonId}
            placeholder={loadingContext ? "Loading…" : "Find or add a customer…"}
            data-testid="new-subscription-person"
          />
        </Field>

        <div>
          <FieldLabel>What it includes</FieldLabel>
          {!group ? (
            <ProgramGate onChoose={setGroup} testId="new-subscription-group-gate" />
          ) : (
            <div className="flex items-center justify-between mt-1.5 mb-1">
              <span className="text-caption text-mute" data-testid="new-subscription-group-label">
                {group.name}
              </span>
              <button
                type="button"
                className="text-caption text-brand underline"
                onClick={() => { setGroup(null); setLines([{ sourceId: "", quantity: 1, amountMinor: "" }]); }}
                data-testid="new-subscription-group-change"
              >
                Change
              </button>
            </div>
          )}
          <div className="mt-1.5 flex flex-col gap-2" style={group ? undefined : { display: "none" }}>
            {lines.map((l, i) => (
              <div key={i} className="flex items-center gap-2">
                <select
                  className="h-8 flex-1 min-w-0 rounded-lg border border-input bg-transparent px-2.5 text-base md:text-sm"
                  value={l.sourceId}
                  onChange={(e) => {
                    const item = itemOf(e.target.value);
                    setLine(i, {
                      sourceId: e.target.value,
                      amountMinor: String(l.amountMinor).trim() === "" && item?.amountMinor != null
                        ? (item.amountMinor / 100).toFixed(2)
                        : l.amountMinor,
                    });
                  }}
                  data-testid={`new-subscription-line-item-${i}`}
                >
                  <option value="">Choose…</option>
                  {catalogue.filter((c) => c.programId === group.id).map((c) => (
                    <option key={c.id} value={c.id}>{c.name} ({c.sourceType})</option>
                  ))}
                </select>
                <Input
                  className="w-16"
                  type="number"
                  min="1"
                  value={l.quantity}
                  onChange={(e) => setLine(i, { quantity: e.target.value })}
                  data-testid={`new-subscription-line-qty-${i}`}
                />
                <Input
                  className="w-24"
                  type="number"
                  step="0.01"
                  value={l.amountMinor}
                  onChange={(e) => setLine(i, { amountMinor: e.target.value })}
                  placeholder="0.00"
                  data-testid={`new-subscription-line-amount-${i}`}
                />
                <button type="button" className="text-mute hover:text-bad" onClick={() => removeLine(i)} aria-label="Remove line">✕</button>
              </div>
            ))}
            <Button variant="outline" size="sm" onClick={addLine} data-testid="new-subscription-add-line">Add a line</Button>
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-hair pt-3 text-ui font-medium">
          <span>Total, per month</span>
          <span data-testid="new-subscription-total">${(totalMinor / 100).toFixed(2)}</span>
        </div>

        <Field>
          <FieldLabel>Free trial days</FieldLabel>
          <Input type="number" min="0" value={trialDays} onChange={(e) => setTrialDays(e.target.value)} placeholder="0" data-testid="new-subscription-trial-days" />
        </Field>

        <Field>
          <FieldLabel>Payment collection</FieldLabel>
          <NativeSelect value={collectionMethod} onChange={(e) => setCollectionMethod(e.target.value)} data-testid="new-subscription-collection-method">
            <NativeSelectOption value="send_invoice">Email invoice to pay manually</NativeSelectOption>
            <NativeSelectOption value="charge_automatically">Autocharge a payment method on file</NativeSelectOption>
          </NativeSelect>
          <FieldDescription>
            {collectionMethod === "charge_automatically"
              ? "Charges stay off right now, so this creates the subscription without attempting a charge."
              : "An invoice goes out each billing period for them to pay."}
          </FieldDescription>
        </Field>

        <Field>
          <FieldLabel>Description (optional)</FieldLabel>
          <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What this subscription is for" data-testid="new-subscription-description" />
        </Field>
      </div>
    </SideSheet>
  );
}
