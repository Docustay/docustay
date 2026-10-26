// SendStep — STEP 6 · SEND (QUEUE §23.4.6): subject and message (merge fields), expiry, reminders, verification, decline reason, language, now or scheduled, "save as template".
import { useState } from "react";
import { Input } from "@/lib/components/ui/input.jsx";
import { Button } from "@/lib/components/ui/button.jsx";
import { uploadFile } from "@/lib/documents/upload.js";
import { useWrite } from "@/lib/documents/ports.js";
import { Switch } from "@/lib/components/ui/switch.jsx";
import { Textarea } from "@/lib/components/ui/textarea.jsx";
import { NativeSelect, NativeSelectOption } from "@/lib/components/ui/native-select.jsx";

const Row = ({ label, help, children }) => <div className="grid gap-1 border-t border-line py-3 first:border-t-0 md:grid-cols-[minmax(0,1fr)_340px] md:gap-6"><div><p className="m-0 text-ui font-medium text-ink">{label}</p>{help && <p className="m-0 mt-0.5 text-meta text-mute">{help}</p>}</div><div>{children}</div></div>;

export default function SendStep({ doc, onChange, onRefresh }) {
  const unattach = useWrite("POST /api/documents/pdf/attachment/remove");
  const [attachNote, setAttachNote] = useState(null);
  const extras = (doc.files ?? []).filter((f) => f.kind === "attachment" && f.meta?.extra);
  const attach = async (file) => { setAttachNote(`Adding ${file.name}…`); try { await uploadFile(file, { attachTo: doc.id }); setAttachNote(null); await onRefresh?.(); } catch (e) { setAttachNote(e.message || "That file could not be added."); } };
  const o = doc.sendOptions, d = doc.defaults;
  const set = (patch) => onChange({ sendOptions: { ...o, ...patch } });
  const expiry = o.expiry_days === undefined ? d.expiryDays : o.expiry_days;
  const remindersOn = o.reminders?.on !== false;
  const days = (o.reminders?.days ?? d.reminderDays ?? [3, 7]).join(", ");
  const scheduled = Boolean(o.send_at);
  const local = o.send_at ? new Date(o.send_at).toISOString().slice(0, 16) : "";
  return (
    <div className="max-w-[860px] rounded-card border border-line bg-surface px-5 py-2" data-testid="send-step">
      <Row label="Email subject" help="Merge fields work: {{signer.name}}, {{sender.name}}, {{org.name}}, {{document.title}}."><Input value={o.subject ?? ""} placeholder={`${doc.title} — please sign`} onChange={(e) => set({ subject: e.currentTarget.value || undefined })} aria-label="Email subject" data-testid="send-subject" /></Row>
      <Row label="Message" help="The words in the email, above the button."><Textarea rows={4} value={o.message ?? ""} onChange={(e) => set({ message: e.currentTarget.value || undefined })} aria-label="Message" data-testid="send-message" /></Row>
      <Row label="Expires after (days)" help="0 means it never expires. The deadline is fixed when you send."><Input inputMode="numeric" value={expiry ?? 0} onChange={(e) => { const n = Number(e.currentTarget.value.replace(/\D/g, "")); set({ expiry_days: Math.min(365, n) }); }} aria-label="Expires after days" data-testid="send-expiry" className="w-28" /></Row>
      <Row label="Reminders" help="Days after sending to remind people who have not signed."><div className="flex items-center gap-3"><Switch checked={remindersOn} onCheckedChange={(v) => set({ reminders: { on: v, days: o.reminders?.days ?? d.reminderDays ?? [3, 7] } })} aria-label="Reminders on" data-testid="send-reminders" />
        <Input disabled={!remindersOn} value={days} onChange={(e) => { const arr = e.currentTarget.value.split(",").map((x) => Number(x.trim())).filter((n) => Number.isInteger(n) && n > 0 && n <= 60).slice(0, 3); set({ reminders: { on: remindersOn, days: arr.length ? arr : [3] } }); }} aria-label="Reminder days" className="w-32" /></div></Row>
      <Row label="Check who is signing" help="An email code or access code is asked for before the document opens."><NativeSelect value={o.verification ?? "none"} onChange={(e) => set({ verification: e.currentTarget.value })} aria-label="Verification" data-testid="send-verification"><NativeSelectOption value="none">No extra check</NativeSelectOption><NativeSelectOption value="email_code">Email code</NativeSelectOption><NativeSelectOption value="access_code">Access code</NativeSelectOption></NativeSelect></Row>
      {o.verification === "access_code" && <Row label="Access code" help={o.access_code_set ? "A code is set. Type a new one to change it. Tell people the code another way — by phone or message, not in this email." : "At least 4 characters. Tell people the code another way — by phone or message, not in this email."}><Input type="text" autoComplete="off" defaultValue="" placeholder={o.access_code_set ? "(set)" : "Choose a code"} onBlur={(e) => { const v = e.currentTarget.value.trim(); if (v) { set({ access_code: v }); e.currentTarget.value = ""; } }} aria-label="Access code" data-testid="send-access-code" /></Row>}
      <Row label="Extra files" help="Files the people can read alongside the document — a price list, terms. PDF, Word, Excel, PowerPoint or a picture, up to 25 MB each."><div className="space-y-2" data-testid="send-attachments">
        {extras.length > 0 && <ul className="m-0 list-none space-y-1 p-0">{extras.map((f) => <li key={f.id} className="flex items-center gap-2 text-ui"><span className="truncate" data-testid="send-attachment">{f.name}</span><Button type="button" size="sm" variant="ghost" disabled={unattach.busy} onClick={async () => { await unattach.run({ body: { instanceId: doc.id, fileId: f.id } }); await onRefresh?.(); }} aria-label={`Remove ${f.name}`}>Remove</Button></li>)}</ul>}
        <label className="inline-flex h-9 cursor-pointer items-center rounded border border-line bg-surface px-3 text-ui">Add a file<input type="file" className="sr-only" accept=".pdf,.docx,.xlsx,.pptx,image/png,image/jpeg" onChange={(e) => { const x = e.target.files?.[0]; if (x) attach(x); e.target.value = ""; }} data-testid="send-attach-input" /></label>
        {attachNote && <p className="m-0 text-caption text-mute" role="status">{attachNote}</p>}</div></Row>
      <Row label="Ask for a reason when someone declines"><Switch checked={o.require_decline_reason === true} onCheckedChange={(v) => set({ require_decline_reason: v })} aria-label="Require a decline reason" data-testid="send-decline-reason" /></Row>
      <Row label="Language of the signing page and emails"><NativeSelect value={o.language ?? "en"} onChange={(e) => set({ language: e.currentTarget.value })} aria-label="Language" data-testid="send-language">{[["en", "English"], ["es", "Español"], ["fr", "Français"], ["de", "Deutsch"]].map(([v, l]) => <NativeSelectOption key={v} value={v}>{l}</NativeSelectOption>)}</NativeSelect></Row>
      <Row label="When"><div className="space-y-2"><NativeSelect value={scheduled ? "later" : "now"} onChange={(e) => set({ send_at: e.currentTarget.value === "later" ? new Date(Date.now() + 3600e3).toISOString() : null })} aria-label="When to send" data-testid="send-when"><NativeSelectOption value="now">Send now</NativeSelectOption><NativeSelectOption value="later">Send later</NativeSelectOption></NativeSelect>
        {scheduled && <Input type="datetime-local" value={local} onChange={(e) => { const t = new Date(e.currentTarget.value); if (!Number.isNaN(t.getTime())) set({ send_at: t.toISOString() }); }} aria-label="Send at" data-testid="send-at" />}</div></Row>
      <Row label="Save as a template" help="Keep this document, its places for signatures and its people-seats to send again."><Switch checked={o.save_as_template ?? d.saveAsTemplate} onCheckedChange={(v) => set({ save_as_template: v })} aria-label="Save as a template" data-testid="send-template" /></Row>
    </div>
  );
}
