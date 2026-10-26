// THE SIGNED-COPY DOWNLOAD PAGE (/download?t=<token>) — the page a "Your signed copy" email links to. It exists here as well as in docustay/web because an organisation's own signing address is served by THIS app (src/http/customHost.mjs),
// and a link on that address must land on the page, not on the workspace shell (R13-D069). The token is read once and stripped from the address bar; an email-code gate shows first when the sender asked for one.
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/lib/components/ui/button";
import { Input } from "@/lib/components/ui/input";

const REFUSED = "That link is not valid. It may have been used already, expired, or been cancelled — ask them for a new one.";
const TROUBLE = "Something went wrong on our side. Try reloading the page.";

export default function DownloadPage() {
  const [phase, setPhase] = useState("loading"), [view, setView] = useState(null), [token, setToken] = useState(null), [code, setCode] = useState(""), [msg, setMsg] = useState(null), [busy, setBusy] = useState(false);
  const call = useCallback(async (t, path, body = {}) => {
    const r = await fetch(`/api/public/pdf/download/${path}`, { method: "POST", headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID().replace(/-/g, "") }, body: JSON.stringify({ presented: t, ...body }) });
    if (path === "file") { if (!r.ok) throw Object.assign(new Error("The file could not be fetched. Try again."), { status: r.status }); return r.blob(); }
    const json = await r.json().catch(() => null);
    if (!r.ok) throw Object.assign(new Error(json?.error?.message ?? TROUBLE), { status: r.status });
    return json;
  }, []);
  const settle = (v) => { setView(v); setPhase(v.needsCode ? "gate" : "ready"); };
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("t");
    window.history.replaceState(null, "", window.location.pathname);
    if (!t) { setPhase("refused"); return; }
    setToken(t);
    call(t, "view").then(settle).catch((e) => setPhase(e.status === 403 ? "refused" : "trouble"));
  }, [call]);
  useEffect(() => { document.title = view?.title ? `${view.title} — signed copy` : "Signed copy"; }, [view]);
  const askCode = async () => { setMsg(null); try { const r = await call(token, "send-code"); setMsg(`We sent a code to ${r.to}. It works for ${r.validMinutes} minutes.`); } catch (e) { setMsg(e.message); } };
  const submitCode = async () => {
    setMsg(null);
    try { const r = await call(token, "verify", { code }); if (r.verified) { setCode(""); settle(await call(token, "view")); } else setMsg(r.code === "locked" ? "Too many wrong codes. Ask for a new link." : r.code === "expired" ? "That code has expired. Ask for a new one." : `That code is not right.${r.triesLeft != null ? ` ${r.triesLeft} tries left.` : ""}`); } catch (e) { setMsg(e.message); }
  };
  const get = async (which, documentId, name) => {
    setBusy(true); setMsg(null);
    try {
      const blob = await call(token, "file", { which, documentId });
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `${name}${which === "certificate" ? " - certificate" : " (signed)"}.pdf`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    } catch (e) { setMsg(e.status === 403 ? "Confirm your email code first." : e.message); } finally { setBusy(false); }
  };
  if (phase === "loading") return <div className="flex min-h-screen"><p className="m-auto text-muted-foreground" data-testid="download-loading">Loading…</p></div>;
  if (phase === "refused" || phase === "trouble") return (
    <div className="flex min-h-screen"><div className="m-auto max-w-[44ch] px-6 text-center" data-testid="download-refused"><h1 className="text-2xl font-bold">This link can't be opened</h1><p className="mt-3" role="alert">{phase === "refused" ? REFUSED : TROUBLE}</p></div></div>
  );
  return (
    <div className="flex min-h-screen"><div className="m-auto w-full max-w-[480px] space-y-4 px-6 py-10" data-testid="download-ready">
      {view.org?.logoUrl ? <img src={view.org.logoUrl} alt={view.org?.name ?? ""} className="h-9 w-auto" /> : view.org?.name ? <p className="text-sm text-muted-foreground">{view.org.name}</p> : null}
      <h1 className="text-2xl font-bold tracking-tight">{view.title}</h1>
      {phase === "gate" ? (
        <>
          <p>{view.org?.name ?? "The sender"} asked for an email code before this download. We will send one to {view.email}.</p>
          <form className="flex max-w-xs flex-col gap-2" onSubmit={(e) => { e.preventDefault(); submitCode(); }}>
            <Button type="button" variant="outline" onClick={askCode}>Email me a code</Button>
            <Input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" aria-label="Code" />
            <Button type="submit" disabled={!code.trim()}>Open the signed copy</Button>
          </form>
        </>
      ) : (
        <>
          <ul className="space-y-2">{view.documents.map((d) => <li key={d.id} className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2"><span className="truncate">{d.title}</span><Button size="sm" disabled={busy} onClick={() => get("signed", d.id, d.title)} data-testid="download-signed">Download</Button></li>)}</ul>
          {view.certificate ? <Button variant="outline" disabled={busy} onClick={() => get("certificate", null, view.title)} data-testid="download-certificate">Download the certificate</Button> : null}
        </>
      )}
      {msg ? <p className="text-sm text-muted-foreground" role="status">{msg}</p> : null}
    </div></div>
  );
}
