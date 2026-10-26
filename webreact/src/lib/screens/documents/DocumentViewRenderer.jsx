// ═══════════════════════════════════════════════════════════════════════════════════════════════
// DocumentViewRenderer — the React side of the ONE document view (QUEUE §23.2.1). It draws the tree `buildDocumentView` returns (src/documents/documentView.mjs): letterhead, title, each document's
// headings, paragraphs, lists and signatures, and the Certificate of Completion. The PDF is drawn from the same tree (src/documents/pdf.mjs), so a signed copy on screen and on paper say the same thing.
// Used by: "Preview a signed copy" (Settings → Documents). The template editor / send wizard preview tabs use it in Part 3.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { renderNodes } from "./renderContractBlocks.jsx";
import "@fontsource/dancing-script/700.css";   // the typed-signature face (OFL), the same one the PDF embeds
import { cn } from "@/lib/utils";

function Signature({ n }) {
  if (n.state !== "signed") {
    return (
      <div className="mt-4 mb-2" data-testid="signature-slot">
        <p className="m-0 text-meta text-mute">{n.label}</p>
        <div className="mt-8 h-px w-64 bg-line" />
        <p className="m-0 mt-1 text-meta italic text-mute">{n.state === "pending" ? "To be signed" : "Signature"}</p>
      </div>
    );
  }
  const s = n.signature;
  return (
    <div className="mt-4 mb-3" data-testid="signature-signed">
      <p className="m-0 text-meta text-mute">{n.label}</p>
      <div className="mt-1 flex h-14 w-72 max-w-full items-end border-b border-ink-2 pb-1">
        {s.markKind === "drawn" && s.markImage ? <img src={s.markImage} alt={`Signature of ${s.printedName}`} className="max-h-12" />
          : s.markKind === "typed" ? <span className="text-[28px] leading-none text-ink" style={{ fontFamily: "'Dancing Script', 'Brush Script MT', cursive", fontWeight: 700 }}>{s.typedText}</span> : null}
      </div>
      <p className="m-0 mt-1 text-ui font-semibold text-ink">{s.printedName}</p>
      <p className="m-0 text-meta text-mute">{s.roleLabel} · Signed {s.signedText}</p>
      {s.email ? <p className="m-0 text-meta text-mute">{s.email}</p> : null}
      {s.ip ? <p className="m-0 text-meta text-mute">IP address {s.ip}</p> : null}
    </div>
  );
}

function Certificate({ cert }) {
  return (
    <section className="mt-8 border-t border-line pt-6" data-testid="certificate">
      <h2 className="m-0 text-[17px] font-semibold text-ink">{cert.title}</h2>
      <dl className="mt-3 grid gap-x-4 gap-y-1 text-meta md:grid-cols-[160px_minmax(0,1fr)]">
        {cert.summary.map(([l, v]) => (<div key={l} className="contents"><dt className="text-mute">{l}</dt><dd className="m-0 whitespace-pre-line text-ink break-words">{v}</dd></div>))}
      </dl>
      {cert.parties.map((p) => (
        <div key={p.heading} className="mt-5">
          <p className="m-0 text-ui font-semibold text-ink">{p.heading}</p>
          {p.email ? <p className="m-0 text-meta text-mute">{p.email}</p> : null}
          <dl className="mt-1 grid gap-x-4 gap-y-1 text-meta md:grid-cols-[160px_minmax(0,1fr)]">
            {p.lines.map(([l, v]) => (<div key={l} className="contents"><dt className="text-mute">{l}</dt><dd className="m-0 text-ink break-words">{v}</dd></div>))}
          </dl>
        </div>
      ))}
      {cert.fingerprint ? (
        <div className="mt-5">
          <p className="m-0 text-ui font-semibold text-ink">Fingerprint</p>
          <dl className="mt-1 grid gap-x-4 gap-y-1 text-meta md:grid-cols-[190px_minmax(0,1fr)]">
            {cert.fingerprint.map(([l, v]) => (<div key={l} className="contents"><dt className="text-mute">{l}</dt><dd className="m-0 break-all font-mono text-ink">{v}</dd></div>))}
          </dl>
        </div>
      ) : null}
      {cert.timeline && cert.timeline.length ? (
        <div className="mt-5">
          <p className="m-0 text-ui font-semibold text-ink">Timeline</p>
          <ul className="m-0 mt-1 list-none space-y-0.5 p-0 text-meta text-ink">
            {cert.timeline.map(([at, what, who], i) => <li key={i}>{at} — {what}{who ? ` (${who})` : ""}</li>)}
          </ul>
        </div>
      ) : null}
      <p className="mt-5 mb-1 text-meta text-ink">{cert.seal}</p>
      <p className="m-0 text-meta italic text-mute">{cert.statement}</p>
      {cert.verifyUrl ? <p className="mt-3 text-meta text-mute">Verify this document: <span className="text-ink break-all">{cert.verifyUrl}</span></p> : null}
    </section>
  );
}

