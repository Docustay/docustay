// PeopleStep — STEP 3 · WHO SIGNS (QUEUE §23.4.3). People by name and email or picked from contacts (the people port), "just me" (sign on this device), the order (all at once / one after another), copies for people who only receive the result.
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api.js";
import { Button } from "@/lib/components/ui/button.jsx";
import { Input } from "@/lib/components/ui/input.jsx";
import { NativeSelect, NativeSelectOption } from "@/lib/components/ui/native-select.jsx";
import { seatColour } from "./editorStore.js";

const ROLE_TEXT = { signer: "Signs", approver: "Approves", viewer: "Views only", assistant: "Fills in details", cc: "Gets a copy" };
const ROLE_HELP = { signer: "Must sign.", approver: "Must approve or reject before the next step. Does not sign.", viewer: "Confirms they looked at it. Blocks nobody.", assistant: "Fills in typed details for one signer before they sign (needs signing in order). Blocks nobody.", cc: "Only receives the finished copy." };
const dayEnd = (d) => (d ? new Date(`${d}T23:59:00`).toISOString() : null);
const dayOf = (iso) => (iso ? String(iso).slice(0, 10) : "");
const nextSeat = (people) => { for (let i = 1; i < 999; i += 1) if (!people.some((p) => p.role === `signer_${i}`)) return `signer_${i}`; return "signer_999"; };

