// SELF-SERVE START — the page a practice's website links to (`/s/<slug>`, QUEUE §23.5.7). Public, no session.
// ★ The visitor types their name and email; the server makes THEIR OWN copy and answers a link for this device, which we open. Nothing is emailed.
// The hidden `website` field is a honeypot: people never see it, scripts fill it in, the server answers "not found".
import { useEffect, useState } from "react";
import PageTitle from "@/lib/components/kit/PageTitle.jsx";
import { Button } from "@/lib/components/ui/button.jsx";
import { Input } from "@/lib/components/ui/input.jsx";

export default function SelfServePage({ data }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [trap, setTrap] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  useEffect(() => { document.title = data?.page?.title ?? "Start a document"; }, [data]);
  if (data === undefined) return <div className="p-10 text-center text-mute" data-testid="selfserve-loading">Loading…</div>;
  if (!data?.page) return (
    <div className="mx-auto max-w-[44ch] px-6 py-16 text-center" data-testid="selfserve-gone"><PageTitle>That page does not exist</PageTitle><p className="text-body text-ink">The link may be mistyped, or the organisation has switched it off.</p></div>
  );
  const p = data.page;
  async function start(e) {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      const r = await fetch("/api/public/documents/self-serve/start", { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify({ slug: data.slug, name, email, website: trap }) });
      const out = await r.json().catch(() => ({}));
      if (!r.ok || !out.presented) { setError(r.status === 429 ? "Too many tries from this device. Please wait a while and try again." : (out?.error?.message ?? out?.message ?? "We could not start that document. Check your details and try again.")); setBusy(false); return; }
      window.location.assign(out.presented);
    } catch { setError("We could not reach the server. Check your connection and try again."); setBusy(false); }
  }
  return (
    <div className="mx-auto max-w-[480px] px-4 py-10" data-testid="selfserve">
      {p.org?.logoUrl ? <img src={p.org.logoUrl} alt="" className="mb-3 h-10" /> : null}
      <p className="m-0 text-caption text-mute">{p.org?.name}</p>
      <PageTitle>{p.title}</PageTitle>
      <p className="mt-1 text-body text-ink">{p.pages} page{p.pages === 1 ? "" : "s"}. Tell us who you are, then read and sign it on this device.</p>
      <form onSubmit={start} className="mt-6 space-y-4" data-testid="selfserve-form">
        <label className="block text-ui">Your full name<Input className="mt-1" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required maxLength={120} data-testid="selfserve-name" /></label>
        <label className="block text-ui">Your email<Input className="mt-1" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required maxLength={254} data-testid="selfserve-email" /></label>
        <div aria-hidden="true" style={{ position: "absolute", left: "-10000px", width: 1, height: 1, overflow: "hidden" }}><label>Website<input tabIndex={-1} autoComplete="off" value={trap} onChange={(e) => setTrap(e.target.value)} /></label></div>
        {error ? <p role="alert" className="text-body text-bad" data-testid="selfserve-error">{error}</p> : null}
        <Button type="submit" disabled={busy || !name.trim() || !email.trim()} data-testid="selfserve-start">{busy ? "Starting…" : "Continue to the document"}</Button>
      </form>
    </div>
  );
}
