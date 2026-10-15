// FieldsStep — STEP 4 · PLACE THE FIELDS (QUEUE §23.4.4). Drag and resize on the real pages (react-rnd), coloured per person; dashed suggestions with "Accept all"; undo/redo and shortcuts.
// Desktop-first: on a phone the pages are shown read-only with "edit on desktop".
import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "zustand";
import { Rnd } from "react-rnd";
import { useHotkeys } from "react-hotkeys-hook";
import { Button } from "@/lib/components/ui/button.jsx";
import { Input } from "@/lib/components/ui/input.jsx";
import { Switch } from "@/lib/components/ui/switch.jsx";
import { NativeSelect, NativeSelectOption } from "@/lib/components/ui/native-select.jsx";
import { PdfPage, usePdf } from "./pdfView.jsx";
import { FIELD_DEFAULTS, makeEditorStore, seatColour, snap } from "./editorStore.js";

const TYPES = [["signature", "Signature"], ["initials", "Initials"], ["date_signed", "Date signed"], ["text", "Text"], ["checkbox", "Checkbox"], ["dropdown", "Dropdown"], ["multiselect", "Multi-select"], ["image", "Picture"], ["stamp", "Stamp"], ["file", "File upload"], ["payment", "Payment"]];
const useIsPhone = () => { const [p, setP] = useState(typeof window !== "undefined" && window.innerWidth < 768); useEffect(() => { const f = () => setP(window.innerWidth < 768); window.addEventListener("resize", f); return () => window.removeEventListener("resize", f); }, []); return p; };

