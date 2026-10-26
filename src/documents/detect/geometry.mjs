// PDF FIELD DETECTION · THE PAGE PICTURE (PDF-FIELD-DETECTION-SPEC §4.3–§4.4). Finds the blanks a person would write on: long horizontal lines, empty rectangles and table cells, small square checkboxes and coloured "sign here" bars.
// Pure JavaScript over a rendered page (RGBA): adaptive threshold → deskew → run-length lines → flood-filled cells → corner-checked checkboxes. No native library, no model, nothing leaves the machine.
// Input  { w, h, rgba }   Output { skew, lines:[{x,y,w,t}], cells:[{x,y,w,h,empty}], checks:[{x,y,w,h}], bars:[{x,y,w,h}] } in pixels of the INPUT image.

const clampI = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

function grayOf(w, h, rgba) {
  const g = new Uint8Array(w * h);
  for (let i = 0, j = 0; i < g.length; i += 1, j += 4) g[i] = (rgba[j] * 77 + rgba[j + 1] * 151 + rgba[j + 2] * 28) >> 8;
  return g;
}

/** Dark = clearly darker than its own neighbourhood (a shadow across the page does not matter) and not paper. */
function threshold(w, h, g) {
  const ii = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y += 1) { let row = 0; for (let x = 0; x < w; x += 1) { row += g[y * w + x]; ii[(y + 1) * (w + 1) + x + 1] = ii[y * (w + 1) + x + 1] + row; } }
  const r = Math.max(8, Math.round(Math.min(w, h) / 50)), dark = new Uint8Array(w * h);
  for (let y = 0; y < h; y += 1) {
    const y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x += 1) {
      const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1);
      const sum = ii[y1 * (w + 1) + x1] - ii[y0 * (w + 1) + x1] - ii[y1 * (w + 1) + x0] + ii[y0 * (w + 1) + x0];
      const mean = sum / ((x1 - x0) * (y1 - y0)), v = g[y * w + x];
      if (v < 205 && v < mean - 30) dark[y * w + x] = 1;
    }
  }
  return dark;
}

/** The small tilt of a scan, found as the angle at which the rows of ink are most sharply separated. Returns degrees (positive = clockwise). */
function skewOf(w, h, dark) {
  const pts = []; const step = Math.max(1, Math.floor((w * h) / 150000));
  for (let i = 0, n = 0; i < dark.length; i += 1) if (dark[i] && (n++ % step === 0)) pts.push(i);
  if (pts.length < 200) return 0;
  const best = { a: 0, score: -1 }; let flat = 0;
  for (let a = -3; a <= 3.001; a += 0.25) {
    const s = Math.sin((a * Math.PI) / 180), c = Math.cos((a * Math.PI) / 180), bins = new Float64Array(h * 2 + 8);
    for (const p of pts) { const x = p % w, y = (p / w) | 0; const yy = Math.round(y * c - x * s + h * 0.5); if (yy >= 0 && yy < bins.length) bins[yy] += 1; }
    let sq = 0; for (let i = 1; i < bins.length; i += 1) { const d = bins[i] - bins[i - 1]; sq += d * d; }
    if (Math.abs(a) < 1e-9) flat = sq;
    if (sq > best.score) { best.score = sq; best.a = a; }
  }
  return best.score > flat * 1.12 ? best.a : 0;                      // a page that is already straight must stay as it is
}

function rotateGray(w, h, g, deg) {
  if (Math.abs(deg) < 0.2) return g;
  const out = new Uint8Array(w * h).fill(255), s = Math.sin((deg * Math.PI) / 180), c = Math.cos((deg * Math.PI) / 180), cx = w / 2, cy = h / 2;
  // output (x,y) takes the input point that the tilt moved there, read with bilinear weights so a thin line keeps its thickness
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) {
    const dx = x - cx, dy = y - cy, sx = cx + dx * c - dy * s, sy = cy + dx * s + dy * c;
    const x0 = Math.floor(sx), y0 = Math.floor(sy); if (x0 < 0 || y0 < 0 || x0 >= w - 1 || y0 >= h - 1) continue;
    const fx = sx - x0, fy = sy - y0, i = y0 * w + x0;
    out[y * w + x] = g[i] * (1 - fx) * (1 - fy) + g[i + 1] * fx * (1 - fy) + g[i + w] * (1 - fx) * fy + g[i + w + 1] * fx * fy;
  }
  return out;
}
/** A point in the straightened picture → the same point in the picture as it was given. */
const back = (x, y, w, h, deg) => {
  if (Math.abs(deg) < 0.2) return [x, y];
  const s = Math.sin((deg * Math.PI) / 180), c = Math.cos((deg * Math.PI) / 180), dx = x - w / 2, dy = y - h / 2;
  return [w / 2 + dx * c - dy * s, h / 2 + dx * s + dy * c];
};

