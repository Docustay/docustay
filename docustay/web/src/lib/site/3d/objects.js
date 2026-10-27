// Docustay still-object library (V3, 14 Oct 2026). three.js (MIT). Each builder returns a THREE.Group of one real thing (a package, a key, an envelope...). They are rendered OFFLINE, once, by
// scripts/render-stills.mjs into transparent images (static/stills/hero-<name>.{avif,webp,png}). Nothing here runs on the public site: no stars, no dust, no bloom, no glare, no animation.
// Sharp edges, one soft key light, a soft contact shadow, calm colour by area (palette.js).
// CREAM (16 Oct 2026, specs/SITE-CREAM-RESTYLE.md §3, §5): rendered for the cream page: the shadow is violet-tinted, screen and card faces are white paper with ink text, nothing is emissive. Words unchanged.
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { AREA } from "./palette.js";
import PRICES from "../prices.json" with { type: "json" };
const usd = (m) => `$${(m / 100).toLocaleString("en-US")}`;   // every price drawn in a 3D scene comes from the price list
import { dGeometry } from "./dshape.js";
import { toCreasedNormals } from "three/examples/jsm/utils/BufferGeometryUtils.js";

const C = (h) => new THREE.Color(h);
const mat = (color, o = {}) => new THREE.MeshPhysicalMaterial({ color: C(color), roughness: 0.42, metalness: 0, clearcoat: 0.25, clearcoatRoughness: 0.35, envMapIntensity: 0.9, ...o });
const metal = (color, o = {}) => mat(color, { metalness: 1, roughness: 0.28, clearcoat: 0.4, ...o });
const rbox = (w, h, d, r, m, seg = 4) => { const x = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, seg, r), m); x.castShadow = true; x.receiveShadow = true; return x; };
const cyl = (rt, rb, h, m, seg = 48) => { const x = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), m); x.castShadow = true; x.receiveShadow = true; return x; };
const tor = (R, t, m, arc = Math.PI * 2) => { const x = new THREE.Mesh(new THREE.TorusGeometry(R, t, 24, 96, arc), m); x.castShadow = true; x.receiveShadow = true; return x; };

