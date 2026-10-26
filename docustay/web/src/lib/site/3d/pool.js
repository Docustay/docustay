// Live WebGL contexts on the public site: at most MAX at once (V2 §6.4). A scene that cannot get a slot keeps its poster and asks again when one frees.
const MAX = 2, live = new Set(), waiting = [];
export function acquire(id, onFree) {
  if (live.has(id)) return true;
  if (live.size < MAX) { live.add(id); return true; }
  if (onFree && !waiting.some((w) => w[0] === id)) waiting.push([id, onFree]);
  return false;
}
export function release(id) {
  live.delete(id);
  const i = waiting.findIndex((w) => w[0] === id); if (i >= 0) waiting.splice(i, 1);
  const next = waiting.shift(); if (next) next[1]();
}
export const liveCount = () => live.size;
