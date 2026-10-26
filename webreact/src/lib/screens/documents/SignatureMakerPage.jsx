// FREE SIGNATURE MAKER — public, no account (QUEUE §23.5.15). Type a name to get it in four handwriting styles, or draw one, and download a transparent PNG. Runs entirely in the browser; nothing is sent anywhere.
// Fonts: Dancing Script, Great Vibes, Allura and Sacramento (SIL Open Font License, via Fontsource) — bundled, never fetched from a third party.
import { useEffect, useRef, useState } from "react";
import "@fontsource/dancing-script/400.css";
import "@fontsource/great-vibes/400.css";
import "@fontsource/allura/400.css";
import "@fontsource/sacramento/400.css";
import PageTitle from "@/lib/components/kit/PageTitle.jsx";
import { Button } from "@/lib/components/ui/button.jsx";
import { Input } from "@/lib/components/ui/input.jsx";
import SignaturePad from "./pdf/SignaturePad.jsx";

const STYLES = [["Dancing Script", "Dancing Script"], ["Great Vibes", "Great Vibes"], ["Allura", "Allura"], ["Sacramento", "Sacramento"]];
const INKS = [["Black", "#111111"], ["Blue", "#1d3b8b"], ["Navy", "#0b1f4d"]];

/** The typed name as a transparent PNG data URL, cropped to the ink with a small margin. */
async function renderTyped(text, family, ink) {
  try { await document.fonts.load(`96px "${family}"`, text); } catch { /* a font that fails to load falls back to cursive */ }
  const size = 120, c = document.createElement("canvas"), g = c.getContext("2d");
  g.font = `${size}px "${family}", cursive`;
  const m = g.measureText(text), pad = 24;
  c.width = Math.ceil(m.width + pad * 2); c.height = Math.ceil(size * 1.6 + pad * 2);
  const g2 = c.getContext("2d");
  g2.font = `${size}px "${family}", cursive`; g2.fillStyle = ink; g2.textBaseline = "alphabetic";
  g2.fillText(text, pad, pad + size * 1.1);
  return c.toDataURL("image/png");
}

export default function SignatureMakerPage() {
  const [text, setText] = useState("");
  const [family, setFamily] = useState(STYLES[0][0]);
  const [ink, setInk] = useState(INKS[0][1]);
  const [tab, setTab] = useState("type");
  const [url, setUrl] = useState(null);
  const [drawn, setDrawn] = useState(null);
  const seq = useRef(0);
  useEffect(() => { document.title = "Free signature maker"; }, []);
  useEffect(() => {
    const n = (seq.current += 1);
    if (tab !== "type" || !text.trim()) { setUrl(null); return; }
    renderTyped(text.trim(), family, ink).then((u) => { if (n === seq.current) setUrl(u); });
  }, [text, family, ink, tab]);
  const shown = tab === "type" ? url : drawn;
  function download() { const a = document.createElement("a"); a.href = shown; a.download = "signature.png"; document.body.appendChild(a); a.click(); a.remove(); }

  return (
    <main className="mx-auto min-h-screen max-w-[720px] px-4 py-8" data-testid="signature-maker">
      <PageTitle>Free signature maker</PageTitle>
      <p className="m-0 mt-1 text-body text-ink-2">Make a signature picture with a see-through background. Nothing you type or draw leaves this device.</p>
      <div role="tablist" className="mt-5 flex gap-2">
        {[["type", "Type it"], ["draw", "Draw it"]].map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} type="button" onClick={() => setTab(k)} className={`rounded px-3 py-1 text-ui ${tab === k ? "bg-ink text-surface" : "border border-line text-ink"}`} data-testid={`maker-tab-${k}`}>{l}</button>)}
      </div>
      {tab === "type" ? (
        <div className="mt-4 space-y-4">
          <label className="block text-ui">Your name<Input className="mt-1" value={text} onChange={(e) => setText(e.currentTarget.value)} maxLength={60} placeholder="Type your name" data-testid="maker-name" /></label>
          <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Style">
            {STYLES.map(([label, fam]) => (
              <button key={fam} type="button" role="radio" aria-checked={family === fam} onClick={() => setFamily(fam)} className={`rounded border p-3 text-left ${family === fam ? "border-ink bg-surface" : "border-line"}`} data-testid={`maker-style-${fam.replace(/\s/g, "")}`}>
                <span style={{ fontFamily: `"${fam}", cursive`, fontSize: 34, lineHeight: 1.2, color: ink }}>{text.trim() || "Your name"}</span>
                <span className="block text-caption text-mute">{label}</span>
              </button>))}
          </div>
          <div className="flex items-center gap-2 text-ui">Ink:{INKS.map(([l, v]) => <button key={v} type="button" onClick={() => setInk(v)} aria-label={l} aria-pressed={ink === v} className={`h-6 w-6 rounded-full border-2 ${ink === v ? "border-ink" : "border-line"}`} style={{ background: v }} data-testid={`maker-ink-${l}`} />)}</div>
        </div>
      ) : (
        <div className="mt-4"><SignaturePad label="signature" canRemember={false} onDone={(u) => setDrawn(u)} onCancel={() => setDrawn(null)} /></div>
      )}
      {shown && (
        <div className="mt-6 rounded-card border border-line p-4" data-testid="maker-result" style={{ backgroundImage: "repeating-conic-gradient(#e5e7eb 0% 25%, #fff 0% 50%)", backgroundSize: "16px 16px" }}>
          <img src={shown} alt="Your signature" className="mx-auto max-h-[140px] max-w-full" data-testid="maker-preview" />
        </div>)}
      <div className="mt-4"><Button onClick={download} disabled={!shown} data-testid="maker-download">Download PNG</Button></div>
      <p className="m-0 mt-8 text-meta text-mute">Need people to sign documents with you? <a className="underline" href="/signup">Create a free account</a> to send documents for signature.</p>
    </main>
  );
}