// A canvas drawn once and used as a texture. `draw(ctx, w, h)`; sizes are in canvas pixels.
function tex(w, h, draw) {
  const c = document.createElement("canvas"); c.width = w; c.height = h; const x = c.getContext("2d"); draw(x, w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 16; return t;
}
const FONT = (w, px, f = "Geist") => `${w} ${px}px ${f}, system-ui, sans-serif`;
const MONO = (w, px) => `${w} ${px}px "JetBrains Mono", ui-monospace, monospace`;
function roundRect(x, X, Y, W, H, r) { x.beginPath(); x.moveTo(X + r, Y); x.arcTo(X + W, Y, X + W, Y + H, r); x.arcTo(X + W, Y + H, X, Y + H, r); x.arcTo(X, Y + H, X, Y, r); x.arcTo(X, Y, X + W, Y, r); x.closePath(); }

// A paper page: front texture with a title, text lines, an optional signature and fields.
function pageTexture({ title = "Agreement", accent = "#5a3ac1", sign = true, lines = 9, tick = null, seal = false } = {}) {
  return tex(640, 840, (x, w, h) => {
    x.fillStyle = "#fbfaf6"; x.fillRect(0, 0, w, h);
    x.fillStyle = "#8f8c9c"; x.font = MONO(600, 22); x.fillText("DOCUSTAY", 56, 78);
    x.fillStyle = "#17161f"; x.font = FONT(650, 50); x.fillText(title, 56, 148);
    const ws = [0.94, 0.88, 0.92, 0.7, 0.9, 0.62, 0.86, 0.76, 0.9, 0.5]; x.fillStyle = "#d8d4c8";
    for (let i = 0; i < lines; i++) x.fillRect(56, 196 + i * 40, (w - 112) * ws[i % ws.length], 12);
    if (tick) { tick.forEach((t, i) => { const Y = 196 + i * 70; x.strokeStyle = "#34323f"; x.lineWidth = 4; x.strokeRect(56, Y, 38, 38); if (t) { x.strokeStyle = accent; x.lineWidth = 8; x.beginPath(); x.moveTo(62, Y + 20); x.lineTo(75, Y + 33); x.lineTo(114, Y - 8); x.stroke(); } x.fillStyle = "#d8d4c8"; x.fillRect(126, Y + 12, 300 - i * 30, 12); }); }
    if (sign) { x.strokeStyle = accent; x.lineWidth = 3; x.setLineDash([12, 9]); x.strokeRect(56, h - 190, 240, 84); x.setLineDash([]); x.fillStyle = accent; x.font = "italic 64px 'Instrument Serif', Georgia, serif"; x.fillText("Rosa Alvarez", 76, h - 130); x.fillStyle = "#8f8c9c"; x.font = MONO(500, 20); x.fillText("SIGNED", 76, h - 116 + 22); }
    if (seal) { x.strokeStyle = accent; x.lineWidth = 6; x.beginPath(); x.arc(w - 130, h - 150, 56, 0, 7); x.stroke(); x.fillStyle = accent; x.font = MONO(700, 20); x.textAlign = "center"; x.fillText("SEALED", w - 130, h - 144); x.textAlign = "left"; }
  });
}
function page(w = 1.5, h = 1.95, o = {}) {
  const side = mat("#cfcabd", { roughness: 0.9 });
  const m = new THREE.Mesh(new RoundedBoxGeometry(w, h, 0.03, 3, 0.012), [side, side, side, side, mat("#ffffff", { map: pageTexture(o), roughness: 0.78, clearcoat: 0 }), mat("#f1eee4", { roughness: 0.85, clearcoat: 0 })]);
  m.castShadow = true; m.receiveShadow = true; return m;
}
function chip(text, w = 0.9, h = 0.26, bg = "#e3f2f3", fg = "#0b4f57", line = "#b6dade") {
  const m = mat("#ffffff", { map: tex(360, Math.round(360 * h / w), (x, W, H) => { x.fillStyle = bg; roundRect(x, 2, 2, W - 4, H - 4, H / 2); x.fill(); x.strokeStyle = line; x.lineWidth = 3; x.stroke(); x.fillStyle = fg; x.font = MONO(600, Math.round(H * 0.46)); x.textAlign = "center"; x.textBaseline = "middle"; x.fillText(text, W / 2, H / 2 + 2); }), roughness: 0.5, clearcoat: 0.3, transparent: true });
  const g = new THREE.Mesh(new THREE.PlaneGeometry(w, h), m); g.castShadow = false; return g;
}
const label = chip;
function stamped(g, y = 0) { g.position.y += y; return g; }

// ─── DEVELOPERS ───────────────────────────────────────────────────────────────────────────────────────────────
function packageBox() {
  const a = AREA.developers, g = new THREE.Group();
  const front = tex(900, 640, (x, w, h) => {
    x.fillStyle = "#ffffff"; x.fillRect(0, 0, w, h); x.fillStyle = a.accent; x.fillRect(0, 0, w, 14);
    x.fillStyle = "#16161d"; x.font = FONT(700, 74); x.fillText("docustay", 60, 130); x.fillStyle = a.accent; x.font = MONO(600, 30); x.fillText("SDK · 5 LANGUAGES", 62, 184);
    const L = ["JS", "TS", "PY", "GO", "PHP", "C#"]; let X = 60, Y = 270;
    L.forEach((t) => { x.font = MONO(700, 34); const W = x.measureText(t).width + 48; if (X + W > w - 50) { X = 60; Y += 92; } x.fillStyle = a.soft; roundRect(x, X, Y, W, 64, 32); x.fill(); x.strokeStyle = a.accent; x.lineWidth = 3; x.stroke(); x.fillStyle = a.accent; x.fillText(t, X + 24, Y + 44); X += W + 18; });
    x.fillStyle = "#4c4a5e"; x.font = MONO(500, 26); x.fillText("npm install ./sdk/js", 60, h - 58);
  });
  const side = mat("#dfe9eb", { roughness: 0.6 }), top = mat("#eef4f5", { roughness: 0.6 });
  const box = new THREE.Mesh(new RoundedBoxGeometry(2.4, 1.7, 1.5, 4, 0.04), [side, side, top, side, mat("#fff", { map: front, roughness: 0.55 }), side]); box.castShadow = true; box.receiveShadow = true; g.add(box);
  const tape = rbox(0.34, 0.012, 1.52, 0.004, mat(a.accent, { roughness: 0.35 })); tape.position.set(0, 0.856, 0); g.add(tape);
  g.rotation.y = -0.5; return g;
}
function keyObj(color = AREA.developers.accent, chips = true) {
  const g = new THREE.Group(), m = metal(color, { roughness: 0.22 });
  const ring = tor(0.5, 0.15, m); ring.position.set(-1.45, 0, 0); g.add(ring);
  const shaft = rbox(2.5, 0.2, 0.2, 0.08, m); shaft.position.set(0, 0, 0); g.add(shaft);
  [[0.55, 0.3], [0.86, 0.22], [1.12, 0.34]].forEach(([x, h]) => { const t = rbox(0.18, h + 0.1, 0.2, 0.04, m); t.position.set(x, -(0.1 + h / 2) + 0.05, 0); g.add(t); });
  g.rotation.z = -0.1; g.rotation.y = -0.4;
  const out = new THREE.Group(); out.add(g);
  if (chips) [["documents:read", 0], ["documents:write", 1], ["webhooks:read", 2]].forEach(([t, i]) => { const c = chip(t, 1.5, 0.28); c.position.set(-0.55 + i * 0.62, -0.95, 0.5 + i * 0.0); c.position.y = -0.82 - 0.0; c.position.x = -0.9 + i * 1.0; c.scale.setScalar(0.78); c.rotation.y = -0.25; out.add(c); });
  return out;
}
function envelope(accent = AREA.developers.accent) {
  const g = new THREE.Group();
  const body = rbox(2.4, 1.6, 0.08, 0.04, mat("#f6f4ee", { roughness: 0.7, clearcoat: 0.05 })); g.add(body);
  const flapShape = new THREE.Shape(); flapShape.moveTo(-1.2, 0.8); flapShape.lineTo(1.2, 0.8); flapShape.lineTo(0, -0.12); flapShape.closePath();
  const flap = new THREE.Mesh(new THREE.ExtrudeGeometry(flapShape, { depth: 0.02, bevelEnabled: false }), mat("#ebe8de", { roughness: 0.75, clearcoat: 0.05 })); flap.position.z = 0.045; flap.castShadow = true; g.add(flap);
  const seal = cyl(0.17, 0.17, 0.05, metal(accent, { roughness: 0.3 })); seal.rotation.x = Math.PI / 2; seal.position.set(0, -0.1, 0.1); g.add(seal);
  [0.55, 0.85, 1.15].forEach((r, i) => { const a = tor(r + 0.45, 0.022, mat(accent, { roughness: 0.4, transparent: true, opacity: 0.95 - i * 0.2 }), Math.PI * 0.55); a.position.set(1.28, 0.1, 0.05); a.rotation.z = -Math.PI * 0.275; g.add(a); });
  g.rotation.set(-0.12, -0.5, 0.06); return g;
}

// ─── TEMPLATES ────────────────────────────────────────────────────────────────────────────────────────────────
function padlock(color = AREA.templates.accent) {
  const g = new THREE.Group(), m = metal(color, { roughness: 0.3 });
  const pg = page(2.2, 2.9, { title: "NDA", accent: AREA.templates.accent, lines: 8 }); pg.rotation.set(-Math.PI / 2 + 0.0, 0, 0.12); pg.position.set(0, -0.62, 0); g.add(pg);
  const body = rbox(1.4, 1.1, 0.7, 0.14, m); body.position.y = 0; g.add(body);
  const sh = tor(0.42, 0.11, metal("#cfd3da", { roughness: 0.2 }), Math.PI); sh.position.set(0, 0.55, 0); g.add(sh);
  const sl = [-0.42, 0.42].map((x) => { const c = cyl(0.11, 0.11, 0.3, metal("#cfd3da", { roughness: 0.2 })); c.position.set(x, 0.42, 0); return c; }); sl.forEach((c) => g.add(c));
  const k = new THREE.Mesh(new THREE.CircleGeometry(0.1, 32), mat("#1b1306", { roughness: 1 })); k.position.set(0, 0.08, 0.352); g.add(k);
  const ks = rbox(0.07, 0.3, 0.02, 0.02, mat("#1b1306", { roughness: 1 })); ks.position.set(0, -0.12, 0.352); g.add(ks);
  g.position.y = 0.62; g.rotation.set(0.2, -0.5, 0); return g;
}
function clipboard() {
  const a = AREA.templates, g = new THREE.Group();
  const board = rbox(1.7, 2.3, 0.1, 0.08, mat("#b98a52", { roughness: 0.6, clearcoat: 0.15 })); g.add(board);
  const sheet = page(1.4, 1.9, { title: "Consent", accent: a.accent, sign: false, lines: 0, tick: [true, true, true, false] }); sheet.position.set(0, -0.08, 0.075); g.add(sheet);
  const clip = rbox(0.7, 0.3, 0.14, 0.05, metal("#c9ccd4", { roughness: 0.25 })); clip.position.set(0, 1.12, 0.12); g.add(clip);
  const knob = rbox(0.34, 0.1, 0.18, 0.04, metal("#9da2ad", { roughness: 0.3 })); knob.position.set(0, 1.28, 0.12); g.add(knob);
  g.rotation.set(-0.08, -0.4, 0.05); return g;
}
function badge() {
  const a = AREA.templates, g = new THREE.Group();
  const pg = page(1.6, 2.1, { title: "Offer letter", accent: a.accent, lines: 7 }); pg.position.set(0.5, -0.1, -0.2); pg.rotation.set(0, -0.25, 0.08); g.add(pg);
  const front = tex(520, 760, (x, w, h) => { x.fillStyle = "#ffffff"; roundRect(x, 0, 0, w, h, 38); x.fill(); x.fillStyle = a.accent; x.fillRect(0, 0, w, 120); x.fillStyle = "#ffffff"; x.font = FONT(700, 44); x.fillText("docustay", 40, 78); x.fillStyle = "#ecebf2"; x.beginPath(); x.arc(w / 2, 330, 128, 0, 7); x.fill(); x.fillStyle = "#9b98ad"; x.beginPath(); x.arc(w / 2, 300, 50, 0, 7); x.fill(); x.beginPath(); x.ellipse(w / 2, 410, 90, 64, 0, Math.PI, 0); x.fill(); x.fillStyle = "#16161d"; x.font = FONT(650, 46); x.textAlign = "center"; x.fillText("New hire", w / 2, 580); x.fillStyle = a.accent; x.font = MONO(600, 28); x.fillText("DAY ONE", w / 2, 640); });
  const card = new THREE.Mesh(new RoundedBoxGeometry(1.15, 1.68, 0.05, 4, 0.08), [mat("#e4e1f0"), mat("#e4e1f0"), mat("#e4e1f0"), mat("#e4e1f0"), mat("#fff", { map: front, roughness: 0.5 }), mat("#f3f2f7")]); card.castShadow = true; card.position.set(-0.55, 0.05, 0.25); card.rotation.set(0, 0.2, -0.05); g.add(card);
  const slot = rbox(0.34, 0.06, 0.06, 0.03, mat("#05060a")); slot.position.set(-0.55, 0.78, 0.29); slot.rotation.copy(card.rotation); g.add(slot);
  g.rotation.y = -0.2; return g;
}
function notebook() {
  const a = AREA.templates, g = new THREE.Group();
  const cover = tex(600, 800, (x, w, h) => { x.fillStyle = "#f6ecdf"; x.fillRect(0, 0, w, h); x.fillStyle = a.accent; x.fillRect(60, 0, 14, h); x.fillStyle = "#16161d"; x.font = FONT(650, 58); x.fillText("School year", 110, 150); x.fillStyle = a.accent; x.font = MONO(600, 28); x.fillText("2026 · 27", 112, 200); });
  const side = mat("#e8e3d6", { roughness: 0.9 });
  const nb = new THREE.Mesh(new RoundedBoxGeometry(1.5, 2.0, 0.22, 3, 0.03), [side, side, side, side, mat("#fff", { map: cover, roughness: 0.55 }), mat("#f6ecdf")]); nb.castShadow = true; g.add(nb);
  for (let i = 0; i < 8; i++) { const r = tor(0.07, 0.016, metal("#cfd3da", { roughness: 0.25 })); r.rotation.y = Math.PI / 2; r.position.set(-0.76, 0.78 - i * 0.22, 0.02); g.add(r); }
  const slip = page(1.25, 0.9, { title: "Permission", accent: a.accent, lines: 2, sign: true }); slip.rotation.set(-Math.PI / 2 + 0.1, 0, -0.35); slip.position.set(1.15, -0.98, 0.8); g.add(slip);
  g.rotation.set(-0.1, -0.5, 0); g.position.y = 0.0; return g;
}
function briefcase() {
  const a = AREA.templates, g = new THREE.Group();
  const leather = mat("#3a2a1e", { roughness: 0.5, clearcoat: 0.3 });
  const body = rbox(2.4, 1.6, 0.72, 0.12, leather); g.add(body);
  const seam = rbox(2.42, 0.03, 0.74, 0.01, mat("#2a1d14")); seam.position.y = 0.1; g.add(seam);
  const h = tor(0.36, 0.06, mat("#2a1d14", { roughness: 0.6 }), Math.PI); h.scale.set(1.2, 0.75, 1); h.position.set(0, 0.8, 0); g.add(h);
  [-0.65, 0.65].forEach((x) => { const l = rbox(0.28, 0.22, 0.08, 0.03, metal(a.accent, { roughness: 0.28 })); l.position.set(x, 0.1, 0.38); g.add(l); });
  const sow = page(1.5, 1.0, { title: "Statement of work", accent: a.accent, lines: 4 }); sow.position.set(0.1, 0.95, -0.1); sow.rotation.set(0.1, 0, 0.05); sow.scale.setScalar(0.8); g.add(sow);
  g.rotation.set(0.1, -0.55, 0); return g;
}
function penPage() {
  const a = AREA.templates, g = new THREE.Group();
  const pg = page(2.0, 2.6, { title: "Services agreement", accent: a.accent }); pg.rotation.set(-Math.PI / 2 + 0.0, 0, 0.1); g.add(pg);
  const pen = new THREE.Group(); const body = cyl(0.05, 0.05, 1.6, metal("#1b1e27", { roughness: 0.25 })); body.rotation.z = Math.PI / 2; pen.add(body);
  const nib = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.22, 24), metal("#d6b65a", { roughness: 0.2 })); nib.rotation.z = Math.PI / 2; nib.position.x = 0.9; nib.castShadow = true; pen.add(nib);
  const band = cyl(0.056, 0.056, 0.08, metal("#d6b65a", { roughness: 0.2 })); band.rotation.z = Math.PI / 2; band.position.x = -0.1; pen.add(band);
  pen.position.set(0.3, 0.12, 0.62); pen.rotation.set(0.0, 0.5, -0.12); g.add(pen);
  g.rotation.set(0.25, -0.35, 0); g.position.y = 0.6; return g;
}
function keyLease() {
  const g = new THREE.Group(), pg = page(1.9, 2.5, { title: "Lease addendum", accent: AREA.templates.accent }); pg.position.set(0.55, 0, -0.1); pg.rotation.set(0, -0.3, 0.05); g.add(pg);
  const k = keyObj(AREA.templates.accent, false); k.scale.setScalar(0.62); k.position.set(-0.75, -0.5, 0.45); g.add(k); return g;
}
function docStack() {
  const g = new THREE.Group(); const t = ["NDA", "Lease", "Offer", "Waiver", "Services"];
  t.forEach((n, i) => { const p = page(1.5, 1.95, { title: n, accent: AREA.templates.accent, lines: 7 }); p.position.set(i * 0.34 - 0.7, i * 0.07 - 0.1, -i * 0.12); p.rotation.set(-0.02, -0.12 + i * 0.02, 0.0); g.add(p); });
  g.rotation.y = -0.35; return g;
}
function formCard() {
  const a = AREA.templates, g = new THREE.Group();
  const f = tex(700, 900, (x, w, h) => { x.fillStyle = "#fbfaf6"; x.fillRect(0, 0, w, h); x.fillStyle = "#17161f"; x.font = FONT(650, 52); x.fillText("RSVP", 52, 100); x.fillStyle = "#8f8c9c"; x.font = FONT(500, 26); x.fillText("Tell us if you can come", 52, 146);
    [["Name", "Rosa Alvarez"], ["Email", "rosa@example.com"], ["Guests", "2"]].forEach(([k, v], i) => { const Y = 210 + i * 150; x.fillStyle = "#4a4858"; x.font = FONT(600, 26); x.fillText(k, 52, Y); x.strokeStyle = "#cfcabd"; x.lineWidth = 3; roundRect(x, 52, Y + 18, w - 104, 70, 10); x.stroke(); x.fillStyle = "#17161f"; x.font = FONT(500, 32); x.fillText(v, 74, Y + 64); });
    x.fillStyle = a.accent; roundRect(x, 52, h - 150, 220, 76, 38); x.fill(); x.fillStyle = "#fff"; x.font = FONT(650, 30); x.fillText("Send", 112, h - 102); });
  const side = mat("#cfcabd", { roughness: 0.9 }); const m = new THREE.Mesh(new RoundedBoxGeometry(1.7, 2.18, 0.05, 3, 0.04), [side, side, side, side, mat("#fff", { map: f, roughness: 0.7, clearcoat: 0 }), side]); m.castShadow = true; g.add(m);
  g.rotation.set(-0.05, -0.45, 0.03); return g;
}

