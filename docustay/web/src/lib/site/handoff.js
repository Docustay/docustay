// The file a visitor dropped on the home page waits in IndexedDB until they have an account. Size-capped (the Free plan's upload limit); cleared the moment it is used. Everything is try/catch:
// a browser that blocks storage simply loses the convenience, and the page works the same.
export const LIMIT_MB = 25;
const DB = "docustay-handoff", STORE = "pending", KEY = "file";
const open = () => new Promise((res, rej) => { const r = indexedDB.open(DB, 1); r.onupgradeneeded = () => r.result.createObjectStore(STORE); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const run = async (mode, fn) => { const db = await open(); return new Promise((res, rej) => { const tx = db.transaction(STORE, mode); const out = fn(tx.objectStore(STORE)); tx.oncomplete = () => { db.close(); res(out.result); }; tx.onerror = () => { db.close(); rej(tx.error); }; }); };
export const keep = (file) => run("readwrite", (s) => s.put({ name: file.name, type: file.type, blob: file, at: Date.now() }, KEY));
export const peek = async () => { try { return (await run("readonly", (s) => s.get(KEY))) ?? null; } catch { return null; } };
export const clear = async () => { try { await run("readwrite", (s) => s.delete(KEY)); } catch { /* nothing to clear */ } };
/** A File made from what was kept, or null (nothing kept, older than a day, or over the cap). */
export async function take() {
  const k = await peek(); if (!k) return null;
  if (Date.now() - k.at > 86400000 || k.blob.size > LIMIT_MB * 1048576) { await clear(); return null; }
  return new File([k.blob], k.name, { type: k.type });
}
