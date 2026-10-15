// ═══════════════════════════════════════════════════════════════════════════════════════════════
// TaxIdSheet — "Add a tax ID" (P3.U10 · W3). New component, no Svelte source: ported from
// specs/mockups/PersonTaxId.frame.html's right-hand sheet (structure, order, labels, every text run)
// and the frame's generated wiring block (§3.3/§3.4). Opens from the person's Money tab.
//   · "Tax ID" — Type: a searchable Combobox of Stripe's tax id types; Number: the id itself.
//   · "On invoices" — Shown / Checked: what happens next, read-only copy (not fields to edit).
// Add is Stripe-first (WIRING-MAP §3.3): a Stripe refusal rolls the whole thing back and this surface
// stays open, showing Stripe's own reason and reference (write.error) verbatim — never a re-worded one.
// ★ `useWrite` decides the permission, not this component: hidden (no `person.edit`) renders NOTHING,
//   the same as WriteButton — a control asking a permission it doesn't have IS the defect (CLAUDE.md).
// ★ A missing prerequisite (Stripe not connected, or the form itself incomplete) is `write.blocked`:
//   WriteButton renders DisabledWithReason with the reason, never a hidden control.
// ★ THE TYPE LIST: Stripe's published customer tax-id types (the server's own list, transcribed at
//   src/money/taxIds.mjs `TAX_ID_TYPES` — webreact cannot import src/, and no read route serves this
//   catalogue back to the client, so it is duplicated here as a constant; see BUILD report).
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useEffect, useState } from "react";
import SideSheet from "@/lib/forms/SideSheet.jsx";
import Combobox from "@/lib/components/kit/Combobox.jsx";
import SheetRow from "@/lib/components/kit/SheetRow.jsx";
import { Input } from "@/lib/components/ui/input.jsx";
import WriteButton from "@/lib/permissions/WriteButton.jsx";
import { useWrite } from "@/lib/permissions/useWrite.js";
import { Button } from "@/lib/components/ui/button.jsx";

// Transcribed verbatim from src/money/taxIds.mjs `TAX_ID_TYPES` (Stripe's published list) — the
// enforcement itself lives server-side; this is display-only, so a value can never reach the write
// unless the server's own list also accepts it.
const TAX_ID_TYPE_OPTIONS = [
  { value: "us_ein", country: "US", label: "EIN" },
  { value: "us_itin", country: "US", label: "ITIN" },
  { value: "eu_vat", country: "EU", label: "VAT" },
  { value: "au_abn", country: "AU", label: "ABN" },
  { value: "au_arn", country: "AU", label: "ARN" },
  { value: "br_cnpj", country: "BR", label: "CNPJ" },
  { value: "br_cpf", country: "BR", label: "CPF" },
  { value: "ca_bn", country: "CA", label: "BN" },
  { value: "ca_gst_hst", country: "CA", label: "GST/HST" },
  { value: "ca_pst_bc", country: "CA", label: "PST (BC)" },
  { value: "ca_pst_mb", country: "CA", label: "PST (MB)" },
  { value: "ca_pst_sk", country: "CA", label: "PST (SK)" },
  { value: "ca_qst", country: "CA", label: "QST" },
  { value: "ch_vat", country: "CH", label: "VAT" },
  { value: "cl_tin", country: "CL", label: "TIN" },
  { value: "cn_tin", country: "CN", label: "TIN" },
  { value: "co_nit", country: "CO", label: "NIT" },
  { value: "de_stn", country: "DE", label: "STN" },
  { value: "eg_tin", country: "EG", label: "TIN" },
  { value: "es_cif", country: "ES", label: "CIF" },
  { value: "gb_vat", country: "GB", label: "VAT" },
  { value: "hk_br", country: "HK", label: "BR" },
  { value: "hu_tin", country: "HU", label: "TIN" },
  { value: "id_npwp", country: "ID", label: "NPWP" },
  { value: "ie_vat", country: "IE", label: "VAT" },
  { value: "il_vat", country: "IL", label: "VAT" },
  { value: "in_gst", country: "IN", label: "GST" },
  { value: "jp_cn", country: "JP", label: "CN" },
  { value: "jp_rn", country: "JP", label: "RN" },
  { value: "jp_trn", country: "JP", label: "TRN" },
  { value: "ke_pin", country: "KE", label: "PIN" },
  { value: "kr_brn", country: "KR", label: "BRN" },
  { value: "li_uid", country: "LI", label: "UID" },
  { value: "mx_rfc", country: "MX", label: "RFC" },
  { value: "my_frp", country: "MY", label: "FRP" },
  { value: "my_itn", country: "MY", label: "ITN" },
  { value: "my_sst", country: "MY", label: "SST" },
  { value: "ng_tin", country: "NG", label: "TIN" },
  { value: "no_vat", country: "NO", label: "VAT" },
  { value: "nz_gst", country: "NZ", label: "GST" },
  { value: "ph_tin", country: "PH", label: "TIN" },
  { value: "ru_inn", country: "RU", label: "INN" },
  { value: "ru_kpp", country: "RU", label: "KPP" },
  { value: "sa_vat", country: "SA", label: "VAT" },
  { value: "sg_gst", country: "SG", label: "GST" },
  { value: "sg_uen", country: "SG", label: "UEN" },
  { value: "si_tin", country: "SI", label: "TIN" },
  { value: "th_vat", country: "TH", label: "VAT" },
  { value: "tr_tin", country: "TR", label: "TIN" },
  { value: "tw_vat", country: "TW", label: "VAT" },
  { value: "ua_vat", country: "UA", label: "VAT" },
  { value: "vn_tin", country: "VN", label: "TIN" },
  { value: "za_vat", country: "ZA", label: "VAT" },
].map((t) => ({ value: t.value, label: `${t.country} ${t.label}` }));

