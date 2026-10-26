// VERIFY A SIGNED DOCUMENT — the page the certificate's QR code opens (`/verify/<tenant>.<document>.<code>`, QUEUE §23.5.1). Public, no session.
// ★ Shows who signed what and when, and lets the person drop THEIR copy: its SHA-256 is computed in the browser (the file never leaves the device) and compared with the sealed copy's.
import { useEffect, useState } from "react";
import PageTitle from "@/lib/components/kit/PageTitle.jsx";
import { sha256OfFile } from "@/lib/documents/upload.js";

const when = (iso) => { try { return new Date(iso).toLocaleString(undefined, { dateStyle: "long", timeStyle: "short" }); } catch { return iso; } };

export default function VerifyDocPage({ data }) {
  const [file, setFile] = useState(null);
  const [match, setMatch] = useState(null);
  useEffect(() => { document.title = data?.facts?.title ? `Verify — ${data.facts.title}` : "Verify a document"; }, [data]);
  if (data === undefined) return <div className="p-10 text-center text-mute" data-testid="verify-loading">Loading…</div>;
  if (!data?.facts) return (
    <div className="mx-auto max-w-[44ch] px-6 py-16 text-center" data-testid="verify-notfound"><PageTitle>We can't find that document</PageTitle><p className="text-body text-ink">The reference may be mistyped, or the document was never completed. Check the link on the certificate page.</p></div>
  );
  const f = data.facts;
  async function check(e) {
    const x = e.target.files?.[0]; if (!x) return; setFile(x.name); setMatch(null);
    const h = await sha256OfFile(x); setMatch(h === f.finalSha256 ? "same" : "different");
  }
  return (
    <main className="mx-auto max-w-[640px] px-4 py-10" data-testid="verify-doc">
      <p className="m-0 text-caption text-mute">{f.organisation}</p>
      <PageTitle>{f.title}</PageTitle>
      <p className="mt-1 text-body text-ink" data-testid="verify-completed">Completed {when(f.executedAt)}{f.pageCount ? ` · ${f.pageCount} page${f.pageCount === 1 ? "" : "s"}` : ""}</p>
      <h2 className="mt-6 text-heading font-medium">Signed by</h2>
      <ul className="m-0 mt-2 list-none space-y-1 p-0" data-testid="verify-signers">{f.signers.map((s) => <li key={s.order} className="flex justify-between gap-3 border-b border-line py-2 text-body"><span>{s.name}</span><span className="text-mute">{when(s.signedAt)}</span></li>)}</ul>
      <h2 className="mt-6 text-heading font-medium">Check your copy</h2>
      <p className="text-meta text-mute">Choose the signed PDF you were given. It is compared here, on your device — it is not uploaded.</p>
      <input type="file" accept="application/pdf" onChange={check} aria-label="Choose your signed PDF" data-testid="verify-file" />
      {match === "same" && <p role="status" className="mt-3 rounded bg-paper p-3 text-body" data-testid="verify-same">✓ {file} is exactly the sealed copy — nothing has been changed.</p>}
      {match === "different" && <p role="alert" className="mt-3 rounded bg-paper p-3 text-body text-bad" data-testid="verify-different">{file} is not the sealed copy. It may be a different file or it may have been altered.</p>}
      <details className="mt-6 text-meta text-mute"><summary>Technical details</summary>
        <p className="break-all">Sealed copy SHA-256: {f.finalSha256 ?? "not yet recorded"}</p>
        <p className="break-all">Original file SHA-256: {f.originalSha256 ?? "—"}</p>
        <p><a className="underline" href="/verify">Check a PDF's embedded digital seal instead</a></p>
      </details>
    </main>
  );
}
