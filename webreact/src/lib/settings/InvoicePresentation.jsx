// ═══════════════════════════════════════════════════════════════════════════════════════════════
// InvoicePresentation — P3.U17 (W10). Built FROM specs/mockups/SetInvoicePresentation.frame.html's
// card (structure, order, labels, every text run): PDF layout, page size, footer, extra fields (≤4),
// and the read-only Reminders line. No Svelte source — behaviour comes from the WIRING-MAP rows for
// `invoice-layout-picker` / `-archive` / `-unarchive` (§3.3/§3.4, quoted in the frame's own generated
// "What every control on this frame does" block) plus CONTRACTS §4/§6.
//
// ★★★ NO PROPS (the task's own signature) — this component owns its own read. `invoiceLayouts()`
//     (GET /api/settings/invoice-layouts) is assumed to answer everything this panel needs in one
//     shot, since no second "read the practice's invoice settings" method is named anywhere in this
//     wave: `{ layouts: [{id, name, archived}], selectedLayoutId, templates, unavailable }` — where
//     `templates` mirrors src/settings/keys.mjs's `invoices.templates` object (flat string keys, see
//     `extraFieldsFromTemplates`/`templatesFromForm` below for the exact shape this file reads and
//     writes). If the real route answers a narrower shape, that is a wiring gap for the route's own
//     task, not a reason to invent a second endpoint here.
// ★★★ PDF layout / page size / footer / extra fields are ONE save (CONTRACTS §6 — `invoices.templates`
//     and `invoices.layout_template_id` are named together): choosing a layout is LOCAL STATE, exactly
//     like AdjustCreditSheet's kind/amount/why, until "Save" is pressed — one `setSettings` batch,
//     never one write per field.
// ★ Hiding/showing a PDF layout (archive/unarchive) is its OWN immediate write, separate from Save —
//   the wiring-doc's own two rows for `invoice-layout-archive`/`-unarchive` name their own routes.
// ★★ A missing PREREQUISITE (Stripe unreachable — the wiring-doc's own GET failure clause) renders
//    Save DISABLED WITH THE REASON via `blockedReason` on the `setSettings` write, never hidden; a
//    denied PERMISSION renders every write control (picker, page size, footer, extra fields, Save,
//    archive, unarchive) as NOTHING, replaced by read-only Figures — the positive control this task's
//    denied story checks for.
// ★ Reminders is drawn from the frame (structure/label/text run) but is NOT one of this task's Calls —
//   no write route is named for it here — so it renders as a plain read-only line, owned elsewhere.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useState } from "react";
import SheetRow from "@/lib/components/kit/SheetRow.jsx";
import Figure from "@/lib/components/kit/Figure.jsx";
import Combobox from "@/lib/components/kit/Combobox.jsx";
import { Input } from "@/lib/components/ui/input.jsx";
import { Button } from "@/lib/components/ui/button.jsx";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem,
} from "@/lib/components/ui/dropdown-menu.jsx";
import WriteButton from "@/lib/permissions/WriteButton.jsx";
import { useWrite } from "@/lib/permissions/useWrite.js";
import ErrorPanel from "@/lib/empty/ErrorPanel.jsx";
import { api } from "@/lib/api.js";

const MAX_EXTRA_FIELDS = 4;
const DEFAULT_LAYOUT_VALUE = "__default__";
const PAGE_SIZES = [
  { value: "letter", label: "US Letter" },
  { value: "a4", label: "A4" },
];
const STRIPE_UNAVAILABLE_REASON = "Couldn't load your layouts from Stripe — try again";
const STANDING_NOTE = "New PDF layouts are designed in Stripe; the ones you have appear here to pick from.";
const REMINDERS_TEXT = "3 days before · on the day · 7 days after";

function emptyExtraField() { return { label: "", value: "" }; }

/** `invoices.templates` (src/settings/keys.mjs) is flat string keys/string|null values — nested
 *  arrays fail its own validator — so the ≤4 extra fields live as `extra_field_N_label`/`_value`. */
function extraFieldsFromTemplates(templates) {
  const fields = [];
  for (let n = 1; n <= MAX_EXTRA_FIELDS; n += 1) {
    const label = templates?.[`extra_field_${n}_label`] ?? null;
    const value = templates?.[`extra_field_${n}_value`] ?? null;
    if (label || value) fields.push({ label: label ?? "", value: value ?? "" });
  }
  return fields;
}

function templatesFromForm({ footer, pageSize, extraFields }) {
  const templates = { footer: footer.trim() ? footer.trim() : null, page_size: pageSize || null };
  extraFields.slice(0, MAX_EXTRA_FIELDS).forEach((field, index) => {
    const n = index + 1;
    templates[`extra_field_${n}_label`] = field.label.trim() ? field.label.trim() : null;
    templates[`extra_field_${n}_value`] = field.value.trim() ? field.value.trim() : null;
  });
  return templates;
}