// ─── SELF-HOST ───────────────────────────────────────────────────────────────────────────────────────────────
function containers() {
  const a = AREA.selfhost, g = new THREE.Group(), names = [["web", "1"], ["app", "2"], ["worker", "3"], ["db", "4"], ["storage", "5"], ["gotenberg", "6"]];
  names.forEach(([n], i) => {
    const front = tex(520, 300, (x, w, h) => { x.fillStyle = "#ffffff"; x.fillRect(0, 0, w, h); x.fillStyle = a.accent; x.fillRect(0, 0, 18, h); x.fillStyle = "#16161d"; x.font = MONO(700, 66); x.fillText(n, 56, 150); x.fillStyle = "#4c4a5e"; x.font = MONO(500, 28); x.fillText("container " + (i + 1), 58, 206); x.fillStyle = a.accent; x.beginPath(); x.arc(w - 60, 56, 14, 0, 7); x.fill(); });
    const side = mat("#dcebe2", { roughness: 0.55 });
    const b = new THREE.Mesh(new RoundedBoxGeometry(1.5, 0.86, 0.9, 3, 0.04), [side, side, side, side, mat("#fff", { map: front, roughness: 0.5 }), side]); b.castShadow = true; b.receiveShadow = true;
    const col = i % 3, row = Math.floor(i / 3); b.position.set(col * 1.62 - 1.62, row * 0.92, -row * 0.0); g.add(b);
  });
  g.position.y = 0.0; g.rotation.set(0.0, -0.5, 0); return g;
}
function backupFolder() {
  const a = AREA.selfhost, g = new THREE.Group(), fm = mat("#cfe5d8", { roughness: 0.5 });
  const back = rbox(2.5, 1.7, 0.1, 0.05, fm); back.position.set(0, 0, -0.05); g.add(back);
  const tab = rbox(0.9, 0.2, 0.1, 0.05, fm); tab.position.set(-0.8, 0.9, -0.05); g.add(tab);
  const sheet = page(2.2, 1.5, { title: "Backup", accent: a.accent, lines: 4, sign: false }); sheet.position.set(0, 0.12, 0.02); g.add(sheet);
  const fr = tex(900, 560, (x, w, h) => { x.fillStyle = "#e2f1e8"; x.fillRect(0, 0, w, h); x.fillStyle = a.accent; x.fillRect(0, 0, w, 10); x.fillStyle = "#16161d"; x.font = MONO(700, 56); x.fillText("2026-10-14", 56, 150); x.fillStyle = "#1c7448"; x.font = MONO(500, 34); x.fillText("db.sql.gz · files.tar", 58, 214); x.fillText("verified restore: ok", 58, 270); });
  const front = new THREE.Mesh(new RoundedBoxGeometry(2.5, 1.25, 0.08, 3, 0.05), [fm, fm, fm, fm, mat("#fff", { map: fr, roughness: 0.55 }), fm]); front.position.set(0, -0.2, 0.18); front.castShadow = true; g.add(front);
  g.rotation.set(-0.1, -0.45, 0); return g;
}
function lockCard() {
  const a = AREA.selfhost, g = new THREE.Group();
  const f = tex(700, 460, (x, w, h) => { x.fillStyle = "#ffffff"; x.fillRect(0, 0, w, h); x.fillStyle = "#16161d"; x.font = FONT(650, 44); x.fillText("Sign in", 48, 90); x.strokeStyle = "#cfd8d3"; x.lineWidth = 3; roundRect(x, 48, 130, w - 96, 70, 12); x.stroke(); x.fillStyle = "#4c4a5e"; x.font = FONT(500, 28); x.fillText("rosa@example.com", 70, 175); x.fillStyle = a.accent; roundRect(x, 48, 250, w - 96, 84, 14); x.fill(); x.fillStyle = "#ffffff"; x.font = FONT(700, 32); x.fillText("Continue with SSO", 150, 304); });
  const sd = mat("#e2e8e4"); const card = new THREE.Mesh(new RoundedBoxGeometry(2.3, 1.5, 0.06, 4, 0.09), [sd, sd, sd, sd, mat("#fff", { map: f, roughness: 0.5 }), sd]); card.castShadow = true; card.position.set(0.5, -0.3, -0.2); card.rotation.set(0, -0.2, 0); g.add(card);
  const lk = padlock(a.accent); lk.children.forEach((c) => { if (c.geometry && c.geometry.type === "BoxGeometry") {} }); lk.remove(lk.children[0]); lk.scale.setScalar(0.75); lk.position.set(-0.7, 0.1, 0.5); g.add(lk);
  g.rotation.y = -0.3; return g;
}
function licenceCard(kind = "agpl") {
  const a = AREA.selfhost, g = new THREE.Group();
  const T = { agpl: ["Community", "AGPL-3.0", "Free to run, change and share. Source stays open.", a.accent], pro: ["Self-host Pro", `${usd(PRICES.selfhost.proYearlyMinor)} / year`, "One licence per install. Support and updates.", "#4c4a5e"], commercial: ["Commercial", `from about ${usd(PRICES.selfhost.commercialFromMinor)} / year`, "No AGPL conditions. Priced by use.", "#8a5208"] }[kind];
  const f = tex(1000, 640, (x, w, h) => { x.fillStyle = "#ffffff"; x.fillRect(0, 0, w, h); x.fillStyle = T[3]; x.fillRect(0, 0, w, 16); x.fillStyle = "#16161d"; x.font = MONO(600, 34); x.fillText("DOCUSTAY LICENCE", 60, 100); x.font = FONT(650, 78); x.fillText(T[0], 60, 220); x.fillStyle = T[3]; x.font = FONT(700, kind === "commercial" ? 58 : 92); x.fillText(T[1], 60, 340); x.fillStyle = "#4c4a5e"; x.font = FONT(500, 32); x.fillText(T[2], 60, 430); x.strokeStyle = "#e4e1f0"; x.lineWidth = 3; x.strokeRect(60, 500, w - 120, 0); x.fillStyle = "#6b6880"; x.font = MONO(500, 26); x.fillText("licence-" + kind + ".txt", 60, 580); });
  const sd = mat("#e4e1f0"); const card = new THREE.Mesh(new RoundedBoxGeometry(2.6, 1.66, 0.06, 4, 0.1), [sd, sd, sd, sd, mat("#fff", { map: f, roughness: 0.45, clearcoat: 0.4 }), sd]); card.castShadow = true; g.add(card);
  g.rotation.set(-0.25, -0.5, 0.04); return g;
}

