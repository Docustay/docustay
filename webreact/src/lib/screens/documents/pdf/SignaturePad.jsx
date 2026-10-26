// SignaturePad — draw, type or upload a signature (or initials). Returns a PNG data URL under 200 KB through `onDone`.
// ★ Drawing uses signature_pad; typing renders the name in a script face onto a canvas; an uploaded picture is scaled down to fit the size cap.
import { useEffect, useRef, useState } from "react";
import SignaturePadLib from "signature_pad";
import { Button } from "@/lib/components/ui/button.jsx";
import { Input } from "@/lib/components/ui/input.jsx";

const MAX = 204800;
const W = 600, H = 200;

function fitPng(canvas) {
  let url = canvas.toDataURL("image/png");
  let c = canvas;
  while (url.length > MAX && c.width > 120) {
    const n = document.createElement("canvas"); n.width = Math.round(c.width * 0.75); n.height = Math.round(c.height * 0.75);
    n.getContext("2d").drawImage(c, 0, 0, n.width, n.height); c = n; url = c.toDataURL("image/png");
  }
  return url.length <= MAX ? url : null;
}

// ★ §23.15.5 — a signature or initials the person chose to keep, in THIS browser only (localStorage; never sent anywhere until they use it). Off by default, and never offered on a shared kiosk.
const savedKey = (label) => `docustay.saved.${label}`;
const readSaved = (label) => { try { const v = window.localStorage.getItem(savedKey(label)); return typeof v === "string" && v.startsWith("data:image/png;base64,") && v.length <= MAX ? v : null; } catch { return null; } };
const writeSaved = (label, url) => { try { if (url) window.localStorage.setItem(savedKey(label), url); else window.localStorage.removeItem(savedKey(label)); } catch { /* private window or blocked storage: it simply is not kept */ } };

export default function SignaturePad({ label = "signature", defaultName = "", onDone, onCancel, canRemember = true, allowTyped = true }) {
  const [saved, setSaved] = useState(() => (canRemember ? readSaved(label) : null));
  const [remember, setRemember] = useState(false);
  const [tab, setTab] = useState("draw");
  const [typed, setTyped] = useState(defaultName);
  const [problem, setProblem] = useState(null);
  const [empty, setEmpty] = useState(true);
  const canvas = useRef(null), pad = useRef(null), picked = useRef(null);

  useEffect(() => {
    if (tab !== "draw" || !canvas.current) return undefined;
    const el = canvas.current, dpr = Math.min(window.devicePixelRatio || 1, 2), r = el.getBoundingClientRect();
    el.width = Math.round(r.width * dpr); el.height = Math.round(r.height * dpr); el.getContext("2d").scale(dpr, dpr);
    pad.current = new SignaturePadLib(el, { penColor: "#111", minWidth: 1, maxWidth: 2.8 });
    pad.current.addEventListener("endStroke", () => setEmpty(pad.current.isEmpty()));
    setEmpty(true);
    return () => pad.current?.off();
  }, [tab]);

  function done() {
    setProblem(null);
    let url = null;
    if (tab === "draw") { if (!pad.current || pad.current.isEmpty()) return setProblem(`Draw your ${label} first.`); url = fitPng(canvas.current); }
    else if (tab === "type") {
      if (!typed.trim()) return setProblem("Type your name first.");
      const c = document.createElement("canvas"); c.width = W; c.height = H; const g = c.getContext("2d");
      g.fillStyle = "#111"; g.textBaseline = "middle"; let size = 90;
      do { g.font = `${size}px "Snell Roundhand","Segoe Script","Brush Script MT",cursive`; size -= 4; } while (g.measureText(typed).width > W - 40 && size > 20);
      g.fillText(typed.trim(), 20, H / 2); url = fitPng(c);
    } else {
      if (!picked.current) return setProblem("Choose a picture first.");
      url = fitPng(picked.current);
    }
    if (!url) return setProblem("That picture is too large — try a simpler one.");
    if (canRemember && remember) writeSaved(label, url);
    onDone(url, tab === "draw" ? "drawn" : tab === "type" ? "typed" : "uploaded");
  }
  function onFile(f) {
    if (!f) return;
    const img = new Image();
    img.onload = () => {
      const s = Math.min(1, W / img.width, H / img.height), c = document.createElement("canvas");
      c.width = Math.round(img.width * s); c.height = Math.round(img.height * s); c.getContext("2d").drawImage(img, 0, 0, c.width, c.height); picked.current = c; setProblem(null); setTyped((t) => t); setEmpty(false);
    };
    img.onerror = () => setProblem("That file is not a picture we can read.");
    img.src = URL.createObjectURL(f);
  }

  return (
    <div className="space-y-3" data-testid="signature-pad">
      {saved && (
        <div className="flex items-center gap-3 rounded border border-line bg-paper p-2" data-testid="pad-saved">
          <img src={saved} alt={`Your saved ${label}`} className="h-10 max-w-[160px] bg-white object-contain" />
          <Button size="sm" onClick={() => onDone(saved, "drawn")} data-testid="pad-use-saved">Use my saved {label}</Button>
          <Button size="sm" variant="ghost" onClick={() => { writeSaved(label, null); setSaved(null); }} data-testid="pad-forget">Forget it</Button>
        </div>
      )}
      <div role="tablist" className="flex gap-2">
        {[["draw", "Draw"], ["type", "Type"], ["upload", "Upload"]].filter(([k]) => allowTyped || k !== "type").map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} type="button" onClick={() => { setTab(k); setProblem(null); }} className={`rounded-full px-3 py-1 text-caption ${tab === k ? "bg-ink text-surface" : "bg-paper text-ink-2"}`} data-testid={`pad-tab-${k}`}>{l}</button>)}
      </div>
      {tab === "draw" && <canvas ref={canvas} className="block h-[160px] w-full touch-none rounded border border-line bg-white" aria-label={`Draw your ${label} here`} data-testid="pad-canvas" />}
      {tab === "type" && <div className="space-y-2"><Input value={typed} onChange={(e) => setTyped(e.currentTarget.value)} placeholder="Your full name" aria-label="Type your name" data-testid="pad-typed" /><p className="m-0 flex h-[100px] items-center rounded border border-line bg-white px-4 text-[44px] text-ink" style={{ fontFamily: '"Snell Roundhand","Segoe Script","Brush Script MT",cursive' }} aria-hidden="true">{typed}</p></div>}
      {tab === "upload" && <div className="space-y-2"><input type="file" accept="image/png,image/jpeg" onChange={(e) => onFile(e.target.files?.[0])} aria-label={`Upload a picture of your ${label}`} data-testid="pad-file" />{!empty && <p className="m-0 text-meta text-mute">Picture ready.</p>}</div>}
      {problem && <p className="m-0 text-meta text-bad" role="alert" data-testid="pad-problem">{problem}</p>}
      {canRemember && <label className="flex items-center gap-2 text-caption text-ink-2"><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} data-testid="pad-remember" />Remember this {label} on this device for next time</label>}
      <div className="flex gap-2">
        <Button onClick={done} data-testid="pad-use">Use this {label}</Button>
        {tab === "draw" && <Button variant="outline" onClick={() => { pad.current?.clear(); setEmpty(true); }} data-testid="pad-clear">Clear</Button>}
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}
