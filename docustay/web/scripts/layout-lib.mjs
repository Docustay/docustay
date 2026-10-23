// Layout measurement, shared by scripts/layout-audit.mjs (the gate) and the audit runs. It runs INSIDE a page (page.evaluate(measureLayout, opts)) and answers with numbers:
// the empty gutters between the sidebar and the content, whether the content fills the width, blocks narrower than their container with nothing beside them, anything that scrolls sideways,
// and a few "looks wrong" signals (clipped text, tiny controls). Rules it enforces: docs in specs/v1/design-review/COMBINED-STYLE-SPEC.md section 8.
export const CAP = 1760;           // the page is centred only beyond this width
export const TOL = 4;              // px of tolerance on every comparison
/** The page gutter the spec asks for: clamp(16px, 2.2vw, 32px), the same left and right. */
export const gutterFor = (vw) => Math.min(32, Math.max(16, Math.round(vw * 0.022 * 10) / 10));

/* eslint-disable no-undef */
export function measureLayout(opts) {
  const o = { root: '[data-scroll-main]', mainSel: 'main#main', gutter: null, cap: 1760, tol: 4, centered: false, skipSel: '', ...opts };
  const vw = window.innerWidth;
  const sc = document.querySelector(o.root);
  const scR = sc ? sc.getBoundingClientRect() : { left: 0, right: vw, top: 0, bottom: window.innerHeight };
  const areaL = scR.left, areaR = scR.left + (sc ? sc.clientWidth : document.documentElement.clientWidth);
  const areaW = areaR - areaL;
  const main = document.querySelector(o.mainSel) ?? document.body;
  const token = o.gutter ?? (vw < 768 ? 16 : Math.min(32, Math.max(16, Math.round(vw * 0.022 * 10) / 10)));
  const expectedEdge = Math.max(token, (areaW - o.cap) / 2 + (areaW > o.cap ? token : 0));
  const alpha = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return 0; const p = m[1].split(/[ ,/]+/).filter(Boolean); return p.length > 3 ? parseFloat(p[3]) : 1; };
  const csOf = new Map();
  const cs = (el) => { let v = csOf.get(el); if (!v) { v = getComputedStyle(el); csOf.set(el, v); } return v; };
  const skip = o.skipSel ? [...document.querySelectorAll(o.skipSel)] : [];
  const bleed = (el) => el.closest('.page-head, .page-sticky-sub');
  const inSkipped = (el) => skip.some((s) => s.contains(el));
  const fixedOrHidden = (el) => { for (let e = el; e && e !== main.parentElement; e = e.parentElement) { const s = cs(e); if (s.display === 'none' || s.visibility === 'hidden' || s.position === 'fixed' || e.getAttribute('aria-hidden') === 'true' || parseFloat(s.opacity) < 0.02) return true; if (e.hasAttribute && e.hasAttribute('data-layout-ignore')) return true; } return false; };
  const hasBorder = (s) => ['Top', 'Right', 'Bottom', 'Left'].some((d) => parseFloat(s['border' + d + 'Width']) > 0 && s['border' + d + 'Style'] !== 'none' && alpha(s['border' + d + 'Color']) > 0.05);
  const hasBg = (s) => alpha(s.backgroundColor) > 0.05 || (s.backgroundImage && s.backgroundImage !== 'none');
  const CONTROL = new Set(['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON', 'IMG', 'SVG', 'CANVAS', 'VIDEO', 'TABLE', 'HR', 'IFRAME']);
  const label = (el) => { const t = (el.getAttribute('data-testid') ? '[' + el.getAttribute('data-testid') + '] ' : '') + el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0, 3).join('.') : ''); return t.slice(0, 90) + (el.innerText ? ' "' + el.innerText.replace(/\s+/g, ' ').trim().slice(0, 28) + '"' : ''); };

  // every visible element under main, with its rect
  const all = [...main.querySelectorAll('*')].filter((el) => !['SCRIPT', 'STYLE', 'TEMPLATE', 'OPTION', 'PATH', 'G', 'CIRCLE', 'RECT', 'LINE', 'POLYLINE', 'USE', 'DEFS', 'TSPAN'].includes(el.tagName.toUpperCase()));
  const rows = [];
  for (const el of all) {
    const r = el.getBoundingClientRect(); if (r.width < 1 || r.height < 1) continue;
    if (fixedOrHidden(el) || inSkipped(el)) continue;
    rows.push({ el, r, s: cs(el) });
  }
  // extent of the content: boxes, controls and the text itself; the full-bleed header rows and full-bleed backgrounds do not count
  let minLeft = Infinity, maxRight = -Infinity;
  const fullBleed = (r) => r.left <= areaL + 1 && r.right >= areaR - 1;
  const clipTo = (el, l, rr, self) => { for (let e = self ? el : el.parentElement; e && e !== main.parentElement; e = e.parentElement) { const ov = cs(e).overflowX; if (ov === 'auto' || ov === 'scroll' || ov === 'hidden' || ov === 'clip') { const q = e.getBoundingClientRect(); if (e !== main) { if (q.left <= areaL + 1 && q.right >= areaR - 1) return [0, 0]; l = Math.max(l, q.left); rr = Math.min(rr, q.right); } } } return [l, rr]; };
  // the left edge counts everything; the right edge counts only substantial boxes (a table, a row, a card, a wide control): text wraps by itself and a small button says nothing about how wide the page is
  let hasWide = false;
  const take = (l, rr, el, self, boxy) => { if (el) [l, rr] = clipTo(el, l, rr, self); if (rr <= l) return; if (l < minLeft) minLeft = l; if (boxy && rr - l >= 320) { hasWide = true; if (rr > maxRight) maxRight = rr; } };
  const isBox = (el, s) => CONTROL.has(el.tagName.toUpperCase()) || hasBorder(s) || hasBg(s);
  const boxes = [];
  for (const { el, r, s } of rows) {
    if (bleed(el)) continue;
    const svgInner = el.closest('svg') && el.tagName.toLowerCase() !== 'svg';
    if (svgInner) continue;
    const par = el.parentElement, pcs = par ? cs(par) : null;
    if (pcs && /grid/.test(pcs.display) && pcs.gridTemplateColumns.split(' ').length > 1 && r.width >= 240 && !fullBleed(r)) take(r.left, r.right, el, false, true);   // a column of a grid is structure: it reaches the edge even when what is in it is text
    if (isBox(el, s) && !fullBleed(r)) { take(r.left, r.right, el, false, true); boxes.push({ el, r, s }); }
    else if (isBox(el, s)) boxes.push({ el, r, s, bleed: true });
    for (const n of el.childNodes) {
      if (n.nodeType !== 3 || !n.textContent.trim()) continue;
      const rg = document.createRange(); rg.selectNodeContents(n); for (const q of rg.getClientRects()) if (q.width > 0 && q.height > 0) take(q.left, q.right, el, true);
    }
  }
  if (hasWide) for (const b of boxes) {
    if (b.bleed || bleed(b.el) || b.r.width >= 320) continue;
    const [l2, r2] = clipTo(b.el, b.r.left, b.r.right, false); if (r2 <= l2 || r2 <= maxRight) continue;
    // a small control (a button after a wide field) sits in the same row as a wide box: it is where that row ends
    const same = boxes.some((w) => w !== b && !w.bleed && w.r.width >= 320 && Math.min(w.r.bottom, b.r.bottom) - Math.max(w.r.top, b.r.top) >= Math.min(w.r.height, b.r.height) * 0.5 && b.r.left >= w.r.right - o.tol);
    if (same) maxRight = r2;
  }
  const empty = !isFinite(minLeft);
  const gutterL = empty ? null : Math.round((minLeft - areaL) * 10) / 10;
  const gutterR = empty || !hasWide ? null : Math.round((areaR - maxRight) * 10) / 10;

  // the page header and the sticky filter row: their text must start at the gutter
  const headBox = main.querySelector('.page-head'); const headInner = headBox ? [...headBox.querySelectorAll('*')].filter((c) => c.children.length === 0 || c.tagName === 'A' || c.tagName === 'BUTTON' || c.tagName === 'H1').map((c) => c.getBoundingClientRect()).filter((q) => q.width > 0 && q.height > 0) : [];
  const titleLeft = headInner.length ? Math.round((Math.min(...headInner.map((q) => q.left)) - areaL) * 10) / 10 : null;
  const headActs = headBox ? [...headBox.querySelectorAll(':scope > .justify-end button, :scope > .justify-end a, :scope > .justify-end input, :scope > .justify-end select')].map((c) => c.getBoundingClientRect()).filter((q) => q.width > 0 && q.height > 0) : [];
  const headRight = headActs.length ? Math.round((areaR - Math.max(...headActs.map((q) => q.right))) * 10) / 10 : null;
  const subEl = main.querySelector('.page-sticky-sub'); const subLeft = subEl && subEl.firstElementChild ? Math.round((subEl.firstElementChild.getBoundingClientRect().left - areaL) * 10) / 10 : null;

  // multi-column containers count as blocks too (a grid or a flex row whose children sit side by side)
  const sideBySide = (el) => { const kids = [...el.children].map((k) => ({ k, r: k.getBoundingClientRect(), s: cs(k) })).filter((x) => x.r.width > 0 && x.r.height > 0 && x.s.display !== 'none' && x.s.position !== 'absolute' && x.s.position !== 'fixed'); if (kids.length < 2) return false; for (let i = 0; i < kids.length; i++) for (let j = i + 1; j < kids.length; j++) { const a = kids[i].r, b = kids[j].r; const vo = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top); if (vo > 4 && (b.left >= a.right - o.tol || a.left >= b.right - o.tol)) return true; } return false; };
  const containers = [];
  for (const { el, r, s } of rows) { if (bleed(el)) continue; if (!/flex|grid/.test(s.display)) continue; if (r.width < 320 || fullBleed(r)) continue; if (sideBySide(el)) containers.push({ el, r, s, container: true }); }
  const blocks = [...boxes.filter((b) => !b.bleed && b.r.width >= 320 && b.r.height >= 14), ...containers];
  const blockSet = new Set(blocks.map((b) => b.el));
  const hasNeighbour = (b) => {
    let c = b.el;
    for (let p = c.parentElement; p && p !== main.parentElement; c = p, p = p.parentElement) {
      const cr = c.getBoundingClientRect();
      for (const k of p.children) { if (k === c) continue; const ks = cs(k); if (ks.display === 'none' || ks.position === 'absolute' || ks.position === 'fixed') continue; const kr = k.getBoundingClientRect(); if (kr.width < 1 || kr.height < 1) continue; const vo = Math.min(cr.bottom, kr.bottom) - Math.max(cr.top, kr.top); if (vo > 4 && (kr.left >= cr.right - o.tol || kr.right <= cr.left + o.tol)) return true; }
      if (p === main) break;
    }
    return false;
  };
  const outer = blocks.filter((b) => { for (let p = b.el.parentElement; p && p !== main.parentElement; p = p.parentElement) if (blockSet.has(p)) return false; return true; });
  const wantL = areaL + expectedEdge, wantR = areaR - expectedEdge;
  const narrow = [];
  for (const b of outer) {
    if (hasNeighbour(b)) continue;
    const short = wantR - b.r.right, off = b.r.left - wantL;
    if (!o.centered && (short > o.tol || off > o.tol)) narrow.push({ what: label(b.el), left: Math.round(b.r.left - areaL), right: Math.round(areaR - b.r.right), width: Math.round(b.r.width), top: Math.round(b.r.top), short: Math.round(short), off: Math.round(off), container: !!b.container });
  }
  // at every level: a visual block (a box, or something holding boxes) that sits narrower than the block that holds it, with nothing beside it, is a gap (a max-width wrapper, a bar that stops short)
  const levelNarrow = [];
  const isVisualBlock = (el, s) => !CONTROL.has(el.tagName.toUpperCase()) && !/^inline/.test(s.display) && (hasBorder(s) || hasBg(s) || [...el.querySelectorAll('*')].slice(0, 400).some((d) => { const q = cs(d); return d.tagName !== 'SPAN' && (hasBorder(q) || hasBg(q) || CONTROL.has(d.tagName.toUpperCase())) && d.getBoundingClientRect().width > 40; }));
  if (!o.centered) for (const { el: P, r: pr, s: ps } of rows) {
    if (bleed(P) || pr.width < 480 || pr.height < 24 || !/^(block|flex|grid|flow-root|list-item)$/.test(ps.display)) continue;
    if (P.closest('.paper-ground, .pg-paper, [role=dialog], [data-testid="empty-state"]') || P.matches('.rows, .rows-head, .rows-row')) continue;
    if (ps.display === 'grid' && ps.gridTemplateColumns.split(' ').length > 1) continue;
    if (ps.display === 'flex' && !/column/.test(ps.flexDirection)) continue;
    const pl = pr.left + parseFloat(ps.paddingLeft) + parseFloat(ps.borderLeftWidth), prr = pr.right - parseFloat(ps.paddingRight) - parseFloat(ps.borderRightWidth);
    const kids = [...P.children].map((k) => ({ k, r: k.getBoundingClientRect(), s: cs(k) })).filter((x) => x.r.width > 0 && x.r.height > 0 && x.s.display !== 'none' && x.s.position !== 'absolute' && x.s.position !== 'fixed' && x.s.visibility !== 'hidden');
    for (const c of kids) {
      if (c.r.width < 320 || !isVisualBlock(c.k, c.s) || c.k.matches('.pg-aside, aside')) continue;
      if (fixedOrHidden(c.k)) continue;
      const beside = kids.some((o2) => o2 !== c && Math.min(o2.r.bottom, c.r.bottom) - Math.max(o2.r.top, c.r.top) > 4 && (o2.r.left >= c.r.right - o.tol || o2.r.right <= c.r.left + o.tol));
      if (beside) continue;
      const short = prr - c.r.right, off = c.r.left - pl;
      if (short > o.tol || off > o.tol) levelNarrow.push({ what: label(c.k) + ' in ' + label(P).slice(0, 40), width: Math.round(c.r.width), short: Math.round(short), off: Math.round(off), top: Math.round(c.r.top), left: Math.round(c.r.left - areaL), right: Math.round(areaR - c.r.right), container: false, nested: true });
    }
  }
  for (const n of levelNarrow) if (narrow.length < 40) narrow.push(n);
  // every outermost block with a column beside it must still end at a shared edge: the right-most of them ends at the page's right edge
  const outerRights = outer.map((b) => Math.round(areaR - b.r.right));

  // anything that scrolls sideways
  const overflowing = [];
  const docScrollY = Math.round(document.scrollingElement.scrollHeight - innerHeight);   // the window itself must never scroll: the main column does
  // the main column's scroll range must end where its content ends ("at the bottom is the bottom"): a sticky rail or a tall empty box must not let the content scroll away leaving blank space.
  // Sticky and fixed parts do not count as content (a tall sticky rail beside short content is exactly the fault).
  let tailGap = 0, scrollRange = 0;
  if (sc) {
    const inSticky = (el) => { for (let e = el; e && e !== main.parentElement; e = e.parentElement) if (cs(e).position === 'sticky') return true; return false; };
    let bottom = 0; for (const { el, r } of rows) { if (inSticky(el)) continue; bottom = Math.max(bottom, r.bottom - scR.top + sc.scrollTop); }
    scrollRange = Math.max(0, Math.round(sc.scrollHeight - sc.clientHeight)); tailGap = scrollRange > 0 ? Math.round(sc.scrollHeight - bottom) : 0;
  }
  if (sc && sc.scrollWidth > sc.clientWidth + 1) overflowing.push({ what: 'scroller', scrollWidth: sc.scrollWidth, clientWidth: sc.clientWidth });
  if (document.documentElement.scrollWidth > document.documentElement.clientWidth + 1) overflowing.push({ what: 'document', scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth });
  const inHScroll = (el) => { for (let e = el.parentElement; e && e !== main.parentElement; e = e.parentElement) { const ov = cs(e).overflowX; if (ov === 'auto' || ov === 'scroll' || ov === 'hidden' || ov === 'clip') return true; } return false; };
  for (const { el, r } of rows) { if (bleed(el)) continue; if (r.right > areaR + 1 && !inHScroll(el)) { overflowing.push({ what: label(el), right: Math.round(r.right - areaR) }); if (overflowing.length > 8) break; } }

  // things that look wrong
  const clipped = [], tiny = [], overlaps = [];
  for (const { el, r, s } of rows) {
    if (bleed(el)) continue;
    if (el.closest('.sr-only')) continue;
    if ((s.overflowX === 'hidden' || s.overflow === 'hidden') && s.textOverflow !== 'ellipsis' && el.scrollWidth > el.clientWidth + 2 && el.clientWidth > 0 && el.children.length === 0 && el.innerText && el.innerText.trim()) clipped.push(label(el));
    const interactive = ['A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName.toUpperCase()) || el.getAttribute('role') === 'button';
    if (interactive && el.tagName !== 'INPUT' || (el.tagName === 'INPUT' && !['checkbox', 'radio', 'hidden'].includes(el.type))) { if (interactive && (r.height < (vw < 768 ? 28 : 20) || r.width < 20) && !el.closest('.sr-only')) tiny.push({ what: label(el), w: Math.round(r.width), h: Math.round(r.height) }); }
  }
  // text wrapped to one word per line in a narrow column (the sidebar budget block): an element whose text has 4+ lines and a width under 120px
  const squeezed = [];
  for (const { el, r, s } of rows) { if (el.children.length === 0 && el.innerText && el.innerText.trim().length > 12 && r.width < 120 && r.height / (parseFloat(s.lineHeight) || 16) >= 4) squeezed.push({ what: label(el), w: Math.round(r.width), lines: Math.round(r.height / (parseFloat(s.lineHeight) || 16)) }); }
  const sidebar = document.querySelector('#app-nav'); const sidebarW = sidebar ? Math.round(sidebar.getBoundingClientRect().width) : null;
  void overlaps;
  return {
    vw, vh: window.innerHeight, areaL: Math.round(areaL), areaR: Math.round(areaR), areaW: Math.round(areaW), sidebarW,
    expectedEdge: Math.round(expectedEdge * 10) / 10, gutterL, gutterR, contentW: empty || !hasWide ? null : Math.round(maxRight - minLeft), contentFraction: empty || !hasWide ? null : Math.round(((maxRight - minLeft) / areaW) * 1000) / 1000,
    docScrollY, tailGap, scrollRange, titleLeft, subLeft, headRight, blocks: outer.length, outerRights, narrow, overflowing, clipped: clipped.slice(0, 8), tiny: tiny.slice(0, 12), squeezed: squeezed.slice(0, 6), empty,
  };
}
/* eslint-enable no-undef */

