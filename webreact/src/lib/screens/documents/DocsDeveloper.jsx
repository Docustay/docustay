// DocsDeveloper — Documents → Developers and data (QUEUE §23.5.8, §23.15.3). Four plain panels: the REST API (where it is, which key it needs, a send example), webhooks (which document events exist and where to subscribe),
// the embed (a snippet for the public signing link), and data (export every signed document of a period; show or remove one person's details).
// ★ API keys and webhook endpoints are the platform's own screens (Settings → Developer); this page tells you what to do there for documents and links to them.
import { useState } from "react";
import PageTitle from "@/lib/components/kit/PageTitle.jsx";
import { Button } from "@/lib/components/ui/button.jsx";
import { Input } from "@/lib/components/ui/input.jsx";
import { useWrite } from "@/lib/documents/ports.js";

const EVENTS = [
  ["documents.document.sent", "A document was sent for signature."], ["documents.document.opened", "A person opened it."], ["documents.document.signed", "One person signed."],
  ["documents.document.executed", "Everyone has signed — the sealed copy exists."], ["documents.document.declined", "A person declined."], ["documents.document.voided", "The sender voided it."],
  ["documents.document.expired", "It passed its deadline unsigned."], ["documents.document.bounced", "An invitation email bounced."], ["documents.document.changes_requested", "A person asked for changes."],
  ["documents.document.reminder_due", "A reminder is due for someone."],
];
const copy = (text) => { try { navigator.clipboard?.writeText(text); } catch { /* the text is selectable anyway */ } };

function Panel({ id, title, children }) {
  return <section className="rounded-card border border-line bg-surface p-5" data-testid={`dev-${id}`}><h2 className="m-0 mb-2 text-ui font-semibold text-ink">{title}</h2>{children}</section>;
}
function Code({ children }) { return <pre className="m-0 mt-2 overflow-x-auto rounded bg-paper p-3 text-caption text-ink-2" data-testid="dev-code"><code>{children}</code></pre>; }