export default function InvoicePresentation() {
  const [state, setState] = useState({ loading: true, error: null, layouts: [], unavailable: false });
  const [layoutId, setLayoutId] = useState(DEFAULT_LAYOUT_VALUE);
  const [footer, setFooter] = useState("");
  const [pageSize, setPageSize] = useState("letter");
  const [extraFields, setExtraFields] = useState([]);

  const write = useWrite("setSettings", { blockedReason: state.unavailable ? STRIPE_UNAVAILABLE_REASON : null });
  const archiveWrite = useWrite("archiveInvoiceLayout");
  const unarchiveWrite = useWrite("unarchiveInvoiceLayout");

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const response = await api.invoiceLayouts();
      const layouts = response?.layouts ?? [];
      const templates = response?.templates ?? {};
      setState({ loading: false, error: null, layouts, unavailable: Boolean(response?.unavailable) });
      setLayoutId(response?.selectedLayoutId ?? DEFAULT_LAYOUT_VALUE);
      setFooter(templates.footer ?? "");
      setPageSize(templates.page_size ?? "letter");
      setExtraFields(extraFieldsFromTemplates(templates));
    } catch (error) {
      setState({ loading: false, error, layouts: [], unavailable: false });
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const activeLayouts = state.layouts.filter((l) => !l.archived);
  const archivedLayouts = state.layouts.filter((l) => l.archived);
  const layoutOptions = [
    { value: DEFAULT_LAYOUT_VALUE, label: "Default" },
    ...activeLayouts.map((l) => ({ value: l.id, label: l.name })),
  ];
  const selectedLayoutLabel = layoutOptions.find((o) => o.value === layoutId)?.label ?? "Default";
  const selectedPageSizeLabel = PAGE_SIZES.find((p) => p.value === pageSize)?.label ?? "US Letter";

  function addExtraField() {
    if (extraFields.length >= MAX_EXTRA_FIELDS) return;
    setExtraFields((fields) => [...fields, emptyExtraField()]);
  }
  function removeExtraField(index) {
    setExtraFields((fields) => fields.filter((_, i) => i !== index));
  }
  function updateExtraField(index, key, value) {
    setExtraFields((fields) => fields.map((f, i) => (i === index ? { ...f, [key]: value } : f)));
  }

  async function handleSave() {
    if (write.blocked) return;
    const templates = templatesFromForm({ footer, pageSize, extraFields });
    const layoutValue = layoutId === DEFAULT_LAYOUT_VALUE ? null : layoutId;
    try {
      await write.run({
        changes: [
          { key: "invoices.layout_template_id", value: layoutValue },
          { key: "invoices.templates", value: templates },
        ],
      });
    } catch {
      // write.error renders inline below — the panel stays as is (AdjustCreditSheet convention).
    }
  }

  async function handleArchive(templateId) {
    try {
      await archiveWrite.run({ templateId });
      await load();
    } catch {
      // archiveWrite.error renders inline below — the list stays as is.
    }
  }
  async function handleUnarchive(templateId) {
    try {
      await unarchiveWrite.run({ templateId });
      await load();
    } catch {
      // unarchiveWrite.error renders inline below — the list stays as is.
    }
  }

  if (state.loading) {
    return (
      <div className="flex flex-col gap-3 rounded-card border border-line bg-surface p-5" aria-busy="true" data-testid="invoice-presentation-loading">
        <span className="block h-6 w-1/2 rounded-sm bg-mute-bg" />
        <span className="block h-6 w-3/4 rounded-sm bg-mute-bg" />
        <span className="block h-6 w-2/3 rounded-sm bg-mute-bg" />
      </div>
    );
  }

  if (state.error) {
    return <ErrorPanel error={state.error} subject="Invoice presentation" testId="invoice-presentation-error" onRetry={load} />;
  }

  return (
    <div className="rounded-card border border-line bg-surface px-5" data-testid="invoice-presentation">
      <SheetRow label="PDF layout" testId="invoice-presentation-layout-row">
        {write.hidden ? (
          <Figure size="sm" testId="invoice-layout-figure">{selectedLayoutLabel}</Figure>
        ) : (
          <Combobox testId="invoice-layout-picker" options={layoutOptions} value={layoutId}
                    onValueChange={setLayoutId} placeholder="Choose a layout…" />
        )}
      </SheetRow>

      {state.unavailable && (
        <p className="mt-1 text-meta text-mute" data-testid="invoice-layout-unavailable" role="status">
          {STRIPE_UNAVAILABLE_REASON}
        </p>
      )}

      {(activeLayouts.length > 0 || archivedLayouts.length > 0) && !write.hidden && (
        <ul className="m-0 mt-1 mb-2 flex list-none flex-col gap-1.5 p-0" data-testid="invoice-layout-list">
          {activeLayouts.map((layout) => (
            <li key={layout.id} className="flex items-center gap-2 text-ui text-ink">
              <span>{layout.name}</span>
              <WriteButton write={archiveWrite} variant="ghost" size="sm" testId="invoice-layout-archive"
                           onClick={() => handleArchive(layout.id)}>
                Hide
              </WriteButton>
            </li>
          ))}
          {archivedLayouts.map((layout) => (
            <li key={layout.id} className="flex items-center gap-2 text-ui text-mute">
              <span>{layout.name} — hidden</span>
              <WriteButton write={unarchiveWrite} variant="ghost" size="sm" testId="invoice-layout-unarchive"
                           onClick={() => handleUnarchive(layout.id)}>
                Show again
              </WriteButton>
            </li>
          ))}
        </ul>
      )}
      {archiveWrite.error && <ErrorPanel error={archiveWrite.error} subject="Hiding the layout" testId="invoice-layout-archive-error" />}
      {unarchiveWrite.error && <ErrorPanel error={unarchiveWrite.error} subject="Showing the layout" testId="invoice-layout-unarchive-error" />}

      <SheetRow label="Page size" testId="invoice-presentation-page-size-row">
        {write.hidden ? (
          <Figure size="sm" testId="invoice-page-size-figure">{selectedPageSizeLabel}</Figure>
        ) : (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" data-testid="invoice-page-size"
                      className="flex h-(--size-control-field) w-full items-center justify-between rounded-control border border-line bg-surface px-3 text-field text-ink">
                <span>{selectedPageSizeLabel}</span>
                <span aria-hidden="true" className="text-mute">⌄</span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent data-testid="invoice-page-size-menu">
              <DropdownMenuRadioGroup value={pageSize} onValueChange={setPageSize}>
                {PAGE_SIZES.map((p) => (
                  <DropdownMenuRadioItem key={p.value} value={p.value} data-testid={`invoice-page-size-${p.value}`}>
                    {p.label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </SheetRow>

      <SheetRow label="Footer" testId="invoice-presentation-footer-row">
        {write.hidden ? (
          <Figure size="sm" testId="invoice-footer-figure">{footer || "—"}</Figure>
        ) : (
          <Input name="footer" data-testid="invoice-footer" placeholder="Thank you — questions to hello@…"
                 value={footer} onChange={(e) => setFooter(e.target.value)} />
        )}
      </SheetRow>

      <SheetRow label="Extra fields" testId="invoice-presentation-extra-fields-row">
        {write.hidden ? (
          <Figure size="sm" testId="invoice-extra-fields-figure">
            {extraFields.length === 0 ? "None" : extraFields.map((f) => `${f.label} · ${f.value}`).join("  ")}
          </Figure>
        ) : (
          <div className="flex flex-col gap-2">
            {extraFields.map((field, index) => (
              <div key={index} className="flex items-center gap-2">
                <Input data-testid={`invoice-extra-field-${index}-label`} placeholder="Tax ID"
                       value={field.label} onChange={(e) => updateExtraField(index, "label", e.target.value)} />
                <Input data-testid={`invoice-extra-field-${index}-value`} placeholder="12-3456789"
                       value={field.value} onChange={(e) => updateExtraField(index, "value", e.target.value)} />
                <Button type="button" variant="ghost" size="sm" data-testid={`invoice-extra-field-${index}-remove`}
                        onClick={() => removeExtraField(index)}>
                  Remove
                </Button>
              </div>
            ))}
            <Button type="button" variant="outline" size="sm" data-testid="invoice-extra-field-add"
                    disabled={extraFields.length >= MAX_EXTRA_FIELDS} onClick={addExtraField}>
              Add (up to {MAX_EXTRA_FIELDS})
            </Button>
          </div>
        )}
      </SheetRow>

      <SheetRow label="Reminders" testId="invoice-presentation-reminders-row">
        <Figure size="sm" testId="invoice-reminders-figure">{REMINDERS_TEXT}</Figure>
      </SheetRow>

      <p className="mt-2 mb-3 text-meta text-mute" data-testid="invoice-presentation-note">{STANDING_NOTE}</p>

      {write.error && (
        <ErrorPanel error={write.error} subject="Saving invoice presentation" testId="invoice-presentation-save-error" />
      )}

      {!write.hidden && (
        <div className="flex justify-end pb-4">
          <WriteButton write={write} testId="invoice-presentation-save" busyLabel="Saving…" onClick={handleSave}>
            Save
          </WriteButton>
        </div>
      )}
    </div>
  );
}