/** Horizontal runs of ink (gaps of up to 2 px tolerated), merged downwards into lines. */
function hLines(w, h, dark, minLen, maxThick) {
  const open = []; const done = [];
  let prev = [];
  for (let y = 0; y < h; y += 1) {
    const runs = []; let x = 0; const base = y * w;
    while (x < w) {
      if (!dark[base + x]) { x += 1; continue; }
      let x1 = x, gap = 0;
      while (x1 + 1 < w) { if (dark[base + x1 + 1]) { x1 += 1; gap = 0; } else if (gap < 2 && x1 + 2 < w && dark[base + x1 + 2]) { x1 += 2; gap = 1; } else break; }
      if (x1 - x + 1 >= Math.min(minLen, 14)) runs.push([x, x1]);       // short pieces are kept for now: a step in a tilted line cuts it into pieces that only add up
      x = x1 + 1;
    }
    const next = [];
    for (const r of runs) {
      const m = prev.find((p) => !p.used && (Math.min(p.x1, r[1]) - Math.max(p.x0, r[0]) >= 0.7 * Math.min(p.x1 - p.x0, r[1] - r[0]))) ?? prev.find((p) => !p.used && p.y1 === y - 1 && p.rows <= 3 && (Math.abs(r[0] - p.x1) <= 3 || Math.abs(p.x0 - r[1]) <= 3));
      if (m) { m.used = true; m.x0 = Math.min(m.x0, r[0]); m.x1 = Math.max(m.x1, r[1]); m.y1 = y; m.rows += 1; next.push(m); }
      else next.push({ x0: r[0], x1: r[1], y0: y, y1: y, rows: 1, used: false });
    }
    for (const p of prev) if (!next.includes(p)) done.push(p);
    for (const n of next) n.used = false;
    prev = next;
  }
  for (const p of prev) done.push(p);
  const lines = done.filter((l) => l.rows <= maxThick).map((l) => ({ x: l.x0, y: (l.y0 + l.y1) / 2, w: l.x1 - l.x0 + 1, t: l.rows })).sort((a, b) => a.x - b.x);
  // pieces of one line that a speck or a step cut apart: same height (within 2 px), a gap of a few pixels
  const merged = [];
  for (const l of lines) { const m = merged.find((q) => Math.abs(q.y - l.y) <= 2 && l.x - (q.x + q.w) <= 8 && l.x >= q.x); if (m) { const x1 = Math.max(m.x + m.w, l.x + l.w); m.y = (m.y * m.w + l.y * l.w) / (m.w + l.w); m.w = x1 - m.x; m.t = Math.max(m.t, l.t); } else merged.push({ ...l }); }
  return merged.filter((l) => l.w >= minLen);
}

/** Vertical runs, the same way, only to complete the walls of boxes and tables. */
function vLines(w, h, dark, minLen, maxThick) {
  const t = new Uint8Array(w * h);
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) t[x * h + y] = dark[y * w + x];
  return hLines(h, w, t, minLen, maxThick).map((l) => ({ x: l.y, y: l.x, h: l.w, t: l.t }));   // transposed back: (x = column, y = start row, h = length)
}

