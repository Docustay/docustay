// Which edition this is: the hosted service or a self-hosted install. The settings answer says so (selfHost), so one call settles it for every screen that differs (no Billing, the offline usage report, the Data tab). /api/setup/state is only served by a self-hosted install, so asking it from the hosted service logged a 404 on every page.
import { api } from "$lib/api.js";
export const edition = $state({ selfHost: null, testMode: false, rank: null });   // rank: the person's role in this workspace (owner | admin | member), from /api/nav — Run 8: a member's screens match what the server lets them do   // testMode: mirrored from the header switch, so a screen far from the header (the Send step) can tell the truth about email
let asked = false;
export async function loadEdition() {
  if (asked) return;
  asked = true;
  const r = await api("/api/documents/settings");
  edition.selfHost = Boolean(r.ok && r.json?.selfHost);
}