export default function FieldsStep({ doc, loadFile, onChange }) {
  const body = doc.body;
  const store = useMemo(() => makeEditorStore({ fields: body.fields, roles: body.roles, suggestions: body.suggestions ?? [] }), [doc.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const { fields, suggestions, selected, seat } = useStore(store, (s) => s);
  const { undo, redo } = store.temporal.getState();
  const phone = useIsPhone();
  const [width, setWidth] = useState(720);
  const [tool, setTool] = useState(null);                 // the field type armed for the next click on a page
  const holder = useRef(null);
  const { pdf, error } = usePdf(loadFile, body.file.file_id);
  const seats = doc.parties.length ? doc.parties.map((p) => ({ key: p.role, label: p.name })) : body.roles;

  useEffect(() => { const el = holder.current; if (!el) return undefined; const f = () => setWidth(Math.max(280, Math.min(900, el.clientWidth - 24))); f(); const ro = new ResizeObserver(f); ro.observe(el); return () => ro.disconnect(); }, []);
  // every change is reported up (the screen autosaves): the body keeps the file, the seats and the fields
  useEffect(() => { onChange({ ...body, roles: store.getState().roles, fields, suggestions }); }, [fields, suggestions]); // eslint-disable-line react-hooks/exhaustive-deps

  const sel = fields.find((f) => f.id === selected);
  useHotkeys("mod+z", (e) => { e.preventDefault(); undo(); }, { enableOnFormTags: false });
  useHotkeys("mod+shift+z,mod+y", (e) => { e.preventDefault(); redo(); }, { enableOnFormTags: false });
  useHotkeys("delete,backspace", () => { if (selected) store.getState().remove(selected); }, { enableOnFormTags: false });
  useHotkeys("mod+d", (e) => { e.preventDefault(); if (selected) store.getState().duplicate(selected); }, { enableOnFormTags: false });
  useHotkeys("up", (e) => { if (selected) { e.preventDefault(); store.getState().nudge(selected, 0, -0.002); } });
  useHotkeys("down", (e) => { if (selected) { e.preventDefault(); store.getState().nudge(selected, 0, 0.002); } });
  useHotkeys("left", (e) => { if (selected) { e.preventDefault(); store.getState().nudge(selected, -0.002, 0); } });
  useHotkeys("right", (e) => { if (selected) { e.preventDefault(); store.getState().nudge(selected, 0.002, 0); } });
  useHotkeys("escape", () => { setTool(null); store.getState().select(null); });

  if (error) return <p className="text-bad" role="alert" data-testid="fields-error">The pages could not be shown ({error.message}). Reload to try again.</p>;
  const pagesOf = body.file.page_count;

  const placeAt = (e, pageNo, h) => {
    if (!tool || phone) { store.getState().select(null); return; }
    const r = e.currentTarget.getBoundingClientRect();
    const d = FIELD_DEFAULTS[tool];
    store.getState().add(tool, pageNo, snap((e.clientX - r.left) / r.width - d.w / 2, e.altKey), snap((e.clientY - r.top) / h - d.h / 2, e.altKey));
    setTool(null);
  };

  return (
    <div className="grid gap-4 md:grid-cols-[200px_minmax(0,1fr)_260px]" data-testid="fields-step">
      <aside className="space-y-3" aria-label="Field tools">
        {phone ? <p className="m-0 rounded-card border border-line bg-surface-sunken p-3 text-meta text-mute" data-testid="fields-phone-note">Placing fields needs a bigger screen — edit on desktop. You can still look at the pages below.</p> : (
          <>
            <div><p className="m-0 mb-1 text-caption text-mute">Who is this for?</p>
              <NativeSelect value={seat} onChange={(e) => store.getState().setSeat(e.currentTarget.value)} aria-label="Fields are for" data-testid="fields-seat">
                {seats.map((s) => <NativeSelectOption key={s.key} value={s.key}>{s.label}</NativeSelectOption>)}
              </NativeSelect>
              <span className="mt-1 inline-block h-1.5 w-full rounded" style={{ background: seatColour(seat) }} />
            </div>
            <div className="grid grid-cols-2 gap-1.5 md:grid-cols-1" data-testid="fields-tools">
              {TYPES.map(([t, l]) => <Button key={t} type="button" size="sm" variant={tool === t ? "default" : "outline"} onClick={() => setTool(tool === t ? null : t)} data-testid={`tool-${t}`}>{l}</Button>)}
            </div>
            <p className="m-0 text-caption text-mute">{tool ? "Click a page to place it. Esc to cancel." : "Pick a field, then click where it goes. Drag to move; drag a corner to resize."}</p>
            <div className="flex gap-1.5"><Button type="button" size="sm" variant="ghost" onClick={() => undo()} data-testid="fields-undo">Undo</Button><Button type="button" size="sm" variant="ghost" onClick={() => redo()} data-testid="fields-redo">Redo</Button></div>
            {suggestions.length > 0 && <Button type="button" size="sm" variant="outline" onClick={() => store.getState().acceptAll()} data-testid="fields-accept-all">Accept all {suggestions.length} suggestions</Button>}
          </>
        )}
      </aside>

      <div ref={holder} className="min-w-0 space-y-4 overflow-auto rounded-card border border-line bg-surface-sunken p-3" style={{ maxHeight: "calc(100vh - 220px)" }} data-testid="fields-pages">
        {!pdf ? <p className="m-0 p-8 text-center text-mute">Loading pages…</p> : Array.from({ length: pagesOf }, (_, i) => i + 1).map((n) => {
          const h = Math.round(width * (body.file.pages[n - 1].h / body.file.pages[n - 1].w));
          return (
            <div key={n}><p className="m-0 mb-1 text-caption text-mute">Page {n} of {pagesOf}</p>
              <PdfPage pdf={pdf} pageNumber={n} width={width}>
                <div className="absolute inset-0" style={{ cursor: tool && !phone ? "crosshair" : "default" }} onClick={(e) => placeAt(e, n, h)} data-testid={`page-surface-${n}`}>
                  {suggestions.filter((s) => s.page === n).map((s) => (
                    <button key={s.id} type="button" className="absolute border-2 border-dashed border-warn bg-warn/10 text-left text-caption text-ink"
                      style={{ left: `${s.x * 100}%`, top: `${s.y * 100}%`, width: `${s.w * 100}%`, height: `${s.h * 100}%` }} title={s.why ?? "Suggested"} onClick={(e) => { e.stopPropagation(); if (!phone) store.getState().acceptSuggestion(s.id); }} data-testid="suggestion">
                      <span className="px-0.5">+ {s.type.replace("_", " ")}</span>
                    </button>
                  ))}
                  {fields.filter((f) => f.page === n).map((f) => {
                    const c = seatColour(f.role);
                    const box = { x: f.x * width, y: f.y * h, width: f.w * width, height: f.h * h };
                    const inner = <div className="flex h-full w-full items-center justify-between overflow-hidden px-1 text-caption" style={{ background: `${c}22`, border: `1.5px solid ${c}`, outline: selected === f.id ? `2px solid ${c}` : "none", color: c }}><span className="truncate">{f.label || f.type}{f.required ? " *" : ""}</span></div>;
                    return phone ? <div key={f.id} className="absolute" style={{ left: box.x, top: box.y, width: box.width, height: box.height }}>{inner}</div> : (
                      <Rnd key={f.id} bounds="parent" size={{ width: box.width, height: box.height }} position={{ x: box.x, y: box.y }} data-testid="placed-field" data-field-id={f.id} data-type={f.type}
                        onMouseDown={(e) => { e.stopPropagation(); store.getState().select(f.id); }} onClick={(e) => e.stopPropagation()}
                        onDragStop={(_, d) => store.getState().update(f.id, { x: snap(d.x / width), y: snap(d.y / h) })}
                        onResizeStop={(_, __, ref, ___, pos) => store.getState().update(f.id, { x: snap(pos.x / width), y: snap(pos.y / h), w: snap(ref.offsetWidth / width), h: snap(ref.offsetHeight / h) })}>
                        {inner}
                      </Rnd>
                    );
                  })}
                </div>
              </PdfPage>
            </div>
          );
        })}
      </div>

      <aside className="space-y-3" aria-label="Field settings" data-testid="fields-inspector">
        {!sel ? <p className="m-0 text-meta text-mute">{fields.length ? `${fields.length} field${fields.length === 1 ? "" : "s"} placed. Select one to change it.` : "No fields yet. Pick a tool on the left, or accept the suggestions."}</p> : (
          <>
            <div><p className="m-0 mb-1 text-caption text-mute">Label</p><Input value={sel.label ?? ""} onChange={(e) => store.getState().update(sel.id, { label: e.currentTarget.value })} aria-label="Field label" data-testid="field-label" /></div>
            <div><p className="m-0 mb-1 text-caption text-mute">Belongs to</p>
              <NativeSelect value={sel.role} onChange={(e) => store.getState().update(sel.id, { role: e.currentTarget.value })} aria-label="Field belongs to">{seats.map((s) => <NativeSelectOption key={s.key} value={s.key}>{s.label}</NativeSelectOption>)}</NativeSelect></div>
            <label className="flex items-center justify-between text-ui">Required <Switch checked={sel.type === "payment" ? true : sel.required} disabled={sel.type === "payment"} onCheckedChange={(v) => store.getState().update(sel.id, { required: v })} aria-label="Required" data-testid="field-required" /></label>
            {["text"].includes(sel.type) && <>
              <div><p className="m-0 mb-1 text-caption text-mute">Format</p>
                <NativeSelect value={sel.validation ?? "none"} onChange={(e) => store.getState().update(sel.id, { validation: e.currentTarget.value })} aria-label="Format">{["none", "email", "phone", "number", "date", "zip"].map((v) => <NativeSelectOption key={v} value={v}>{v}</NativeSelectOption>)}</NativeSelect></div>
              <div><p className="m-0 mb-1 text-caption text-mute">Prefill (merge field, optional)</p><Input value={sel.default ?? ""} placeholder="{{signer.name}}" onChange={(e) => store.getState().update(sel.id, { default: e.currentTarget.value || undefined })} aria-label="Prefill" /></div></>}
            {(sel.type === "dropdown" || sel.type === "multiselect") && <div><p className="m-0 mb-1 text-caption text-mute">Choices (one per line)</p><textarea className="w-full rounded border border-line bg-surface p-2 text-ui" rows={4} value={(sel.options ?? []).join("\n")} onChange={(e) => store.getState().update(sel.id, { options: e.currentTarget.value.split("\n").map((x) => x.trim()).filter(Boolean) })} aria-label="Choices" /></div>}
            {sel.type === "payment" && (
              <div className="space-y-2" data-testid="payment-settings">
                <p className="m-0 text-caption text-mute">The signer pays by card before their signature completes. Needs Stripe connected.</p>
                <NativeSelect value={sel.amount_from ? "from" : "fixed"} onChange={(e) => store.getState().update(sel.id, e.currentTarget.value === "from" ? { amount_minor: undefined, amount_from: "custom.deposit" } : { amount_from: undefined, amount_minor: 5000 })} aria-label="Where the amount comes from" data-testid="payment-source">
                  <NativeSelectOption value="fixed">A fixed amount</NativeSelectOption><NativeSelectOption value="from">From a custom value on the document</NativeSelectOption></NativeSelect>
                {sel.amount_from
                  ? <div><p className="m-0 mb-1 text-caption text-mute">Custom value name (a plain number such as 150.00 — no formulas)</p><Input value={String(sel.amount_from).replace(/^custom\./, "")} onChange={(e) => store.getState().update(sel.id, { amount_from: `custom.${e.currentTarget.value.toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 40) || "deposit"}` })} aria-label="Custom value name" data-testid="payment-from" /></div>
                  : <div><p className="m-0 mb-1 text-caption text-mute">Amount</p><Input type="number" min="0.5" step="0.01" value={((sel.amount_minor ?? 0) / 100).toString()} onChange={(e) => { const n = Math.round(Number(e.currentTarget.value) * 100); if (Number.isFinite(n)) store.getState().update(sel.id, { amount_minor: Math.max(50, Math.min(99999999, n)) }); }} aria-label="Amount to pay" data-testid="payment-amount" /></div>}
                <div><p className="m-0 mb-1 text-caption text-mute">Currency</p><Input value={sel.currency ?? "usd"} maxLength={3} onChange={(e) => store.getState().update(sel.id, { currency: e.currentTarget.value.toLowerCase().replace(/[^a-z]/g, "").slice(0, 3) || undefined })} aria-label="Currency" data-testid="payment-currency" /></div>
              </div>)}
            {["initials", "signature", "date_signed"].includes(sel.type) && <label className="flex items-center justify-between text-ui">Repeat on every page <Switch checked={sel.repeat === "every_page"} onCheckedChange={(v) => store.getState().update(sel.id, { repeat: v ? "every_page" : undefined })} aria-label="Repeat on every page" data-testid="field-repeat" /></label>}
            <div className="flex gap-1.5"><Button type="button" size="sm" variant="outline" onClick={() => store.getState().duplicate(sel.id)}>Duplicate</Button><Button type="button" size="sm" variant="outline" onClick={() => store.getState().remove(sel.id)} data-testid="field-delete">Delete</Button></div>
            <div><p className="m-0 mb-1 text-caption text-mute">Copy to page</p><NativeSelect value="" onChange={(e) => { if (e.currentTarget.value) store.getState().duplicate(sel.id, Number(e.currentTarget.value)); }} aria-label="Copy to page"><NativeSelectOption value="">Choose…</NativeSelectOption>{Array.from({ length: pagesOf }, (_, i) => i + 1).filter((p) => p !== sel.page).map((p) => <NativeSelectOption key={p} value={p}>Page {p}</NativeSelectOption>)}</NativeSelect></div>
          </>
        )}
      </aside>
    </div>
  );
}
