// QuickCreateRow — inline create under an empty state: name, price, Save (kit2 .quick). Ported from
// webui/src/lib/components/kit/QuickCreateRow.svelte: same props, testids and copy.
import { useState } from "react";
import { Input } from "@/lib/components/ui/input.jsx";
import { Button } from "@/lib/components/ui/button.jsx";

export default function QuickCreateRow({ placeholderName = "Name it", placeholderPrice = "$0", onSave, testId = "quick-create-row" }) {
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [saving, setSaving] = useState(false);
  const canSave = name.trim().length > 0 && !saving;
  async function save() {
    if (!canSave) return;
    setSaving(true);
    try { await onSave?.({ name: name.trim(), price }); setName(""); setPrice(""); } finally { setSaving(false); }
  }
  return (
    <div className="mt-5 flex items-center justify-center gap-2 border-t border-hair pt-5" data-testid={testId}>
      <Input placeholder={placeholderName} value={name} onChange={(e) => setName(e.target.value)} disabled={saving} data-testid={`${testId}-name`} className="h-(--size-control-field) w-57.5" />
      <Input placeholder={placeholderPrice} value={price} onChange={(e) => setPrice(e.target.value)} disabled={saving} data-testid={`${testId}-price`} className="h-(--size-control-field) w-30" />
      <Button type="button" disabled={!canSave} onClick={save} data-testid={`${testId}-save`}>{saving ? "Saving…" : "Save"}</Button>
    </div>
  );
}