/**
 * @param person { id, firstName, blockedReason? } — the host screen's person record; `blockedReason`
 *   (the frame's own copy: "Add a tax ID once Stripe is connected.") is the missing prerequisite, if
 *   any — a permission (`person.edit`) is decided by `useWrite` itself, never by this prop.
 * @param open, onOpenChange — the surface is only ever shown while `open`; `onOpenChange(false)` on
 *   cancel/close/Escape/after a successful write.
 * @param onAdded — called after the tax id is added, so the host screen can refetch its list.
 */
export default function TaxIdSheet({ person, open, onOpenChange, onAdded }) {
  const [type, setType] = useState(null);
  const [value, setValue] = useState("");

  useEffect(() => {
    if (!open) return;
    setType(null);
    setValue("");
  }, [open, person?.id]);

  const incomplete = !type || !value.trim();
  const write = useWrite("addTaxId", {
    blockedReason: person?.blockedReason ?? (incomplete ? "Choose a type and enter a number." : null),
  });

  if (!open || write.hidden) return null;

  async function handleSave() {
    if (write.blocked) return;
    try {
      await write.run({ subjectType: "person", subjectId: person.id, type, value: value.trim() });
      onAdded?.();
      onOpenChange?.(false);
    } catch {
      // write.error is already set by useWrite — the surface stays open and shows it (below).
    }
  }

  return (
    <SideSheet
      title="Add a tax ID"
      testId="tax-id-sheet"
      busy={write.busy}
      onCancel={() => onOpenChange?.(false)}
      error={write.error ? `${write.error.message}${write.error.requestId ? ` (ref: ${write.error.requestId})` : ""}` : null}
      footer={(
        <footer className="sticky bottom-0 flex shrink-0 justify-end gap-2.5 border-t border-line bg-surface px-5.5 py-4">
          <Button type="button" variant="outline" onClick={() => onOpenChange?.(false)} disabled={write.busy}>Cancel</Button>
          <WriteButton write={write} testId="person-money-add-tax-id" onClick={handleSave} busyLabel="Adding…">Add tax ID</WriteButton>
        </footer>
      )}
    >
      <div className="mb-2 mt-1 text-micro font-semibold tracking-[0.08em] text-mute uppercase">Tax ID</div>
      <SheetRow label="Type" hint="Search 70+ types">
        <Combobox testId="tax-id-sheet-type" value={type} options={TAX_ID_TYPE_OPTIONS} onValueChange={setType} placeholder="Search types…" />
      </SheetRow>
      <SheetRow label="Number">
        <Input data-testid="tax-id-sheet-value" value={value} placeholder="12-3456789" onChange={(e) => setValue(e.target.value)} />
      </SheetRow>

      <div className="mb-2 mt-4 text-micro font-semibold tracking-[0.08em] text-mute uppercase">On invoices</div>
      <SheetRow label="Shown">
        <p className="m-0 text-field text-ink-2">On every invoice to {person?.firstName ?? "them"} from now on</p>
      </SheetRow>
      <SheetRow label="Checked">
        <p className="m-0 text-field text-ink-2">Stripe verifies EU VAT numbers; others are shown as entered</p>
      </SheetRow>
    </SideSheet>
  );
}
