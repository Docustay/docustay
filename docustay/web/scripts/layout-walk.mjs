// Button-by-button walk of one page for the layout audit: lists every interactive element (from the DOM, with its accessible name), clicks the SAFE ones (things that open a dialog, sheet, menu or popover, tabs, toggles of view),
// measures what opened (size, position, whether it fits and is centred, a drawer or a bottom sheet), shots it, and closes it with Escape. Never clicks anything that deletes, pays, sends, saves, signs out or changes a setting.
export const DESTRUCTIVE = /delete|remove|cancel (?:plan|document|subscription|invitation|pro)|void|discard|revoke|rotate|sign out|log out|logout|pay\b|subscribe|buy|purchase|send|remind|resend|archive|disconnect|reset|erase|decline|confirm|save|apply|update|create|invite|upload|import|enable|disable|connect|mark all|clear|copy|run |test\b|resume|keep|choose|switch to|finish|publish|submit|accept|approve|stop|turn |continue|next|back\b|done|download|export|print|draft it|use this|start\b/i;
export const SAFE = /^(new|add|explore|see|view|open|edit|details|filter|more|menu|help|preview|learn|show|search|notifications|appearance|theme|bulk|describe|use a template|build it|list|thumbnails|board|columns|sort|date|options|actions|share|info|what|how|why|compare|plans|raise|raise)/i;
/* eslint-disable no-undef */
export function listInteractive() {
  const out = []; let n = 0;
  const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  for (const el of document.querySelectorAll('a[href], button, [role=button], [role=tab], [role=menuitem], [role=switch], [aria-haspopup], summary, input, select, textarea')) {
    if (!vis(el) || el.closest('[aria-hidden=true]') || el.closest('.sr-only')) continue;
    el.setAttribute('data-la-i', String(n));
    const name = (el.getAttribute('aria-label') || el.innerText || el.getAttribute('title') || el.getAttribute('placeholder') || el.getAttribute('name') || '').replace(/\s+/g, ' ').trim().slice(0, 60);
    out.push({ i: n, tag: el.tagName.toLowerCase(), role: el.getAttribute('role') || '', type: el.getAttribute('type') || '', name, href: el.getAttribute('href') || '', testid: el.getAttribute('data-testid') || '', popup: el.getAttribute('aria-haspopup') || '', expanded: el.getAttribute('aria-expanded') ?? '', disabled: el.disabled === true || el.getAttribute('aria-disabled') === 'true', inDialog: !!el.closest('[role=dialog],[role=alertdialog]'), w: Math.round(el.getBoundingClientRect().width), h: Math.round(el.getBoundingClientRect().height) });
    n += 1;
  }
  return out;
}
export function overlayInfo() {
  const sel = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], dialog[open], [data-part="content"][data-state="open"]';
  let best = null;
  for (const el of document.querySelectorAll(sel)) {
    if (el.closest('[data-scope="tabs"]') || el.getAttribute('role') === 'tabpanel') continue;
    const r = el.getBoundingClientRect(); const s = getComputedStyle(el); if (r.width < 40 || r.height < 20 || s.visibility === 'hidden' || s.display === 'none') continue;
    if (!best || r.width * r.height > best.area) best = { area: r.width * r.height, role: el.getAttribute('role') || el.tagName.toLowerCase(), left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), bottom: Math.round(r.bottom), w: Math.round(r.width), h: Math.round(r.height), label: (el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 50), scrolls: el.scrollHeight > el.clientHeight + 2, modal: el.getAttribute('aria-modal') === 'true' || el.tagName === 'DIALOG' };
  }
  if (!best) return null;
  const vw = window.innerWidth, vh = window.innerHeight; const c = Math.round(((best.left + best.right) / 2 - vw / 2) * 10) / 10;
  const kind = best.role === 'menu' || best.role === 'listbox' ? 'menu' : !best.modal ? 'popover' : (best.right >= vw - 2 && best.h >= vh - 8) ? 'drawer' : (best.bottom >= vh - 2 && best.w >= vw - 8) ? 'bottom-sheet' : 'modal';
  return { ...best, kind, offCentre: c, fits: best.left >= -1 && best.right <= vw + 1 && best.top >= -1 && best.bottom <= vh + 1, vw, vh };
}
/* eslint-enable no-undef */
/** Walk one page. Returns {inventory, opened[]}; every click is followed by Escape and a check that the page is back. */
export async function walkPage(page, { shot } = {}) {
  const inv = await page.evaluate(listInteractive); const opened = []; const skipped = [];
  for (const e of inv) {
    if (e.inDialog || e.disabled) continue;
    const key = `${e.tag}:${e.name || e.testid}`;
    const isSwitch = e.role === 'switch' || ['checkbox', 'radio', 'file', 'password', 'text', 'email', 'search', 'number', 'url', 'tel'].includes(e.type) || e.tag === 'select' || e.tag === 'textarea' || e.tag === 'input';
    const popup = e.popup && e.popup !== 'false';
    const wantsClick = !isSwitch && !(e.tag === 'a' && !popup) && (popup || e.role === 'tab' || SAFE.test(e.name)) && !DESTRUCTIVE.test(e.name);
    if (!wantsClick) { skipped.push({ ...e, why: isSwitch ? 'field or switch, not changed' : e.tag === 'a' ? 'link, covered by its own page' : DESTRUCTIVE.test(e.name) ? 'could change data, not clicked' : 'not an opener' }); continue; }
    const loc = page.locator(`[data-la-i="${e.i}"]`).first();
    try {
      const url0 = page.url(); await loc.click({ timeout: 3000 }); await page.waitForTimeout(450);
      const o = await page.evaluate(overlayInfo);
      if (o) { const rec = { opener: key, ...o }; if (shot) rec.shot = await shot(`${key.replace(/[^a-z0-9]+/gi, '-').slice(0, 40)}`); opened.push(rec); await page.keyboard.press('Escape'); await page.waitForTimeout(250); if (await page.evaluate(overlayInfo)) { await page.keyboard.press('Escape'); await page.waitForTimeout(250); } }
      else if (page.url() !== url0) { opened.push({ opener: key, navigatedTo: page.url().replace(/^https?:\/\/[^/]+/, '') }); await page.goBack({ waitUntil: 'networkidle' }); await page.waitForTimeout(500); await page.evaluate(listInteractive); }
      else skipped.push({ ...e, why: 'changed the page in place (tab or view), not an overlay' });
    } catch (x) { skipped.push({ ...e, why: `click failed: ${String(x.message).slice(0, 60)}` }); }
  }
  return { inventory: inv.length, opened, skipped };
}
