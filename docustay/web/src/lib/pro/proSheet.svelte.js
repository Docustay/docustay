// The one Explore Pro sheet (Run 8, motion board 2 piece 3): any Pro lock opens it, with the control it rose from, so it rises from that control. Mounted once in the signed-in layout.
import { askPreflight, showPlanSheet } from "./planPrompt.svelte.js";
export const proSheet = $state({ open: false, item: null, from: null });
// Part 2: a Pro lock opens the plan sheet with the server's own answer (what the person hit, where they stand, the options and their prices). Only when the server has nothing to offer (a locked item that
// no hosted plan sells, a self-hosted build) does the small Explore Pro card open instead.
const ASKS = { unlimited_templates: "create_template", template_limit: "create_template", unlimited_documents: "send_document", document_limit: "send_document", signer_limit: "send_document", team_roles: "invite_person", unlimited_people: "invite_person" };   // signer_limit: the chat's signer cap is a sending question (use_feature now refuses names it does not know)
export async function exploreProFrom(item, el = null) {
  const r = el?.getBoundingClientRect?.();
  const from = r ? { x: r.left + r.width / 2, y: r.bottom, top: r.top } : null;
  const act = ASKS[item], ans = await askPreflight(act ?? "use_feature", {}, act ? null : item);
  if (ans?.options?.length) { showPlanSheet(ans, { form: act ? "sheet" : "lock", ctx: { item } }); return; }
  proSheet.item = item; proSheet.from = from; proSheet.open = true;
}
export const closeProSheet = () => { proSheet.open = false; };

// Run 9 Part 3.7 (B1): the upgrade sheet — opened from Explore Pro, a Pro lock's tip or Billing, naming what the person tried (`item`)
export const upgradeSheet = $state({ open: false, item: null });
export function openUpgrade(item = null) { proSheet.open = false; upgradeSheet.item = item; upgradeSheet.open = true; }
export const closeUpgrade = () => { upgradeSheet.open = false; };
