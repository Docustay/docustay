// ═══════════════════════════════════════════════════════════════════════════════════════════════
// AddLineRow — pick a service/package/plan from the catalogue for a new invoice line. Mirrors
// DiscountRow.jsx's inline expand-to-add-a-row pattern (same file, same toggle convention).
// ★ the maintainer, 29 Sep 2026 — F: InvoiceEditor.jsx's own "+ Add something" called onNavigate to
//   /money/invoices/{id}/add-line, a route that has never existed (grepped routes.js — no match).
//   For a brand-new, unsaved invoice (id "new") this closed the whole editor via the surface's
//   onNavigate handler; for a saved invoice it would have 404'd. LineItemTable never had a real way
//   to add a line at all — this is that missing picker, built inline rather than a navigation.
// ★ Part 3 invoice rebuild (the maintainer's brief: "search catalogue or add one-off") — ONE-OFF LINES NOW
//   WORK. The comment this replaced was correct when written: `createLineItem`'s own
//   `LINE_ITEM_SOURCES` allow-list had no entry for "no catalogue reference at all" (F862,
//   FINDINGS-OPEN.md) — now fixed with a real `"custom"` sourceType that sets no catalogue FK.
//   A line with no catalogue pick but a typed name/amount/quantity is a valid one-off; `ready`
//   below accepts either shape.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useEffect, useState } from "react";
import { request } from "@/lib/api.js";
import { Input } from "@/lib/components/ui/input.jsx";
import { Button } from "@/lib/components/ui/button.jsx";
import Combobox from "@/lib/components/kit/Combobox.jsx";
import ProgramGate from "@/lib/components/ProgramGate.jsx";

export default function AddLineRow({ onAdd = null, onCancel = null, testId = "add-line-row" }) {
  // ★ the maintainer, 29 Sep 2026 (life coaching brief) — asks Life/Recovery before showing the catalogue.
  const [group, setGroup] = useState(null);
  const [catalogue, setCatalogue] = useState([]);
  const [sourceId, setSourceId] = useState("");
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [quantity, setQuantity] = useState("1");

  useEffect(() => {
    let live = true;
    const toItem = (sourceType) => (r) => ({
      id: r.id, name: r.name, amountMinor: r.price_amount_minor ?? null, sourceType,
      programId: r.program_id ?? null,
    });
    Promise.all([
      request("/api/list/items/services").then((r) => (r?.rows ?? []).map(toItem("service"))).catch(() => []),
      request("/api/list/items/packages").then((r) => (r?.rows ?? []).map(toItem("package"))).catch(() => []),
      request("/api/list/items/plans").then((r) => (r?.rows ?? []).map(toItem("plan"))).catch(() => []),
    ]).then(([services, packages, plans]) => {
      if (live) setCatalogue([...services, ...packages, ...plans]);
    });
    return () => { live = false; };
  }, []);

  if (!group) {
    return (
      <div className="border border-line rounded-lg p-3.5 bg-surface my-3" data-testid={testId}>
        <ProgramGate onChoose={setGroup} testId={`${testId}-group-gate`} />
        <div className="flex justify-end mt-2">
          <Button variant="ghost" onClick={onCancel} data-testid={`${testId}-cancel-btn`}>Cancel</Button>
        </div>
      </div>
    );
  }

  const options = catalogue
    .filter((c) => c.programId === group.id)
    .map((c) => ({ value: c.id, label: c.name }));

  function handlePick(value) {
    setSourceId(value);
    const item = catalogue.find((c) => c.id === value);
    setName(item?.name ?? "");
    setAmount(item?.amountMinor != null ? (item.amountMinor / 100).toFixed(2) : "");
  }

  function toMinor(text) {
    const n = Number(String(text).trim().replace(/[^0-9.]/g, ""));
    return Number.isFinite(n) ? Math.round(n * 100) : null;
  }

  const unitAmountMinor = toMinor(amount);
  const qty = Number(quantity) || 1;
  const ready = name.trim().length > 0 && unitAmountMinor !== null && unitAmountMinor >= 0 && qty > 0;

  function handleAdd() {
    if (!ready) return;
    const item = catalogue.find((c) => c.id === sourceId);
    onAdd?.({
      sourceType: item?.sourceType ?? "custom",
      sourceId: item?.id ?? null,
      name: name.trim(),
      unitAmountMinor,
      quantity: qty,
    });
    setSourceId("");
    setName("");
    setAmount("");
    setQuantity("1");
  }

  return (
    <div className="border border-line rounded-lg p-3.5 bg-surface my-3" data-testid={testId}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-caption text-mute" data-testid={`${testId}-group-label`}>
          {group.name}
        </span>
        <button
          type="button"
          className="text-caption text-brand underline"
          onClick={() => { setGroup(null); setSourceId(""); setName(""); setAmount(""); }}
          data-testid={`${testId}-group-change`}
        >
          Change
        </button>
      </div>
      <div className="mb-3" data-testid={`${testId}-catalogue`}>
        <Combobox
          options={options}
          value={sourceId}
          onValueChange={handlePick}
          placeholder="Search the catalogue, or skip this and type a one-off line below…"
          emptyText="Nothing in the catalogue yet — type a one-off line below."
          testId={`${testId}-catalogue-combobox`}
        />
      </div>
      <div className="flex gap-3 mb-3" data-testid={`${testId}-fields`}>
        <div className="flex-1">
          <Input
            placeholder="Line name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            data-testid={`${testId}-name-input`}
          />
        </div>
        <div className="w-24 relative flex items-center">
          <span className="absolute left-3 text-sm text-mute font-medium pointer-events-none">$</span>
          <Input
            type="number" placeholder="0.00" value={amount} min="0" step="0.01"
            onChange={(e) => setAmount(e.target.value)} className="pl-6"
            data-testid={`${testId}-amount-input`}
          />
        </div>
        <div className="w-20">
          <Input
            type="number" placeholder="Qty" value={quantity} min="1" step="1"
            onChange={(e) => setQuantity(e.target.value)}
            data-testid={`${testId}-quantity-input`}
          />
        </div>
      </div>
      <div className="flex gap-2 justify-end" data-testid={`${testId}-actions`}>
        <Button variant="ghost" onClick={onCancel} data-testid={`${testId}-cancel-btn`}>Cancel</Button>
        <Button onClick={handleAdd} disabled={!ready} data-testid={`${testId}-add-btn`}>Add line</Button>
      </div>
    </div>
  );
}
