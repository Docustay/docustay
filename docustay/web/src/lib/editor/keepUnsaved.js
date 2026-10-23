// R13-D282: reading the draft again (the assistant changed it) must never take back what the person typed and has not saved yet. The page saves 800 ms after the last change, so a reload in that
// window, or while a save is still on its way, used to replace their people, title or boxes with the server's older copy. `dirty` is the set of patch keys not yet confirmed by the server.
const KEYS = ["parties", "body", "sendOptions", "title", "description", "message"];
export function keepUnsaved(fetched, local, dirty) {
  if (!local) return fetched;
  const out = { ...fetched };
  for (const k of KEYS) if (dirty.has(k) && k in local) out[k] = local[k];
  return out;
}