/** The verdicts the gate fails on, from one measurement. `rules.centered` pages (an empty state in the middle) are judged on balance instead of reach. */
export function verdicts(m, { centered = false, tol = TOL } = {}) {
  const f = [];
  if (!m.empty && !centered) {
    if (Math.abs(m.gutterL - m.expectedEdge) > tol) f.push(`left gutter ${m.gutterL}px, wanted ${m.expectedEdge}px`);
    if (m.gutterR != null && Math.abs(m.gutterR - m.expectedEdge) > tol) f.push(`right gutter ${m.gutterR}px, wanted ${m.expectedEdge}px`);
  }
  if (!m.empty && centered && m.gutterR != null && Math.abs(m.gutterL - m.gutterR) > tol) f.push(`centred content is off balance: ${m.gutterL}px left, ${m.gutterR}px right`);
  if (m.titleLeft != null && Math.abs(m.titleLeft - m.expectedEdge) > tol) f.push(`page title starts ${m.titleLeft}px in, wanted ${m.expectedEdge}px`);
  if (m.subLeft != null && Math.abs(m.subLeft - m.expectedEdge) > tol) f.push(`filter row starts ${m.subLeft}px in, wanted ${m.expectedEdge}px`);
  if (m.headRight != null && m.vw >= 640 && Math.abs(m.headRight - m.expectedEdge) > tol) f.push(`header actions end ${m.headRight}px from the right, wanted ${m.expectedEdge}px`);
  for (const n of m.narrow) f.push(`block narrower than its container with nothing beside it: ${n.what} (${n.width}px wide, ${n.short}px short on the right, ${n.off}px in on the left)`);
  if (m.docScrollY > 1) f.push(`the window scrolls ${m.docScrollY}px: something sticks out of the app shell, so a blank band shows under it`);
  if (m.scrollRange > 0 && m.tailGap > (m.tailAllow ?? 96)) f.push(`the page scrolls ${m.scrollRange}px but the content ends ${m.tailGap}px before the bottom: you can scroll the content away and be left with blank space`);
  for (const x of m.overflowing) f.push(`scrolls sideways: ${x.what} ${x.right ?? (x.scrollWidth - x.clientWidth)}px`);
  return f;
}

/** What a dialog, sheet, drawer or menu opened by a click must do: fit the window, sit in the middle (a modal), not be stretched, and scroll inside itself when it is tall. */
export function overlayVerdicts(o) {
  const f = [];
  if (!o.fits) f.push(`${o.kind} "${o.label}" runs outside the window (${o.left}..${o.right} of ${o.vw})`);
  if (o.kind === 'modal') {
    if (Math.abs(o.offCentre) > 6) f.push(`modal "${o.label}" is ${o.offCentre}px off centre`);
    if (o.w > Math.min(o.vw - 16, 920)) f.push(`modal "${o.label}" is stretched: ${o.w}px wide`);
  }
  return f;
}
