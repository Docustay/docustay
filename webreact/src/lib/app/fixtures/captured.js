// An AppState filled from the REAL responses scripts/capture-fixtures.mjs recorded (webreact/src/fixtures/*.json) —
// K11: a story renders what the product actually returns, never a hand-written shape. Network loaders are no-ops.
import { AppState } from "@/lib/app/appState.js";
import navOwner from "@/fixtures/nav.owner.json";
import navAdmin from "@/fixtures/nav.admin.json";
import navCoach from "@/fixtures/nav.coach.json";
import capsOwner from "@/fixtures/capabilities.owner.json";
import capsAdmin from "@/fixtures/capabilities.admin.json";
import capsCoach from "@/fixtures/capabilities.coach.json";
import notesOwner from "@/fixtures/notifications.owner.json";
import notesCoach from "@/fixtures/notifications.coach.json";
import practicesOwner from "@/fixtures/practices.owner.json";

const NAV = { owner: navOwner, admin: navAdmin, coach: navCoach };
const CAPS = { owner: capsOwner, admin: capsAdmin, coach: capsCoach };
const NOTES = { owner: notesOwner, admin: notesOwner, member: notesCoach };

/** @param rank "owner" | "admin" | `coach` */
export function capturedApp(rank = "owner", fields = {}) {
  const app = new AppState();
  for (const k of ["boot", "loadNav", "loadPractices", "loadCapabilities", "loadCounts", "loadUnread", "openNotifications", "loadPortal"]) app[k] = async () => {};
  const nav = NAV[rank].body;
  app.authed = true;
  app.nav = nav;
  app.me = nav.me;
  app.tenant = nav.tenant;
  app.capabilities = CAPS[rank].body;
  app.notifications = NOTES[rank].body.notifications;
  app.unread = NOTES[rank].body.notifications.filter((n) => !n.read_at).length;
  app.practices = practicesOwner.body.practices;
  for (const [k, v] of Object.entries(fields)) app[k] = v;
  return app;
}
