// The doodle engine: turns a few simple shapes into loose, wobbly, hand-inked line art with misregistered colour blocks behind it.
// Pure functions, no dependencies, no randomness at run time: every wobble comes from a seed made from the drawing's name, so the server and the browser draw exactly the same picture.
// A drawing is { blocks: [[colour, shape], ...], ink: [shape, ...], w, h }; a shape is a plain object made with the helpers in library.js (L, P, S, Z, Q, C, E, A, D, R).
// Method: sample the shape every ~2.4 units, push each sample sideways by a slow wobble (two sine waves with seeded phase) so lines drift like a hand, overshoot open strokes at both ends, leave a small gap or overlap where a closed shape meets itself, and draw every stroke twice (a bold pass and a thin pass with a different wobble) so the weight varies like a marker.

const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i += 1) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
const rng = (seed) => () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const r1 = (n) => Math.round(n * 10) / 10;

/** Catmull-Rom spline through the points, sampled densely. */
function spline(pts, closed) {
  const n = pts.length, out = []; const at = (i) => pts[closed ? (i + n) % n : Math.max(0, Math.min(n - 1, i))];
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i += 1) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    const len = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]), steps = Math.max(3, Math.round(len / 2.4));
    for (let s = 0; s < steps; s += 1) {
      const t = s / steps, t2 = t * t, t3 = t2 * t;
      out.push([0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3), 0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3)]);
    }
  }
  if (!closed) out.push(pts[n - 1]); else out.push(out[0]);
  return out;
}
/** A polyline sampled every ~2.4 units, corners kept. */
function sampleLine(pts, closed) {
  const list = closed ? [...pts, pts[0]] : pts, out = [];
  for (let i = 0; i < list.length - 1; i += 1) { const a = list[i], b = list[i + 1], len = Math.hypot(b[0] - a[0], b[1] - a[1]), steps = Math.max(1, Math.round(len / 2.4)); for (let s = 0; s < steps; s += 1) out.push([a[0] + (b[0] - a[0]) * s / steps, a[1] + (b[1] - a[1]) * s / steps]); }
  out.push(list[list.length - 1]); return out;
}
function ellipse(cx, cy, rx, ry, rot = 0, a0 = 0, a1 = 360) {
  const out = [], span = a1 - a0, steps = Math.max(10, Math.round(Math.PI * (rx + ry) * Math.abs(span) / 360 / 2.4)), cr = Math.cos(rot * Math.PI / 180), sr = Math.sin(rot * Math.PI / 180);
  for (let i = 0; i <= steps; i += 1) { const a = (a0 + span * i / steps) * Math.PI / 180, x = Math.cos(a) * rx, y = Math.sin(a) * ry; out.push([cx + x * cr - y * sr, cy + x * sr + y * cr]); }
  return out;
}
/** The raw points of a shape before any wobble. */
export function basePoints(shape) {
  switch (shape.k) {
    case "l": return sampleLine(shape.p, shape.closed);
    case "s": return spline(shape.p, shape.closed);
    case "e": { const [cx, cy, rx, ry] = shape.c; return ellipse(cx, cy, rx, ry, shape.rot ?? 0); }
    case "a": { const [cx, cy, r, a0, a1] = shape.c; return ellipse(cx, cy, r, r, 0, a0, a1); }
    case "d": { const [cx, cy, r] = shape.c; return ellipse(cx, cy, r, r); }
    default: return [];
  }
}
/** Push every point sideways by a slow wobble, overshoot open ends, and leave closed shapes slightly un-joined. */
function wobble(pts, shape, rand, amp) {
  const n = pts.length; if (n < 3) return pts;
  const closed = shape.closed || shape.k === "e" || shape.k === "d";
  const f1 = 0.8 + rand() * 1.2, f2 = 2.2 + rand() * 1.6, p1 = rand() * 6.28, p2 = rand() * 6.28, a1 = amp * (0.8 + rand() * 0.6), a2 = amp * 0.32;
  const out = pts.map((p, i) => {
    const t = i / (n - 1), prev = pts[Math.max(0, i - 1)], next = pts[Math.min(n - 1, i + 1)];
    let dx = next[0] - prev[0], dy = next[1] - prev[1]; const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
    const d = a1 * Math.sin(6.283 * f1 * t + p1) + a2 * Math.sin(6.283 * f2 * t + p2);
    return [p[0] - dy * d, p[1] + dx * d];
  });
  if (!closed) {   // overshoot both ends of an open stroke by 1.5 to 3 units, the way a pen runs past where it meant to stop
    const k = amp / 0.95, o1 = (1.5 + rand() * 1.5) * k, o2 = (1.5 + rand() * 1.5) * k, a = out[0], b = out[1], c = out[n - 2], d = out[n - 1];
    const la = Math.hypot(a[0] - b[0], a[1] - b[1]) || 1, lb = Math.hypot(d[0] - c[0], d[1] - c[1]) || 1;
    out.unshift([a[0] + (a[0] - b[0]) / la * o1, a[1] + (a[1] - b[1]) / la * o1]); out.push([d[0] + (d[0] - c[0]) / lb * o2, d[1] + (d[1] - c[1]) / lb * o2]);
  } else { const gap = rand() < 0.5 ? 1 : -1, last = out[out.length - 1], first = out[0]; out[out.length - 1] = [last[0] + (first[0] - last[0]) * (gap > 0 ? 0.7 : 1.08), last[1] + (first[1] - last[1]) * (gap > 0 ? 0.7 : 1.08)]; }
  return out;
}
// Ramer-Douglas-Peucker: the wobble is sampled every 2.4 units, which is far more points than the eye can tell apart; dropping the ones within EPS of a straight run cuts the page weight by about 60% (measured: home HTML).
const EPS = 0.3;
function simplify(pts) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1; const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop(); let worst = 0, at = -1; const [ax, ay] = pts[a], [bx, by] = pts[b], dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1;
    for (let i = a + 1; i < b; i += 1) { const d = Math.abs(dy * (pts[i][0] - ax) - dx * (pts[i][1] - ay)) / len; if (d > worst) { worst = d; at = i; } }
    if (worst > EPS && at > 0) { keep[at] = 1; stack.push([a, at], [at, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}
const toPath = (all, close) => { const pts = simplify(all); let d = `M${r1(pts[0][0])} ${r1(pts[0][1])}`; for (let i = 1; i < pts.length; i += 1) d += `L${r1(pts[i][0])} ${r1(pts[i][1])}`; return close ? d + "Z" : d; };

/** One ink stroke → the paths that draw it: a bold pass and a thin pass (different wobble), so the weight varies like a marker. A dot is a small filled scribble. */
export function inkPaths(shape, seed, wobbleAmp = 0.95) {
  const rand = rng(hash(seed)); const base = basePoints(shape);
  if (shape.k === "d") { const p = wobble(base, shape, rand, 0.3); return [{ d: toPath(p, true), cls: "dot" }]; }
  const a = wobble(base, shape, rand, wobbleAmp), b = wobble(base, shape, rng(hash(seed + "b")), wobbleAmp * 0.8).map((p) => [p[0] + 0.55, p[1] - 0.45]);
  return [{ d: toPath(a, false), cls: "ink" }, { d: toPath(b, false), cls: "ink2" }];
}
/** A colour block: a filled, extra-wobbly shape, nudged away from the ink like a misregistered print. */
export function blockPath(shape, seed) {
  const rand = rng(hash(seed)); const p = wobble(basePoints({ ...shape, closed: true }), { ...shape, closed: true }, rand, 1.8).map((q) => [q[0] + 2.2, q[1] + 2.6]);
  return toPath(p, true);
}
/** Everything a component needs to draw a doodle: ordered paths with their kind, colour and draw-in index. */
export function drawing(name, def) {
  const out = []; let k = 0;
  (def.blocks ?? []).forEach(([colour, shape], i) => out.push({ d: blockPath(shape, `${name}:blk${i}`), cls: "blk", colour, k: 0 }));
  (def.ink ?? []).forEach((shape, i) => { k += 1; for (const p of inkPaths(shape, `${name}:ink${i}`, def.wobble)) out.push({ ...p, k }); });
  return { paths: out, strokes: k, w: def.w ?? 100, h: def.h ?? 100 };
}