// ─── PRICING ─────────────────────────────────────────────────────────────────────────────────────────────────
function priceCards() {
  // Pro shows what the plan card beside it charges, from the one price list, never a typed number
  const proMinor = PRICES.pro.monthlyMinor;
  const a = AREA.pricing, g = new THREE.Group(), items = [["Free", "$0", 0.03], ["Pro", `${usd(proMinor)} / mo`, 0.09], ["Self-host", `${usd(PRICES.selfhost.proYearlyMinor)} / yr`, 0.17]];
  items.forEach(([n, p, d], i) => {
    const f = tex(640, 880, (x, w, h) => { x.fillStyle = "#ffffff"; x.fillRect(0, 0, w, h); x.fillStyle = a.edge; x.fillRect(0, 0, w, 14); x.fillStyle = "#16161d"; x.font = FONT(650, 70); x.fillText(n, 50, 140); x.fillStyle = "#5a3ac1"; x.font = FONT(700, 54); x.fillText(p, 50, 240); x.fillStyle = "#e4e1f0"; for (let k = 0; k < 5; k++) x.fillRect(50, 330 + k * 56, 380 - k * 24, 12); });
    const side = mat("#c9cdd6", { metalness: 0.85, roughness: 0.28 }); const edge = mat(a.edge, { metalness: 0.5, roughness: 0.3 });
    const c = new THREE.Mesh(new RoundedBoxGeometry(1.4, 1.9, d, 3, Math.min(0.02, d / 2.2)), [edge, edge, side, side, mat("#fff", { map: f, roughness: 0.5, clearcoat: 0.35 }), side]); c.castShadow = true; c.receiveShadow = true;
    c.position.set(i * 1.45 - 1.45, d / 2, i * -0.05); c.rotation.y = -0.12; g.add(c);
  });
  g.rotation.set(-0.12, -0.4, 0); return g;
}