export default function DocumentViewRenderer({ view, className }) {
  const { chrome, theme } = view;
  return (
    <article className={cn("bg-surface text-ink", className)} data-testid="document-view" data-mode={view.mode} style={{ "--doc-accent": theme.accent }}>
      {chrome.banner ? <p className="m-0 mb-3 rounded border border-line bg-surface-2 px-2 py-1 text-meta font-semibold text-mute" data-testid="view-banner">{chrome.banner}</p> : null}
      {chrome.letterhead ? (
        <header className="mb-4 flex items-center gap-3 border-b-2 pb-3" style={{ borderColor: theme.accent }} data-testid="letterhead">
          {chrome.letterhead.logoUrl && /^https:\/\//.test(chrome.letterhead.logoUrl) ? <img src={chrome.letterhead.logoUrl} alt="" className="max-h-10 max-w-[120px] object-contain" /> : null}
          <div><p className="m-0 text-[15px] font-semibold text-ink">{chrome.letterhead.name}</p>{chrome.letterhead.address ? <p className="m-0 text-meta text-mute">{chrome.letterhead.address}</p> : null}</div>
        </header>
      ) : null}
      <h1 className="m-0 text-[19px] font-semibold">{view.title}</h1>
      {chrome.executedLine ? <p className="m-0 mt-1 text-meta text-mute">{chrome.executedLine}</p> : null}
      {view.mode === "signed" ? <p className="m-0 text-meta text-mute">This is a frozen copy of the instrument as executed. Its price, terms and disclosure are as they were at that moment and do not change.</p> : null}
      {chrome.note ? <p className="m-0 text-meta text-mute">{chrome.note}</p> : null}
      <div className="mt-4">
        {view.documents.map((d, i) => (
          <div key={d.key} className="mb-4">
            {view.documents.length > 1 ? <h2 className="m-0 mb-2 text-[15px] font-semibold" style={{ color: theme.accent }}>Document {i + 1} of {view.documents.length} — {d.title}</h2> : null}
            {d.nodes.map((n, j) => {
              if (n.type === "heading") return <h3 key={j} className="mt-4 mb-1 text-[13px] font-semibold" style={{ color: theme.accent }}>{n.text}</h3>;
              if (n.type === "signature") return <Signature key={j} n={n} />;
              if (n.type === "panel") return <p key={j} className="m-0 mt-2 text-ui font-semibold" style={{ paddingLeft: n.depth * 14 }}>{n.label}</p>;
              if (n.type === "field") return <div key={j} className="mb-2" style={{ paddingLeft: n.depth * 14 }}><p className="m-0 text-ui font-semibold">{n.label}</p><p className={cn("m-0 text-ui", n.value === null ? "text-mute" : "text-ink-2")}>{n.value === null ? "— not answered —" : n.value}</p></div>;
              return <div key={j}>{renderNodes([n])}</div>;
            })}
          </div>
        ))}
      </div>
      {view.closingLine ? <p className="m-0 text-ui italic text-mute">{view.closingLine}</p> : null}
      {view.certificate ? <Certificate cert={view.certificate} /> : null}
      <footer className="mt-6 flex flex-wrap justify-between gap-2 border-t border-line pt-2 text-meta text-mute" data-testid="view-footer">
        <span>{[chrome.showDocumentId ? `Document ID ${chrome.documentIdText}` : null, chrome.footerText, chrome.poweredBy].filter(Boolean).join("  ·  ")}</span>
        {chrome.pageNumbers ? <span>Page numbers are added in the PDF</span> : null}
      </footer>
    </article>
  );
}