export default function PeopleStep({ doc, onChange }) {
  const people = doc.parties;
  const order = doc.sendOptions.order ?? "parallel";
  const [q, setQ] = useState("");
  const [found, setFound] = useState([]);
  const [draft, setDraft] = useState({ name: "", email: "" });
  const timer = useRef(null);
  useEffect(() => { clearTimeout(timer.current); if (q.trim().length < 2) { setFound([]); return undefined; } timer.current = setTimeout(() => api.pdfRecipients(q).then(setFound).catch(() => setFound([])), 250); return () => clearTimeout(timer.current); }, [q]);

  const push = (p) => onChange({ parties: [...people, p].map(strip), sendOptions: doc.sendOptions });
  const strip = (p) => ({ role: p.role, name: p.name, email: p.email ?? null, phone: p.phone ?? null, action_role: p.action_role ?? "signer", external_ref: p.external_ref ?? null, expires_at: p.expires_at ?? null, reminder_days: p.reminder_days ?? null, assists_role: p.action_role === "assistant" ? p.assists_role ?? null : null, step: p.step ?? null });
  const add = (p) => push({ role: nextSeat(people), action_role: "signer", ...p });
  const patch = (i, c) => onChange({ parties: people.map((p, k) => strip(k === i ? { ...p, ...c } : p)), sendOptions: doc.sendOptions });
  // steps: once anyone has one, everyone must — so give each person their current position first
  const setStep = (i, step) => onChange({ parties: people.map((p, k) => strip({ ...p, step: k === i ? step : (p.step ?? p.position ?? k + 1) })), sendOptions: doc.sendOptions });
  const signers = people.filter((p) => (p.action_role ?? "signer") === "signer");
  const remove = (i) => onChange({ parties: people.filter((_, k) => k !== i).map(strip), sendOptions: doc.sendOptions });
  const move = (i, d) => { const a = [...people]; const [x] = a.splice(i, 1); a.splice(Math.max(0, Math.min(a.length, i + d)), 0, x); onChange({ parties: a.map(strip), sendOptions: doc.sendOptions }); };
  const inPerson = new Set(doc.sendOptions.in_person ?? []);
  const toggleInPerson = (role) => { const s = new Set(inPerson); s.has(role) ? s.delete(role) : s.add(role); onChange({ sendOptions: { ...doc.sendOptions, in_person: [...s] } }); };
  const valid = draft.name.trim() && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.email);

  return (
    <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_320px]" data-testid="people-step">
      <section aria-label="People on this document" className="space-y-3">
        {doc.suggestedSeats.length > 1 && people.length === 0 && <p className="m-0 rounded-card border border-line bg-surface-sunken p-3 text-meta text-ink-2" data-testid="people-suggest">We found {doc.suggestedSeats.length} signature spots in this file, so it probably needs {doc.suggestedSeats.length} signers.</p>}
        {people.length === 0 ? <p className="m-0 text-meta text-mute" data-testid="people-empty">Nobody yet. Add the people who need to sign, or pick someone from your contacts.</p> : (
          <ol className="m-0 list-none space-y-2 p-0" data-testid="people-list">
            {people.map((p, i) => (
              <li key={p.role} className="flex flex-wrap items-center gap-2 rounded-card border border-line bg-surface p-3" data-testid="person-row">
                <span className="inline-block size-3 rounded-full" style={{ background: seatColour(p.role) }} aria-hidden="true" />
                {order === "sequential" && <label className="flex items-center gap-1 text-caption text-mute">Step<input type="number" min={1} max={50} className="h-8 w-14 rounded border border-line bg-surface px-1 text-ui" value={p.step ?? p.position ?? i + 1} onChange={(e) => setStep(i, Math.max(1, Math.min(50, Number(e.currentTarget.value) || 1)))} aria-label={`Step for ${p.name || `person ${i + 1}`} — people with the same step act together`} data-testid="person-step" /></label>}
                <Input className="min-w-[140px] flex-1" value={p.name} onChange={(e) => patch(i, { name: e.currentTarget.value })} aria-label={`Name of person ${i + 1}`} />
                <Input className="min-w-[180px] flex-1" value={p.email ?? ""} placeholder={inPerson.has(p.role) ? "Not needed" : "email"} onChange={(e) => patch(i, { email: e.currentTarget.value })} aria-label={`Email of person ${i + 1}`} />
                <NativeSelect className="w-auto" value={p.action_role} onChange={(e) => patch(i, { action_role: e.currentTarget.value, assists_role: e.currentTarget.value === "assistant" ? (signers.find((s) => s.role !== p.role)?.role ?? null) : null })} aria-label={`What ${p.name || "they"} do`} title={ROLE_HELP[p.action_role]} data-testid="person-role">{Object.entries(ROLE_TEXT).map(([v, l]) => <NativeSelectOption key={v} value={v}>{l}</NativeSelectOption>)}</NativeSelect>
                {p.action_role === "assistant" && <NativeSelect className="w-auto" value={p.assists_role ?? ""} onChange={(e) => patch(i, { assists_role: e.currentTarget.value || null })} aria-label={`Who ${p.name || "they"} help`} data-testid="person-assists"><NativeSelectOption value="">Helps…</NativeSelectOption>{signers.map((s) => <NativeSelectOption key={s.role} value={s.role}>{s.name || s.role}</NativeSelectOption>)}</NativeSelect>}
                <label className="flex items-center gap-1 text-caption text-mute"><input type="checkbox" checked={inPerson.has(p.role)} onChange={() => toggleInPerson(p.role)} /> on this device</label>
                {order === "sequential" && <><Button type="button" size="sm" variant="ghost" onClick={() => move(i, -1)} aria-label="Move up">↑</Button><Button type="button" size="sm" variant="ghost" onClick={() => move(i, 1)} aria-label="Move down">↓</Button></>}
                <Button type="button" size="sm" variant="ghost" onClick={() => remove(i)} aria-label={`Remove ${p.name}`} data-testid="person-remove">Remove</Button>
                {p.action_role !== "cc" && (
                  <details className="w-full text-caption text-mute" data-testid="person-more"><summary className="cursor-pointer">Their own deadline and reminders{p.expires_at || p.reminder_days?.length ? " (set)" : ""}</summary>
                    <div className="mt-2 flex flex-wrap items-center gap-3">
                      <label className="flex items-center gap-1">Deadline <input type="date" className="h-8 rounded border border-line bg-surface px-1 text-ui" value={dayOf(p.expires_at)} onChange={(e) => patch(i, { expires_at: dayEnd(e.currentTarget.value) })} aria-label={`Deadline for ${p.name || `person ${i + 1}`}`} data-testid="person-deadline" /></label>
                      <label className="flex items-center gap-1">Remind after (days) <input className="h-8 w-24 rounded border border-line bg-surface px-1 text-ui" placeholder="e.g. 2, 5" defaultValue={(p.reminder_days ?? []).join(", ")} onBlur={(e) => { const d = e.currentTarget.value.split(/[,\s]+/).map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= 60).slice(0, 3); patch(i, { reminder_days: d.length ? d : null }); }} aria-label={`Reminder days for ${p.name || `person ${i + 1}`}`} data-testid="person-reminders" /></label>
                      <span>Leave empty to use the document's.</span>
                    </div>
                  </details>)}
              </li>
            ))}
          </ol>
        )}
        <div className="flex flex-wrap items-end gap-2 rounded-card border border-dashed border-line p-3" data-testid="person-add">
          <div className="min-w-[140px] flex-1"><p className="m-0 mb-1 text-caption text-mute">Name</p><Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.currentTarget.value })} aria-label="New person's name" data-testid="new-person-name" /></div>
          <div className="min-w-[180px] flex-1"><p className="m-0 mb-1 text-caption text-mute">Email</p><Input value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.currentTarget.value })} aria-label="New person's email" data-testid="new-person-email" /></div>
          <Button type="button" disabled={!valid} onClick={() => { add({ name: draft.name.trim(), email: draft.email.trim() }); setDraft({ name: "", email: "" }); }} data-testid="person-add-button">Add person</Button>
        </div>
      </section>
      <aside className="space-y-4" aria-label="Order and contacts">
        <div><p className="m-0 mb-1 text-ui font-medium text-ink">Order</p>
          <NativeSelect value={order} onChange={(e) => onChange({ sendOptions: { ...doc.sendOptions, order: e.currentTarget.value }, parties: people.map(strip) })} aria-label="Signing order" data-testid="people-order">
            <NativeSelectOption value="parallel">Everyone at once</NativeSelectOption><NativeSelectOption value="sequential">One after another</NativeSelectOption></NativeSelect>
          <p className="m-0 mt-1 text-caption text-mute">{order === "sequential" ? "The next person is emailed when the one before them has signed." : "Everyone is emailed straight away."}</p></div>
        <div><p className="m-0 mb-1 text-ui font-medium text-ink">From your contacts</p>
          <Input value={q} onChange={(e) => setQ(e.currentTarget.value)} placeholder="Search by name or email" aria-label="Search contacts" data-testid="contact-search" />
          <ul className="m-0 mt-2 list-none space-y-1 p-0" data-testid="contact-results">
            {found.map((c) => <li key={c.id}><button type="button" className="w-full rounded px-2 py-1 text-left text-ui hover:bg-paper" onClick={() => { add({ name: c.name, email: c.email, external_ref: c.id }); setQ(""); }}>{c.name} <span className="text-caption text-mute">{c.email}</span></button></li>)}
          </ul></div>
        {people.length === 0 && <Button type="button" variant="outline" size="sm" onClick={() => onChange({ parties: [{ role: "signer_1", name: "Me", email: null, phone: null, action_role: "signer", external_ref: null, expires_at: null, reminder_days: null }], sendOptions: { ...doc.sendOptions, in_person: ["signer_1"] } })} data-testid="people-just-me">Just me — sign now on this device</Button>}
      </aside>
    </div>
  );
}
