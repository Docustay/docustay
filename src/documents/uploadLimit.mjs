// Part 30 item 6 — the biggest file one upload may be: the organisation's own `upload.max_mb` setting, further capped by what its plan allows (Free 25 MB, Pro 100 MB;
// an organisation on no plan — a self-hosted install — is limited by the setting alone). The island never reads the plan itself: it asks the host's `entitlements.maxUploadMb` port.
import { ports } from "./ports.mjs";
import { getDocumentSetting } from "./settings.mjs";

export async function uploadCapMb(tx, { tenantId }) {
  const setting = Number(await getDocumentSetting(tx, "upload.max_mb")) || 100;
  const P = await ports();
  const plan = P.entitlements?.maxUploadMb ? await P.entitlements.maxUploadMb(tx, { tenantId }) : null;
  return plan ? Math.min(setting, plan) : setting;
}