export default function DocsDeveloper({ onNavigate = null }) {
  const go = (href) => { if (onNavigate) onNavigate(href); else window.location.assign(href); };
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const [slug, setSlug] = useState("your-link-name");
  const [from, setFrom] = useState(""), [to, setTo] = useState("");
  const [email, setEmail] = useState("");
  const [report, setReport] = useState(null), [erased, setErased] = useState(null), [problem, setProblem] = useState(null), [confirm, setConfirm] = useState(false);
  const showData = useWrite("POST /api/documents/pdf/data-report");
  const eraseData = useWrite("POST /api/documents/pdf/data-erase");
  const exportHref = `/api/documents/pdf/export.zip?${new URLSearchParams({ ...(from ? { from } : {}), ...(to ? { to } : {}) }).toString()}`;
  const snippet = `<script src="${origin}/embed/docustay.js" async></script>\n<docustay-form slug="${slug.trim().toLowerCase() || "your-link-name"}" height="760"></docustay-form>`;
  const curl = `curl ${origin}/api/v1/documents/send \\\n  -H "Authorization: Bearer YOUR_KEY" \\\n  -H "Idempotency-Key: $(uuidgen)" \\\n  -H "Content-Type: application/json" \\\n  -d '{"templateId":"TEMPLATE_ID","parties":[{"seat":"signer_1","name":"Ana Perez","email":"ana@example.com"}]}'`;

  async function lookup() { setProblem(null); setErased(null); setReport(null); try { setReport(await showData.run({ body: { email } })); } catch (e) { setProblem(e.message || "That could not be looked up."); } }
  async function remove() { setProblem(null); try { setErased(await eraseData.run({ body: { email } })); setReport(null); setConfirm(false); } catch (e) { setProblem(e.message || "That could not be done."); } }

  return (
    <div className="px-4 py-6 md:px-7" data-testid="docs-developer">
      <div className="mb-4"><PageTitle>Developers and data</PageTitle><p className="m-0 mt-1.5 text-control text-mute">Connect your own software, put signing on your website, and take your records out.</p></div>
      <div className="max-w-[860px] space-y-5">
        <Panel id="api" title="REST API">
          <p className="m-0 text-body text-ink-2">Send a template to people, follow it, and download the signed copy from your own software. Reads need the <b>documents:read</b> scope, sending and voiding need <b>documents:write</b>. A key can start a signature; it can never sign for anyone.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button onClick={() => go("/settings/developer/api-keys")} data-testid="dev-keys">API keys</Button>
            <Button variant="outline" onClick={() => window.open(`${origin}/api/v1/docs`, "_blank", "noopener")} data-testid="dev-docs">Open the API reference</Button>
          </div>
          <Code>{curl}</Code>
        </Panel>
        <Panel id="webhooks" title="Webhooks">
          <p className="m-0 text-body text-ink-2">Get a signed message at your own address when something happens to a document. Each delivery is signed with your endpoint's secret (headers <code>keystone-signature</code>, <code>keystone-timestamp</code>, <code>keystone-event-id</code>), retried if your server is down, and logged.</p>
          <p className="m-0 mt-2 text-body text-ink-2" data-testid="dev-standard-webhooks">Every delivery also carries the <a className="underline" href="https://www.standardwebhooks.com" target="_blank" rel="noreferrer">Standard Webhooks</a> headers (<code>webhook-id</code>, <code>webhook-timestamp</code>, <code>webhook-signature</code>), so any Standard Webhooks library can verify it. Give the library your endpoint secret with the leading <code>whsec_</code>; if the secret contains <code>-</code> or <code>_</code>, swap them for <code>+</code> and <code>/</code> first. After you fix your server, open <b>Settings → Developer → Webhook deliveries</b> and press <b>Replay</b> on any delivery: it is sent again as a new, marked row (<code>keystone-replay</code> header) and your own click is recorded. Automatic retries are unchanged.</p>
          <ul className="m-0 mt-2 list-none space-y-1 p-0 text-meta" data-testid="dev-events">{EVENTS.map(([k, v]) => <li key={k}><code className="text-ink">{k}</code> <span className="text-mute">— {v}</span></li>)}</ul>
          <div className="mt-3"><Button onClick={() => go("/settings/developer/webhooks")} data-testid="dev-webhooks">Webhook endpoints</Button></div>
        </Panel>
        <Panel id="embed" title="Put signing on your website">
          <p className="m-0 text-body text-ink-2">Turn on a public link for a one-signer template (Templates → Uploaded templates → the template → Public link), then paste this where the form should appear.</p>
          <label className="mt-3 block text-ui">Link name<Input className="mt-1 max-w-[320px]" value={slug} onChange={(e) => setSlug(e.currentTarget.value)} aria-label="Link name" data-testid="dev-slug" /></label>
          <Code>{snippet}</Code>
          <div className="mt-2"><Button size="sm" variant="outline" onClick={() => copy(snippet)} data-testid="dev-copy">Copy</Button></div>
        </Panel>
        <Panel id="access" title="Who can do what">
          <p className="m-0 text-body text-ink-2">People in your organisation use the same roles and permissions as the rest of the product, on the <b>document</b> permission. Change who holds which in Roles and permissions.</p>
          <table className="mt-2 w-full border-collapse text-meta" data-testid="dev-access"><tbody>
            {[["Upload, send, remind, void, make templates, send in bulk, kiosk", "document · edit"], ["Approve or reject a template, export records, a person's data request, delete", "document · delete"], ["Change these settings", "Documents section, admin rank"]].map(([what, perm]) => <tr key={what} className="border-b border-line"><td className="py-1.5 pr-3 text-ink">{what}</td><td className="py-1.5 text-mute">{perm}</td></tr>)}
          </tbody></table>
          <div className="mt-3"><Button variant="outline" onClick={() => go("/settings/roles")} data-testid="dev-roles">Roles and permissions</Button></div>
        </Panel>
        <Panel id="data" title="Your data">
          <p className="m-0 text-body text-ink-2">Take out every signed document of a period, with its audit log, as one zip. Only an admin can.</p>
          <div className="mt-2 flex flex-wrap items-end gap-3">
            <label className="text-ui">From<Input className="mt-1" type="date" value={from} onChange={(e) => setFrom(e.currentTarget.value)} aria-label="From date" data-testid="dev-from" /></label>
            <label className="text-ui">To<Input className="mt-1" type="date" value={to} onChange={(e) => setTo(e.currentTarget.value)} aria-label="To date" data-testid="dev-to" /></label>
            <Button asChild><a href={exportHref} download data-testid="dev-export">Download the signed documents</a></Button>
          </div>
          <hr className="my-4 border-line" />
          <p className="m-0 text-body text-ink-2"><b>A person's request.</b> Show everything held about an email address, or remove their details. Signed documents are legal records: they are never changed or deleted here, and the result says which were kept and until when.</p>
          <div className="mt-2 flex flex-wrap items-end gap-3">
            <label className="text-ui">Their email<Input className="mt-1 min-w-[260px]" type="email" value={email} onChange={(e) => setEmail(e.currentTarget.value)} aria-label="Their email address" data-testid="dev-email" /></label>
            <Button variant="outline" disabled={!email.trim() || showData.busy || showData.hidden} onClick={lookup} data-testid="dev-lookup">Show what we hold</Button>
            <Button variant="outline" disabled={!email.trim() || eraseData.busy || eraseData.hidden} onClick={() => setConfirm(true)} data-testid="dev-erase">Remove their details…</Button>
          </div>
          {confirm && (
            <div role="alertdialog" aria-label="Confirm removal" className="mt-3 rounded border border-line bg-paper p-3" data-testid="dev-confirm">
              <p className="m-0 text-body">Remove <b>{email}</b> from every document that is not signed? Anything still out for signature is voided first. This cannot be undone.</p>
              <div className="mt-2 flex gap-2"><Button onClick={remove} disabled={eraseData.busy} data-testid="dev-erase-confirm">Remove their details</Button><Button variant="ghost" onClick={() => setConfirm(false)}>Cancel</Button></div>
            </div>)}
          {problem && <p role="alert" className="m-0 mt-2 text-meta text-bad" data-testid="dev-problem">{problem}</p>}
          {report && (
            <div className="mt-3" data-testid="dev-report"><p className="m-0 text-meta text-mute">{report.documents.length} document{report.documents.length === 1 ? "" : "s"} for {report.email}</p>
              <ul className="m-0 mt-1 list-none space-y-1 p-0 text-meta">{report.documents.map((d) => <li key={d.id}>{d.title} — {d.state}{d.signed ? ", signed" : ""} <span className="text-mute">({d.role})</span></li>)}</ul></div>)}
          {erased && (
            <div className="mt-3 text-meta" data-testid="dev-erased"><p className="m-0">Removed from {erased.removed.length} document{erased.removed.length === 1 ? "" : "s"}{erased.voided.length ? `; ${erased.voided.length} voided first` : ""}.</p>
              {erased.kept.length > 0 && <><p className="m-0 mt-1">Kept, because a signed record stands alone:</p><ul className="m-0 list-none space-y-1 p-0">{erased.kept.map((k) => <li key={k.id}>{k.title} — {k.indefinitely ? "kept indefinitely" : `kept until ${k.keptUntil}`}</li>)}</ul></>}</div>)}
        </Panel>
      </div>
    </div>
  );
}