// ─── TRUST ───────────────────────────────────────────────────────────────────────────────────────────────────
function magnifier() {
  const a = AREA.trust, g = new THREE.Group();
  const pg = page(2.2, 2.9, { title: "Contract", accent: a.accent, seal: true }); pg.rotation.set(-Math.PI / 2, 0, 0.05); g.add(pg);
  const lens = new THREE.Group();
  const ring = tor(0.8, 0.08, metal("#cfd3da", { roughness: 0.22 })); lens.add(ring);
  const glass = new THREE.Mesh(new THREE.CircleGeometry(0.78, 64), new THREE.MeshPhysicalMaterial({ color: "#d8f3e8", roughness: 0, metalness: 0, transmission: 0.9, thickness: 0.2, ior: 1.2, transparent: true, opacity: 0.22 })); lens.add(glass);
  const handle = cyl(0.075, 0.095, 1.2, mat(a.accent, { roughness: 0.35 })); handle.position.set(0.98, -0.98, 0); handle.rotation.z = Math.PI / 4; lens.add(handle);
  lens.position.set(-0.1, 0.9, 0.2); lens.rotation.set(-0.95, 0, 0); g.add(lens);
  g.rotation.set(0.35, -0.3, 0); g.position.y = 0.2; return g;
}
function sealCoin() {
  const a = AREA.trust, g = new THREE.Group();
  const face = tex(512, 512, (x, w, h) => { x.fillStyle = "#ffffff"; x.fillRect(0, 0, w, h); x.strokeStyle = a.accent; x.lineWidth = 10; x.beginPath(); x.arc(w / 2, h / 2, 214, 0, 7); x.stroke(); x.lineWidth = 4; x.beginPath(); x.arc(w / 2, h / 2, 188, 0, 7); x.stroke(); x.fillStyle = a.accent; x.font = MONO(700, 40); x.textAlign = "center"; x.fillText("SEALED · SHA-256", w / 2, 128); x.lineWidth = 28; x.lineCap = "round"; x.lineJoin = "round"; x.strokeStyle = a.accent; x.beginPath(); x.moveTo(166, 266); x.lineTo(232, 332); x.lineTo(352, 196); x.stroke(); x.font = MONO(500, 34); x.fillText("docustay.app/verify", w / 2, 420); });
  const rim = metal(a.accent, { roughness: 0.25 }), faceM = mat("#fff", { map: face, roughness: 0.4, clearcoat: 0.6 });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 0.2, 96, 1, true), rim); body.rotation.x = Math.PI / 2; body.castShadow = true; g.add(body);
  const fr = new THREE.Mesh(new THREE.CircleGeometry(1.2, 96), faceM); fr.position.z = 0.1; fr.castShadow = true; g.add(fr);
  const bk = new THREE.Mesh(new THREE.CircleGeometry(1.2, 96), mat("#e1f0e9")); bk.position.z = -0.1; bk.rotation.y = Math.PI; g.add(bk);
  const r1 = tor(1.2, 0.07, rim); r1.position.z = 0.1; g.add(r1); const r2 = tor(1.2, 0.07, rim); r2.position.z = -0.1; g.add(r2);
  g.rotation.set(-0.12, -0.45, 0); g.position.y = 1.2; return g;
}
// ─── MISC ────────────────────────────────────────────────────────────────────────────────────────────────────
function contactEnvelope() { const e = envelope("#9aa0ab"); e.rotation.set(-0.15, 0.4, -0.05); e.children.splice(3).forEach((c) => c.removeFromParent()); return e; }
function testPaper() {
  const a = AREA.developers, g = new THREE.Group();
  const pg = page(1.7, 2.2, { title: "Services agreement", accent: a.accent }); g.add(pg);
  const st = tex(560, 220, (x, w, h) => { x.translate(w / 2, h / 2); x.rotate(-0.18); x.strokeStyle = "#d94a4a"; x.lineWidth = 12; roundRect(x, -240, -80, 480, 160, 22); x.stroke(); x.fillStyle = "#d94a4a"; x.font = MONO(800, 110); x.textAlign = "center"; x.textBaseline = "middle"; x.fillText("TEST", 0, 8); });
  const s = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.59), mat("#fff", { map: st, transparent: true, roughness: 0.9, clearcoat: 0 })); s.position.set(0.05, 0.1, 0.02); g.add(s);
  g.rotation.set(-0.05, -0.4, 0.02); return g;
}


