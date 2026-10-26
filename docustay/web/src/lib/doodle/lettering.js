// Hand lettering: a single-stroke capital alphabet drawn on a 10 × 14 grid, then set as a word with a little rotation and baseline drift per letter so it looks written, not typed. Our own shapes.
const L = (x1, y1, x2, y2) => ({ k: "l", p: [[x1, y1], [x2, y2]] });
const P = (...p) => ({ k: "l", p });
const S = (...p) => ({ k: "s", p });
const Z = (...p) => ({ k: "s", p, closed: 1 });
export const GLYPHS = {
  A: [P([0, 14], [5, 0], [10, 14]), L(2, 9, 8, 9)],
  B: [P([0, 14], [0, 0], [7, 0], [9, 3], [7, 7], [0, 7]), P([0, 7], [8, 7], [10, 10], [8, 14], [0, 14])],
  C: [S([10, 3], [6, 0], [2, 2], [0, 7], [2, 12], [6, 14], [10, 11])],
  D: [P([0, 0], [0, 14], [6, 14], [10, 9], [9, 4], [5, 0], [0, 0])],
  E: [P([10, 0], [0, 0], [0, 14], [10, 14]), L(0, 7, 7, 7)],
  F: [P([10, 0], [0, 0], [0, 14]), L(0, 7, 7, 7)],
  G: [S([10, 3], [6, 0], [2, 2], [0, 7], [2, 12], [6, 14], [10, 12], [10, 8], [6, 8])],
  H: [L(0, 0, 0, 14), L(10, 0, 10, 14), L(0, 7, 10, 7)],
  I: [L(5, 0, 5, 14), L(2, 0, 8, 0), L(2, 14, 8, 14)],
  K: [L(0, 0, 0, 14), P([10, 0], [0, 8]), P([3, 6], [10, 14])],
  L: [P([0, 0], [0, 14], [10, 14])],
  M: [P([0, 14], [0, 0], [5, 9], [10, 0], [10, 14])],
  N: [P([0, 14], [0, 0], [10, 14], [10, 0])],
  O: [Z([5, 0], [9, 3], [10, 7], [8, 12], [5, 14], [2, 12], [0, 7], [1, 3])],
  P: [P([0, 14], [0, 0], [7, 0], [10, 3], [8, 7], [0, 7])],
  R: [P([0, 14], [0, 0], [7, 0], [10, 3], [8, 7], [0, 7]), P([4, 7], [10, 14])],
  S: [S([10, 3], [6, 0], [1, 2], [1, 6], [5, 7], [9, 8], [9, 12], [5, 14], [0, 11])],
  T: [L(0, 0, 10, 0), L(5, 0, 5, 14)],
  U: [S([0, 0], [0, 10], [3, 14], [7, 14], [10, 10], [10, 0])],
  V: [P([0, 0], [5, 14], [10, 0])],
  W: [P([0, 0], [2, 14], [5, 4], [8, 14], [10, 0])],
  Y: [P([0, 0], [5, 7], [10, 0]), L(5, 7, 5, 14)],
  "!": [L(5, 0, 5, 9), L(5, 13, 5, 14)],
  ".": [L(5, 13, 5, 14)],
};
/** Set a word in the grid alphabet: returns the strokes (as shapes in drawing units) and the size it needs. `gap` is the space between letters in grid units. */
export function word(text, { size = 1.5, x = 4, y = 4, gap = 4.4, spaceWidth = 6 } = {}) {
  const ink = []; let cx = x, i = 0;
  for (const ch of text) {
    if (ch === " ") { cx += spaceWidth * size; continue; }
    const g = GLYPHS[ch]; if (!g) continue;
    const tilt = (((i * 37) % 7) - 3) * 0.9 * Math.PI / 180, drift = (((i * 53) % 5) - 2) * 0.55, grow = 1 + (((i * 29) % 5) - 2) * 0.035;
    for (const s of g) {
      const f = ([px, py]) => { const X = px * size * grow, Y = py * size * grow; return [cx + X * Math.cos(tilt) - (Y - 7 * size) * Math.sin(tilt), y + 7 * size + drift + X * Math.sin(tilt) + (Y - 7 * size) * Math.cos(tilt)]; };
      ink.push({ ...s, p: s.p.map(f) });
    }
    cx += (10 + gap) * size; i += 1;
  }
  return { ink, w: cx - gap * size + x, h: 14 * size + y * 2 + 3 };
}
