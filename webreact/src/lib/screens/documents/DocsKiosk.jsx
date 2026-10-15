// DocsKiosk — KIOSK SIGNING (QUEUE §23.5.2): a shared tablet at the front desk. Staff opens this screen, the person types their name, signs on this device, and the page returns here for the next person. No email is needed.
// ★ Nothing here reads or lists anyone's documents: it shows only the template picker and a name box. "Exit kiosk" is the small link at the bottom (the staff sign-in stays on this device).
import { useEffect, useState } from "react";
import { request } from "@/lib/api.js";
import { Button } from "@/lib/components/ui/button.jsx";
import { Input } from "@/lib/components/ui/input.jsx";
import { useWrite } from "@/lib/documents/ports.js";

export default function DocsKiosk({ onNavigate = null }) {
  const [templates, setTemplates] = useState(null);
  const [templateId, setTemplateId] = useState(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [problem, setProblem] = useState(null);
  const start = useWrite("POST /api/documents/pdf/kiosk");

  useEffect(() => { request("/api/documents/pdf/kiosk-templates").then((r) => { setTemplates(r.templates); setTemplateId(r.templates[0]?.id ?? null); }).catch((e) => { setProblem(e.message); setTemplates([]); }); }, []);

  async function begin(e) {
    e.preventDefault(); setProblem(null);
    try {
      const r = await start.run({ body: { templateId, name, email: email.trim() || undefined } });
      window.location.assign(`${r.presented}${r.presented.includes("?") ? "&" : "?"}k=1`);
    } catch (err) { setProblem(err.message || "Something went wrong. Try again."); }
  }

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-[520px] flex-col justify-center gap-4 px-6 py-10" data-testid="docs-kiosk">
      {templates === null ? <p className="text-mute">Loading…</p> : templates.length === 0 ? (
        <div className="text-center" data-testid="kiosk-empty"><h1 className="text-title font-semibold">No kiosk document yet</h1><p className="text-body text-ink-2">Kiosk mode uses an uploaded document with exactly one person signing. Save one as a template first.</p><Button className="mt-3" onClick={() => onNavigate?.("/documents/upload")}>Upload a document</Button></div>
      ) : (
        <form onSubmit={begin} className="space-y-4">
          <h1 className="m-0 text-title font-semibold">Welcome — let's get you signed in</h1>
          {templates.length > 1 && <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Document">{templates.map((t) => <button key={t.id} type="button" role="radio" aria-checked={templateId === t.id} onClick={() => setTemplateId(t.id)} className={`rounded-full px-4 py-2 text-ui ${templateId === t.id ? "bg-ink text-surface" : "bg-paper text-ink-2"}`} data-testid="kiosk-template">{t.name}</button>)}</div>}
          {templates.length === 1 && <p className="m-0 text-body text-ink-2" data-testid="kiosk-doc-name">{templates[0].name}</p>}
          <Input className="h-12 text-body" value={name} onChange={(e) => setName(e.currentTarget.value)} placeholder="Your full name" aria-label="Your full name" autoComplete="off" data-testid="kiosk-name" />
          <Input className="h-12 text-body" type="email" value={email} onChange={(e) => setEmail(e.currentTarget.value)} placeholder="Email for your copy (optional)" aria-label="Email for your copy (optional)" autoComplete="off" data-testid="kiosk-email" />
          <Button type="submit" size="lg" className="h-12 w-full" disabled={!name.trim() || start.busy} data-testid="kiosk-begin">Continue</Button>
          {problem && <p role="alert" className="m-0 text-meta text-bad" data-testid="kiosk-problem">{problem}</p>}
        </form>
      )}
      <button type="button" className="mt-6 self-center text-caption text-mute underline" onClick={() => onNavigate?.("/documents")} data-testid="kiosk-exit">Exit kiosk</button>
    </div>
  );
}
