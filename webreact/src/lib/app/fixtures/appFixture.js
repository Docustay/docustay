// A real AppState instance for stories and gates, filled from fixtures instead of the network.
import { AppState } from "@/lib/app/appState.js";
import { PERMISSIONS, ME_ID } from "./permissions.js";

/** @param as "owner" | "admin" | "member" | null (a client/portal session) */
export function appFixture({ as = "owner", nav = {}, me = {}, capabilities = null, ...fields } = {}) {
  const app = new AppState();
  // the network-backed loaders become no-ops in a fixture
  for (const k of ["boot", "loadNav", "loadPractices", "loadCapabilities", "loadCounts", "loadUnread", "openNotifications", "loadPortal"]) app[k] = async () => {};
  app.authed = true;
  app.me = { appUserId: ME_ID, displayName: "Example Owner", ...me };
  app.tenant = { id: "t1", slug: "foundry", name: "Example Practice Coaching", isPlatform: false, logoUrl: null };
  app.nav = { sections: [], rank: as, buildState: {}, me: app.me, tenant: app.tenant, permissions: as ? PERMISSIONS[as] : null, ...nav };
  app.capabilities = capabilities;
  for (const [k, v] of Object.entries(fields)) app[k] = v;
  return app;
}