/** Empty rectangles and table cells: regions closed in by long lines, found by flood fill over everything that is not a wall. */
function cellsOf(w, h, dark, hl, vl) {
  const wall = new Uint8Array(w * h);
  for (const l of hl) { const y0 = Math.max(0, Math.floor(l.y - l.t / 2) - 0), y1 = Math.min(h - 1, Math.ceil(l.y + l.t / 2)); for (let y = y0; y <= y1; y += 1) wall.fill(1, y * w + l.x, y * w + Math.min(w, l.x + l.w)); }
  for (const l of vl) { const x0 = Math.max(0, Math.floor(l.x - l.t / 2)), x1 = Math.min(w - 1, Math.ceil(l.x + l.t / 2)); for (let y = l.y; y < Math.min(h, l.y + l.h); y += 1) wall.fill(1, y * w + x0, y * w + x1 + 1); }
  // grow the walls by 1 px so a small break at a corner does not let a cell leak into its neighbour
  const grown = new Uint8Array(wall);
  for (let y = 1; y < h - 1; y += 1) for (let x = 1; x < w - 1; x += 1) if (wall[y * w + x]) { grown[y * w + x - 1] = 1; grown[y * w + x + 1] = 1; grown[(y - 1) * w + x] = 1; grown[(y + 1) * w + x] = 1; }
  const seen = new Uint8Array(w * h), stack = new Int32Array(w * h), out = [];
  for (let s = 0; s < w * h; s += 1) {
    if (grown[s] || seen[s]) continue;
    let sp = 0, area = 0, x0 = w, y0 = h, x1 = 0, y1 = 0, open = false;
    stack[sp++] = s; seen[s] = 1;
    while (sp) {
      const p = stack[--sp], x = p % w, y = (p / w) | 0; area += 1;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) open = true;
      if (x > 0 && !grown[p - 1] && !seen[p - 1]) { seen[p - 1] = 1; stack[sp++] = p - 1; }
      if (x < w - 1 && !grown[p + 1] && !seen[p + 1]) { seen[p + 1] = 1; stack[sp++] = p + 1; }
      if (y > 0 && !grown[p - w] && !seen[p - w]) { seen[p - w] = 1; stack[sp++] = p - w; }
      if (y < h - 1 && !grown[p + w] && !seen[p + w]) { seen[p + w] = 1; stack[sp++] = p + w; }
    }
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
    if (open || bw < w * 0.04 || bh < h * 0.008 || bw > w * 0.96 || bh > h * 0.4 || area / (bw * bh) < 0.8) continue;
    let ink = 0; for (let y = y0 + 2; y <= y1 - 2; y += 1) for (let x = x0 + 2; x <= x1 - 2; x += 1) ink += dark[y * w + x];
    out.push({ x: x0 - 1, y: y0 - 1, w: bw + 2, h: bh + 2, empty: ink / Math.max(1, (bw - 4) * (bh - 4)) < 0.004, ink });
  }
  return out;
}

/** Small hollow squares: the bounding box is square, its four corners and four sides are ink and its middle is paper (a letter "O" has empty corners). */
function checksOf(w, h, dark, minS, maxS) {
  const lab = new Int32Array(w * h).fill(-1), stack = new Int32Array(w * h), out = [];
  for (let s = 0; s < w * h; s += 1) {
    if (!dark[s] || lab[s] >= 0) continue;
    let sp = 0, x0 = w, y0 = h, x1 = 0, y1 = 0, n = 0; stack[sp++] = s; lab[s] = s;
    while (sp) {
      const p = stack[--sp], x = p % w, y = (p / w) | 0; n += 1;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      if (x1 - x0 > maxS * 1.5 || y1 - y0 > maxS * 1.5) { /* too big to be a box: keep labelling so it is not re-entered */ }
      for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) { if (!dx && !dy) continue; const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue; const q = ny * w + nx; if (dark[q] && lab[q] < 0) { lab[q] = s; stack[sp++] = q; } }
    }
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
    if (bw < minS || bh < minS || bw > maxS || bh > maxS) continue;
    const aspect = bw / bh; if (aspect < 0.8 || aspect > 1.25) continue;
    if (n > bw * bh * 0.55) continue;                                                              // a solid blob (a bullet), not an outline
    const px = (x, y) => dark[y * w + x] === 1;
    const near = (x, y) => { for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) if (px(x + dx, y + dy)) return true; return false; };   // a tilted scan steps the edge by a pixel: look around the corner, not only at it
    const corners = [near(x0 + 1, y0 + 1), near(x1 - 1, y0 + 1), near(x0 + 1, y1 - 1), near(x1 - 1, y1 - 1)].filter(Boolean).length;
    if (corners < 3 || !(px(x0, y0) || px(x0 + 1, y0) || px(x0, y0 + 1) || px(x1, y0) || px(x1 - 1, y0) || px(x1, y0 + 1))) continue;   // a box has square corners (one may be nicked by a tilted scan); the letter D, O or B does not
    let mid = 0, cnt = 0; const ix = Math.round(bw * 0.28), iy = Math.round(bh * 0.28);
    for (let y = y0 + iy; y <= y1 - iy; y += 1) for (let x = x0 + ix; x <= x1 - ix; x += 1) { mid += dark[y * w + x]; cnt += 1; }
    if (cnt && mid / cnt > 0.35) continue;                                                         // a filled or crossed square is a ticked box, still a box
    // each side is a straight run of ink along its middle 60% (a letter D or B has one curved side)
    const edge = (len, at) => { let ok = 0, n = 0; for (let k = Math.floor(len * 0.2); k <= Math.ceil(len * 0.8); k += 1) { n += 1; if (at(k)) ok += 1; } return n ? ok / n : 0; };
    const any = (fn) => { for (let d = 0; d < 4; d += 1) if (fn(d)) return true; return false; };
    const top = edge(bw, (k) => any((d) => dark[(y0 + d) * w + x0 + k])), bottom = edge(bw, (k) => any((d) => dark[(y1 - d) * w + x0 + k]));
    const left = edge(bh, (k) => any((d) => dark[(y0 + k) * w + x0 + d])), right = edge(bh, (k) => any((d) => dark[(y0 + k) * w + x1 - d]));
    if (Math.min(top, bottom, left, right) < 0.7) continue;
    out.push({ x: x0, y: y0, w: bw, h: bh });
  }
  return out;
}

