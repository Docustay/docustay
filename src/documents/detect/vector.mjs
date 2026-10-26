// PDF FIELD DETECTION · THE PAGE'S OWN DRAWING (9 Oct 2026). Lines, boxes, table cells, tick boxes and highlight bars read from the PDF's drawing commands (pdfjs-dist's operator list, Apache-2.0), not from a picture of the page.
// Exact where a picture is only close: a ruled line is a line with its real end points, a box is the rectangle that was drawn. Coordinates come out in page points, y from the top, in the same shapes the picture reader (geometry.mjs) gives,
// so everything after it (labels, roles, vetoes) is one code path. A scanned page has no drawing commands to read: the engine falls back to the picture and OCR for those only.
import { OPS } from "pdfjs-dist/legacy/build/pdf.mjs";

const mul = (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
const STROKE = new Set([OPS.stroke, OPS.closeStroke, OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke]);
const FILL = new Set([OPS.fill, OPS.eoFill, OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke]);
const hex = (c) => { const m = /^#?([0-9a-f]{6})$/i.exec(String(c ?? "")); return m ? [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)) : [0, 0, 0]; };
const lum = ([r, g, b]) => (0.299 * r + 0.587 * g + 0.114 * b) / 255;
const sat = ([r, g, b]) => (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
const MAX_SEGMENTS = 6000;

/** One pass over the operator list: every axis-aligned segment and rectangle that was stroked or filled, in top-left page points. → { segs, rects, images } or null when the page draws too much to read this way. */
async function walk(page) {
  const vp = page.getViewport({ scale: 1 });
  const ol = await page.getOperatorList();
  let ctm = [1, 0, 0, 1, 0, 0], fill = "#000000", stroke = "#000000", lw = 1;
  const stack = [], segs = [], rects = [], circles = []; let images = 0;
  const pt = (x, y) => { const X = ctm[0] * x + ctm[2] * y + ctm[4], Y = ctm[1] * x + ctm[3] * y + ctm[5]; return vp.convertToViewportPoint(X, Y); };
  for (let i = 0; i < ol.fnArray.length; i += 1) {
    const fn = ol.fnArray[i], a = ol.argsArray[i];
    if (fn === OPS.save) stack.push([ctm, fill, stroke, lw]);
    else if (fn === OPS.restore) { const s = stack.pop(); if (s) [ctm, fill, stroke, lw] = s; }
    else if (fn === OPS.transform) ctm = mul(ctm, a);
    else if (fn === OPS.paintFormXObjectBegin) { stack.push([ctm, fill, stroke, lw]); if (Array.isArray(a?.[0])) ctm = mul(ctm, a[0]); }
    else if (fn === OPS.paintFormXObjectEnd) { const s = stack.pop(); if (s) [ctm, fill, stroke, lw] = s; }
    else if (fn === OPS.setFillRGBColor) fill = a[0];
    else if (fn === OPS.setStrokeRGBColor) stroke = a[0];
    else if (fn === OPS.setLineWidth) lw = a[0];
    else if (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject || fn === OPS.paintImageMaskXObject) images += 1;
    else if (fn === OPS.constructPath) {
      const paint = a[0], d = Array.from(Array.isArray(a[1]) && a[1].length === 1 && typeof a[1][0] === "object" ? a[1][0] : a[1] ?? []);
      const strokes = STROKE.has(paint), fills = FILL.has(paint);
      if (!strokes && !fills) continue;
      const subs = []; const curveCount = []; let cur = null;
      for (let k = 0; k < d.length;) {
        const op = d[k];
        if (op === 0) { cur = [pt(d[k + 1], d[k + 2])]; subs.push(cur); curveCount.push(0); k += 3; }
        else if (op === 1) { if (cur) cur.push(pt(d[k + 1], d[k + 2])); k += 3; }
        else if (op === 2) { if (cur) { cur.push(pt(d[k + 5], d[k + 6])); curveCount[curveCount.length - 1] += 1; } k += 7; }
        else if (op === 3) { if (cur) cur.push(pt(d[k + 3], d[k + 4])); k += 5; }
        else if (op === 4) { if (cur?.length) cur.push(cur[0]); k += 1; }
        else break;
      }
      const scale = Math.hypot(ctm[0], ctm[1]) || 1, width = Math.max(0.1, lw * scale);
      for (const [si, sp] of subs.entries()) {
        const xs = sp.map((p) => p[0]), ys = sp.map((p) => p[1]);
        if (curveCount[si] >= 4 && strokes) { const bx0 = Math.min(...xs), bx1 = Math.max(...xs), by0 = Math.min(...ys), by1 = Math.max(...ys), bw = bx1 - bx0, bh = by1 - by0; if (bw >= 5 && bw <= 24 && Math.abs(bw - bh) <= bw * 0.2) circles.push({ x: bx0, y: by0, w: bw, h: bh }); continue; }
        const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
        const axis = sp.every((p, j) => j === 0 || Math.abs(p[0] - sp[j - 1][0]) < 0.6 || Math.abs(p[1] - sp[j - 1][1]) < 0.6);
        const closedBox = sp.length >= 4 && sp.length <= 6 && axis && x1 - x0 > 0.5 && y1 - y0 > 0.5;
        if (closedBox) { rects.push({ x: x0, y: y0, w: x1 - x0, h: y1 - y0, stroked: strokes, filled: fills, fill: hex(fill), stroke: hex(stroke), t: width }); continue; }
        for (let j = 1; j < sp.length; j += 1) {
          const [ax, ay] = sp[j - 1], [bx, by] = sp[j];
          if (Math.abs(ay - by) < 0.6 && Math.abs(ax - bx) > 1) segs.push({ h: true, x: Math.min(ax, bx), y: (ay + by) / 2, len: Math.abs(ax - bx), t: strokes ? width : 1, color: hex(strokes ? stroke : fill) });
          else if (Math.abs(ax - bx) < 0.6 && Math.abs(ay - by) > 1) segs.push({ h: false, x: (ax + bx) / 2, y: Math.min(ay, by), len: Math.abs(ay - by), t: strokes ? width : 1, color: hex(strokes ? stroke : fill) });
        }
      }
      if (segs.length + rects.length > MAX_SEGMENTS) return null;
    }
  }
  return { segs, rects, circles, images, W: vp.width, H: vp.height };
}

const merge = (list, tol = 1.5) => {   // collinear, touching pieces of one line become one
  // Run 9 (Part 4.1): pieces are first grouped by position, then joined left to right. Sorting by position alone put pieces of ONE rule whose positions differ by a hair out of order, and the join kept the
  // first piece's left end — a page-wide rule drawn in three strokes came out as its right-hand stub.
  const out = [], sorted = [...list].sort((a, b) => a.pos - b.pos);
  for (let i = 0; i < sorted.length;) {
    let j = i + 1; while (j < sorted.length && sorted[j].pos - sorted[i].pos <= tol) j += 1;
    const group = sorted.slice(i, j).sort((a, b) => a.from - b.from), row = [];
    for (const s of group) { const last = row.at(-1); if (last && s.from <= last.to + 2.5) { last.to = Math.max(last.to, s.to); last.t = Math.max(last.t, s.t); } else row.push({ ...s }); }
    out.push(...row); i = j;
  }
  return out.sort((a, b) => (a.pos - b.pos) || (a.from - b.from));
};

/**
 * @param page a pdf.js page
 * @param words the page's words in page fractions ({x,y,w,h,str}), to tell an empty box from a filled one
 * @returns null when the page cannot be read this way (a picture, or too much drawing), else { lines, cells, checks, bars, W, H } in points
 */
export async function vectorGeometry(page, words) {
  const g = await walk(page).catch(() => null);
  if (!g) return null;
  const { W, H } = g;
  const real = words.filter((w) => /[\p{L}\p{N}]/u.test(w.str));
  const wordIn = (x, y, w, h, slack = 0) => real.some((k) => { const cx = (k.x + k.w / 2) * W, cy = (k.y + k.h / 2) * H; return cx > x + slack && cx < x + w - slack && cy > y + slack && cy < y + h - slack; });
  // small round outlines (radio buttons) with nothing printed inside are tick spots too
  const checkSpots = [];
  for (const c of g.circles ?? []) if (!wordIn(c.x, c.y, c.w, c.h)) checkSpots.push(c);
  // thin filled rectangles are ruled lines; thin tall ones are vertical rules
  const hs = [], vs = [];
  for (const s of g.segs) (s.h ? hs : vs).push(s.h ? { pos: s.y, from: s.x, to: s.x + s.len, t: s.t } : { pos: s.x, from: s.y, to: s.y + s.len, t: s.t });
  const boxes = [];
  for (const r of g.rects) {
    if (r.h <= 2.4 && r.w >= 12) hs.push({ pos: r.y + r.h / 2, from: r.x, to: r.x + r.w, t: Math.max(r.h, 0.5) });
    else if (r.w <= 2.4 && r.h >= 12) vs.push({ pos: r.x + r.w / 2, from: r.y, to: r.y + r.h, t: Math.max(r.w, 0.5) });
    else boxes.push(r);
  }
  const H1 = merge(hs).filter((l) => l.to - l.from >= 8), V1 = merge(vs).filter((l) => l.to - l.from >= 8);
  // tick boxes: small, nearly square, drawn as a box; nothing printed inside
  const checks = [], cells = [], bars = [];
  const seen = new Set();
  // Run 9 (Part 4.1): a grid cell also carries its inner dividers — short rules that start inside it, below its top, and run to its bottom (the boxes of an SSN under the box's caption) — as { x, top } in points
  const addCell = (x, y, w, h, vlines = null) => { const k = `${Math.round(x / 2)}:${Math.round(y / 2)}:${Math.round(w / 2)}:${Math.round(h / 2)}`; if (seen.has(k)) return; seen.add(k);
    const dividers = vlines ? vlines.filter((v) => v.pos > x + 6 && v.pos < x + w - 6 && v.from > y + 2 && v.from < y + h - 4 && v.to >= y + h - 2).map((v) => ({ x: v.pos, top: v.from })).sort((p, q) => p.x - q.x) : [];
    cells.push({ x, y, w, h, empty: !wordIn(x, y, w, h, 1), ...(dividers.length ? { dividers } : {}) }); };
  for (const r of boxes) {
    const [R, G, B] = r.fill, light = lum(r.fill) > 0.5;
    if (r.filled && !r.stroked && sat(r.fill) > 0.25 && light && r.w > 0.1 * W && r.h >= 7 && r.h <= 40) { bars.push({ x: r.x, y: r.y, w: r.w, h: r.h }); continue; }   // a highlight bar (the yellow "sign here" band)
    if (r.filled && !r.stroked && (lum(r.fill) < 0.995 || r.w > 0.5 * W)) continue;                                                                                    // shading behind a table or a header, not a blank
    const sq = r.w >= 6 && r.w <= 0.034 * W && r.h >= 6 && r.h <= 0.034 * W && Math.abs(r.w - r.h) <= Math.max(2, r.w * 0.25);
    if (sq && !wordIn(r.x, r.y, r.w, r.h)) { checks.push({ x: r.x, y: r.y, w: r.w, h: r.h }); continue; }
    if (r.w >= 20 && r.h >= 8 && r.w <= 0.95 * W && r.h <= 0.5 * H) addCell(r.x, r.y, r.w, r.h);
    void R; void G; void B;
  }
  // cells of a ruled grid: two horizontal rules, and two vertical rules that both run between them
  const Hs = H1.filter((l) => l.to - l.from >= 20).sort((a, b) => a.pos - b.pos);
  if (Hs.length * V1.length < 40000) {
    for (let i = 0; i < Hs.length; i += 1) for (let j = i + 1; j < Hs.length; j += 1) {
      const a = Hs[i], b = Hs[j], dy = b.pos - a.pos; if (dy < 9) continue; if (dy > 150) break;
      const lo = Math.max(a.from, b.from), hi = Math.min(a.to, b.to); if (hi - lo < 18) continue;
      const vv = V1.filter((v) => v.pos >= lo - 1.5 && v.pos <= hi + 1.5 && v.from <= a.pos + 2 && v.to >= b.pos - 2).sort((p, q) => p.pos - q.pos);
      for (let k = 0; k + 1 < vv.length; k += 1) { const w = vv[k + 1].pos - vv[k].pos; if (w >= 14 && w <= 0.95 * W) addCell(vv[k].pos, a.pos, w, dy, V1); }
      // a numbered box open on a side (two rules and a left edge, or only dividers between them: the rows of a tax-style form) is a cell too, as wide as the rules or as far as the next divider
      if (dy <= 70 && hi - lo >= 0.4 * W && !Hs.some((m) => m.pos > a.pos + 3 && m.pos < b.pos - 3 && Math.min(m.to, hi) - Math.max(m.from, lo) > 0.5 * (hi - lo))) {
        const atLo = vv.some((v) => Math.abs(v.pos - lo) < 3), atHi = vv.some((v) => Math.abs(v.pos - hi) < 3);
        if (!(atLo && atHi)) {
          const cuts = [lo, ...vv.filter((v) => v.pos > lo + 6 && v.pos < hi - 6).map((v) => v.pos), hi];
          for (let k = 0; k + 1 < cuts.length; k += 1) if (cuts[k + 1] - cuts[k] >= 14) addCell(cuts[k], a.pos, cuts[k + 1] - cuts[k], dy, V1);
        }
      }
      // Run 9 (Part 4.1): the amount column of a line-item form — a narrow ruled column, a divider on one side (the line number's box) and open on the other. Each row between two NEIGHBOURING rules is one
      // answer; when the row is tall (its question wraps), the answer sits on the lower rule, one line high.
      else if (dy <= 70 && hi - lo < 0.4 * W && !Hs.some((m) => m.pos > a.pos + 3 && m.pos < b.pos - 3 && Math.min(m.to, hi) - Math.max(m.from, lo) > 0.5 * (hi - lo))) {
        const inner = vv.filter((v) => v.pos > lo + 6 && v.pos < hi - 6), atLo = vv.some((v) => Math.abs(v.pos - lo) < 3), atHi = vv.some((v) => Math.abs(v.pos - hi) < 3);
        const h = Math.min(dy, 14), y = b.pos - h;
        if (inner.length && !atHi && hi - inner.at(-1).pos >= 22) addCell(inner.at(-1).pos, y, hi - inner.at(-1).pos, h);
        if (inner.length && !atLo && inner[0].pos - lo >= 22) addCell(lo, y, inner[0].pos - lo, h);
      }
    }
  }
  // Run 9 (Part 4.1): shading is the form saying "nothing is written here" (the N/A box of a question it does not apply to, the rest of a tall row under its answer line). A cell under grey
  // shading across its width, with nothing printed in it, is trimmed to its unshaded part, or dropped when nothing is left.
  const shades = boxes.filter((r) => r.filled && !r.stroked && sat(r.fill) < 0.12 && lum(r.fill) < 0.97 && lum(r.fill) > 0.45 && r.w >= 8 && r.h >= 6);
  for (let i = cells.length - 1; i >= 0; i -= 1) {
    const c = cells[i]; if (!c.empty) continue;   // a caption printed on the shading makes it a heading, not a place left blank
    let top = c.y, bot = c.y + c.h;
    for (const r of shades) {
      if (r.x > c.x + 2 || r.x + r.w < c.x + c.w - 2 || r.y >= bot - 1 || r.y + r.h <= top + 1) continue;   // spans the cell's width and reaches into it
      if (r.y <= top + 2 && r.y + r.h >= bot - 2) { top = bot; break; }                                       // all of it
      if (r.y <= top + 2) top = Math.max(top, r.y + r.h); else if (r.y + r.h >= bot - 2) bot = Math.min(bot, r.y);
    }
    if (bot - top < 6) { cells.splice(i, 1); continue; }
    if (top !== c.y || bot !== c.y + c.h) cells[i] = { ...c, y: top, h: bot - top, empty: !wordIn(c.x, top, c.w, bot - top, 1), shadedTrim: true };
  }
  const touchesV = (l) => V1.some((v) => v.pos >= l.from - 3 && v.pos <= l.to + 3 && v.from - 5 <= l.pos && v.to + 5 >= l.pos);
  const lines = H1.map((l) => ({ x: l.from, y: l.pos, w: l.to - l.from, t: l.t, ruled: touchesV(l) }));
  for (const c of checkSpots) if (!checks.some((k) => Math.abs(k.x - c.x) < 2 && Math.abs(k.y - c.y) < 2)) checks.push(c);
  const vectorFound = lines.length + cells.length + checks.length + bars.length;
  return { lines, cells, checks, bars, skew: 0, W, H, vectorFound, images: g.images };
}