// The Docustay D, polished violet (no glow on the cream page) (the still behind the live home object, and its model: d-live.js builds the same mesh).
export function brandD() {
  const geo = toCreasedNormals(dGeometry(26), Math.PI / 6);
  const g = new THREE.Group(), m = new THREE.Mesh(geo, mat("#5a3ac1", { metalness: 0.2, roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.06, envMapIntensity: 1.4 }));
  m.scale.y = -1; m.castShadow = true; m.receiveShadow = true; m.position.y = 1.0; g.add(m); g.rotation.set(-0.08, -0.32, 0); return g;
}

export const OBJECTS = {
  D: brandD,
  package: packageBox, key: () => keyObj(), envelope: () => envelope(), "envelope-neutral": contactEnvelope, padlock: () => padlock(), clipboard, badge, notebook, briefcase, "pen-page": penPage, "key-lease": keyLease,
  "doc-stack": docStack, "form-card": formCard, containers, "backup-folder": backupFolder, "lock-card": lockCard, "licence-agpl": () => licenceCard("agpl"), "licence-pro": () => licenceCard("pro"),
  "licence-commercial": () => licenceCard("commercial"), "price-cards": priceCards, magnifier, seal: sealCoin, "test-paper": testPaper,
};

// One still: transparent background, soft area-like light from the upper left, a soft contact shadow, nothing else. `scale` multiplies the canvas for supersampling.
export function renderStill(canvas, name, { width = 1040, height = 800, scale = 1 } = {}) {
  const R = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true, powerPreference: "high-performance" });
  R.setPixelRatio(1); R.setSize(width * scale, height * scale, false); R.setClearColor(0x000000, 0);
  R.outputColorSpace = THREE.SRGBColorSpace; R.toneMapping = THREE.ACESFilmicToneMapping; R.toneMappingExposure = 1.0;
  R.shadowMap.enabled = true; R.shadowMap.type = THREE.VSMShadowMap;
  const scene = new THREE.Scene(); const pm = new THREE.PMREMGenerator(R); scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture; scene.environmentIntensity = 0.55;
  const obj = OBJECTS[name](); if (!obj) throw new Error("no object " + name); scene.add(obj);
  obj.updateMatrixWorld(true); const box = new THREE.Box3().setFromObject(obj), size = box.getSize(new THREE.Vector3()), ctr = box.getCenter(new THREE.Vector3());
  const key = new THREE.DirectionalLight(0xfff6ee, 2.6); key.position.set(ctr.x - 3.5, box.max.y + 6, ctr.z + 4); key.target.position.copy(ctr); key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048); key.shadow.radius = 14; key.shadow.blurSamples = 25; key.shadow.bias = -0.0004; const sc = Math.max(size.x, size.y, size.z) * 1.4; Object.assign(key.shadow.camera, { left: -sc, right: sc, top: sc, bottom: -sc, near: 0.1, far: 30 }); scene.add(key, key.target);
  const fill = new THREE.DirectionalLight(0xdfe8ff, 0.7); fill.position.set(ctr.x + 4, box.max.y + 2, ctr.z + 3); scene.add(fill);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.ShadowMaterial({ opacity: 0.22, color: 0x3c288c })); floor.rotation.x = -Math.PI / 2; floor.position.y = box.min.y - 0.002; floor.receiveShadow = true; scene.add(floor);
  const cam = new THREE.PerspectiveCamera(22, width / height, 0.1, 100); const dir = new THREE.Vector3(0.28, 0.42, 1).normalize();
  let dist = Math.max(size.x, size.y, size.z) * 3.2; const corners = []; for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) corners.push(new THREE.Vector3(x, y, z));
  const place = () => { cam.position.copy(ctr).addScaledVector(dir, dist); cam.lookAt(ctr); cam.updateProjectionMatrix(); cam.updateMatrixWorld(true); };
  const ext = () => { let a = 9, b = 9, c = -9, d = -9; for (const p of corners) { const q = p.clone().project(cam); a = Math.min(a, q.x); b = Math.min(b, q.y); c = Math.max(c, q.x); d = Math.max(d, q.y); } return [a, b, c, d]; };
  for (let i = 0; i < 6; i++) { place(); const [a, b, c, d] = ext(); dist *= Math.max((c - a) / (2 * 0.84), (d - b) / (2 * 0.8)); }
  place(); const [ea, eb, ec, ed] = ext(); const ox = ((ea + ec) / 2) * width / 2, oy = ((eb + ed) / 2) * height / 2; cam.setViewOffset(width, height, ox, -oy, width, height);
  R.render(scene, cam); R.render(scene, cam);
  return { dispose: () => { R.dispose(); } };
}
