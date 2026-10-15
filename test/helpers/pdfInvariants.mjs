// Layout invariants, asserted from what is really in the PDF (runs from pdfText.mjs). Used by the parity gate and by the structural tests.
import { toLines } from "./pdfText.mjs";

/** Two text runs overlap when their boxes intersect by more than `tol` points in BOTH directions. Adjacent runs on one line (touching edges) do not overlap. */
export function findOverlaps(runs, tol = 1.0) {
  const bad = [];
  const byPage = new Map();
  for (const r of runs) (byPage.get(r.page) ?? byPage.set(r.page, []).get(r.page)).push(r);
  for (const [page, rs] of byPage) {
    for (let i = 0; i < rs.length; i += 1) {
      for (let j = i + 1; j < rs.length; j += 1) {
        const a = rs[i], b = rs[j];
        // shrink the glyph box to its x-height-ish core (descenders and line gaps are not "ink")
        const ah = a.h * 0.7, bh = b.h * 0.7;
        const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
        const oy = Math.min(a.y + ah, b.y + bh) - Math.max(a.y, b.y);
        // Two runs on ONE baseline that merely touch (a few points, from kerning / font-metric rounding in an embedded face) are neighbours, not a collision.
        const sameLine = Math.abs(a.y - b.y) < 0.5;
        if (sameLine && ox <= Math.max(3, 0.08 * Math.min(a.w, b.w))) continue;
        if (ox > tol && oy > tol) bad.push({ page, a: a.str, b: b.str, ox: +ox.toFixed(1), oy: +oy.toFixed(1) });
      }
    }
  }
  return bad;
}

/** Within one page, lines must run top to bottom without going back up: the y of successive lines in DRAW order never increases. (Needs runs in draw order.) */
export function drawOrderMonotonic(runs, tol = 1.5) {
  const bad = [];
  let last = null;
  for (const r of runs) {
    if (last && r.page === last.page && r.y > last.y + tol && Math.abs(r.y - last.y) > tol && r.x <= last.x + 0.5) bad.push({ page: r.page, after: last.str, then: r.str });
    last = r;
  }
  return bad;
}

export const allText = (runs) => toLines(runs).map((l) => l.text).join("\n");
export const countMatches = (text, re) => (text.match(re) ?? []).length;