/** Yellow (or other bright marker) bars laid over a signature line. */
function barsOf(w, h, rgba) {
  const m = new Uint8Array(w * h);
  for (let i = 0, j = 0; i < m.length; i += 1, j += 4) { const r = rgba[j], g = rgba[j + 1], b = rgba[j + 2]; if (r > 200 && g > 180 && b < 150 && r - b > 80) m[i] = 1; }
  const seen = new Uint8Array(w * h), stack = new Int32Array(w * h), out = [];
  for (let s = 0; s < m.length; s += 1) {
    if (!m[s] || seen[s]) continue;
    let sp = 0, n = 0, x0 = w, y0 = h, x1 = 0, y1 = 0; stack[sp++] = s; seen[s] = 1;
    while (sp) {
      const p = stack[--sp], x = p % w, y = (p / w) | 0; n += 1;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      for (const q of [p - 1, p + 1, p - w, p + w]) { if (q < 0 || q >= m.length || !m[q] || seen[q]) continue; if ((q === p - 1 && x === 0) || (q === p + 1 && x === w - 1)) continue; seen[q] = 1; stack[sp++] = q; }
    }
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
    if (bw >= w * 0.06 && bh >= 5 && bh <= h * 0.06 && n / (bw * bh) > 0.6) out.push({ x: x0, y: y0, w: bw, h: bh });
  }
  return out;
}

export function analyse({ w, h, rgba }, { minLine = 0.03, maxCheck = 0.034, minCheck = 0.011 } = {}) {
  const g = grayOf(w, h, rgba);
  let dark = threshold(w, h, g);
  const skew = skewOf(w, h, dark);
  if (Math.abs(skew) >= 0.2) dark = threshold(w, h, rotateGray(w, h, g, skew));
  const minLen = Math.max(24, Math.round(w * minLine)), maxThick = Math.max(6, Math.round(h / 180));
  const hl = hLines(w, h, dark, minLen, maxThick);
  const vl = vLines(w, h, dark, Math.max(18, Math.round(h * 0.012)), maxThick);
  const cells = cellsOf(w, h, dark, hl, vl);
  const checks = checksOf(w, h, dark, Math.max(8, Math.round(w * minCheck)), Math.round(w * maxCheck));
  const bars = barsOf(w, h, rgba);
  // is a line the wall of a box or table (touches a vertical line at an end or crosses one)?
  const lines = hl.map((l) => {
    const ruled = vl.some((v) => v.x >= l.x - 4 && v.x <= l.x + l.w + 4 && v.y - 6 <= l.y && v.y + v.h + 6 >= l.y);
    const [x, y] = back(l.x, l.y, w, h, skew), [x2] = back(l.x + l.w, l.y, w, h, skew);
    return { x, y, w: x2 - x, t: l.t, ruled };
  });
  const mapBox = (b) => { const [cx, cy] = back(b.x + b.w / 2, b.y + b.h / 2, w, h, skew); return { ...b, x: cx - b.w / 2, y: cy - b.h / 2 }; };
  return { skew, lines, cells: cells.map(mapBox), checks: checks.map(mapBox), bars };
}
const _internals = { grayOf, threshold, skewOf, rotateGray, hLines, checksOf };
