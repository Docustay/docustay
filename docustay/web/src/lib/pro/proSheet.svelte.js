// The one Explore Pro sheet (Run 8, motion board 2 piece 3): any Pro lock opens it, with the control it rose from, so it rises from that control. Mounted once in the signed-in layout.
export const proSheet = $state({ open: false, item: null, from: null });
export function exploreProFrom(item, el = null) {
  const r = el?.getBoundingClientRect?.();
  proSheet.item = item; proSheet.from = r ? { x: r.left + r.width / 2, y: r.bottom, top: r.top } : null; proSheet.open = true;
}
export const closeProSheet = () => { proSheet.open = false; };

// Run 9 Part 3.7 (B1): the upgrade sheet — opened from Explore Pro, a Pro lock's tip or Billing, naming what the person tried (`item`)
export const upgradeSheet = $state({ open: false, item: null });
export function openUpgrade(item = null) { proSheet.open = false; upgradeSheet.item = item; upgradeSheet.open = true; }
export const closeUpgrade = () => { upgradeSheet.open = false; };
