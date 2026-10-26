// ═══════════════════════════════════════════════════════════════════════════════════════════════
// THE APPLICATION'S SHARED STATE — ported from webui/src/lib/app/appState.svelte.js (REACT-PLAN R1.5).
//
// ★★★ IT COMPOSES. IT DOES NOT DECIDE. Every list, record, refusal and not-built state comes from the
//     server (U16). Same fields, same methods, same behaviour as the Svelte class; the only change is
//     HOW it notifies: the instance is an observable (every property write notifies subscribers) and
//     React reads it through `useAppState()` (useSyncExternalStore). No React import here — gates and
//     tests construct it and call `boot()` with no React at all.
// ★★ Methods are arrow-function fields, exactly as in Svelte, so a component can pass `app.loadNav`
//    around without losing `this` (the F230 lesson recorded in the Svelte header).
// ★ NEW: `permissions` — the viewer's resolved grants/actions from `/api/nav` (RP.1, REACT-PLAN §4.5).
//   `<Can>`/`useWrite` read it. It is null until nav loads, and null for a client principal.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { setFeatures } from "./features.js";
import { api, ApiError } from "@/lib/api.js";
import { blockedResolver } from "@/lib/empty/blocked.js";
import { setTerms } from "@/lib/terminology/terms.js";
import { performWrite, writeDecision } from "@/lib/permissions/write.js";

export class AppState {
  authed = null;
  nav = null;
  navError = null;
  tenant = null;
  // ★ F440 — a client session is a THIRD state, not a flavour of `authed`.
  portal = false;
  portalNav = null;
  portalError = null;
  portalData = null;
  portalSurfaceKey = null;
  practices = null;
  practicesError = null;
  switchingTo = null;
  capabilities = null;
  navCounts = {};
  unread = 0;
  notifications = null;
  notifLoading = false;
  notifError = null;
  me = null;
  sidebarCollapsed = false;
  density = "compact";
  viewingAs = null;
  refetchSignal = 0;
  paletteOpen = false;
  paletteQuery = "";
  bookOpen = false;
  recordTitle = null;
  viewportWidth = typeof window !== "undefined" ? window.innerWidth : 1440;
  query = {};
  seeAsError = null;

  constructor() {
    // ★★ Every data field becomes an accessor ON THE INSTANCE, so a write from anywhere — including the
    //    arrow-function methods below, which capture the instance itself — notifies. (A Proxy returned
    //    from the constructor would NOT work: arrow fields capture the raw instance, not the proxy.)
    const listeners = new Set();
    let version = 0;
    const values = {};
    for (const key of Object.keys(this)) {
      if (typeof this[key] === "function") continue;
      values[key] = this[key];
      Object.defineProperty(this, key, {
        enumerable: true,
        get: () => values[key],
        set: (v) => { if (values[key] === v) return; values[key] = v; version += 1; for (const l of [...listeners]) l(); },
      });
    }
    this.subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
    this.getSnapshot = () => version;
  }

  // ── derived (Svelte $derived → getters; recomputed on read, cheap) ─────────────────────────────
  get isBlocked() { return blockedResolver(this.capabilities?.checklist); }
  get setupSummary() { return this.capabilities?.checklist?.summary ?? null; }
  get nextSetupStep() {
    const groups = this.capabilities?.checklist?.groups ?? [];
    const needsYou = groups.find((g) => g.key === "needs_you")?.rows ?? [];
    const row = needsYou[0];
    return row ? { label: row.whatToDo ?? row.title, href: row.fixUrl, action: "Do this" } : null;
  }
  get permissions() { return this.nav?.permissions ?? null; }

  stateFor = (p) =>
    this.nav?.buildState?.[p] ??
    { state: "no_read_path", reason: "the server did not report a state for this row" };

  loadNav = async () => {
    try {
      this.nav = await api.nav();
      setTerms(this.nav?.terms);
      setFeatures(this.nav?.features);
      this.me = this.nav?.me ?? null;
      this.sidebarCollapsed = this.me?.sidebarCollapsed === true;
      this.density = this.me?.density ?? "compact";
      this.viewingAs = this.nav?.viewingAs ?? null;
      this.tenant = this.nav?.tenant ?? null;
      this.authed = true;
      this.navError = null;
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        this.portal = true;
        this.authed = true;
        this.navError = null;
        return;
      }
      if (err instanceof ApiError && err.status === 401) {
        this.authed = false;
        return;
      }
      this.navError = err;
      this.authed = true;
    }
  };

  loadPractices = async () => {
    try {
      this.practices = (await api.practices()).practices ?? [];
      this.practicesError = null;
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return;
      this.practicesError = err;
    }
  };

  loadCapabilities = async () => {
    try { this.capabilities = await api.capabilities(); }
    catch { this.capabilities = null; }
  };

  loadCounts = async () => {
    try {
      const data = await api.home();
      const next = {};
      for (const t of data?.tiles ?? []) {
        if (t?.path && Number.isFinite(t.count)) next[t.path] = t.count;
      }
      this.navCounts = next;
    } catch { this.navCounts = {}; }
  };

  loadUnread = async () => {
    try { this.unread = (await api.unreadCount())?.unread ?? 0; }
    catch { this.unread = 0; } // ★ chrome: a failed count shows no badge, never an error banner
  };

  openNotifications = async () => {
    this.notifLoading = true;
    this.notifError = null;
    try {
      const data = await api.notifications();
      this.notifications = data?.notifications ?? [];
      if (Number.isFinite(data?.unread)) this.unread = data.unread;
    } catch (err) {
      this.notifError = err;
      this.notifications = null;
    } finally {
      this.notifLoading = false;
    }
  };

  markRead = async (id) => {
    if (writeDecision(this.permissions, "markRead").hidden) return; // F775: no optimistic clear the server refuses
    this.unread = Math.max(0, this.unread - 1);
    if (Array.isArray(this.notifications)) {
      this.notifications = this.notifications.map((r) =>
        (r.id === id ? { ...r, read_at: new Date().toISOString() } : r));
    }
    try { await performWrite(this.permissions, "markRead", [id]); } catch { /* the re-read below is the correction */ }
    this.loadUnread();
  };

  markAllRead = async () => {
    if (writeDecision(this.permissions, "markAllRead").hidden) return; // F775
    this.unread = 0;
    if (Array.isArray(this.notifications)) {
      this.notifications = this.notifications.map((r) => ({ ...r, read_at: new Date().toISOString() }));
    }
    try { await performWrite(this.permissions, "markAllRead"); } catch { /* the re-read below is the correction */ }
    this.loadUnread();
  };

  toggleSidebar = () => {
    this.sidebarCollapsed = !this.sidebarCollapsed;
    performWrite(this.permissions, "setSidebarCollapsed", [this.sidebarCollapsed]).catch(() => {});
  };

  setDensity = (density) => {
    this.density = density;
    performWrite(this.permissions, "setDensity", [density]).catch(() => {});
  };

  signOut = async () => {
    try { await performWrite(this.permissions, "logout"); } catch { /* best-effort, exactly as the route is */ }
    this.me = null;
    this.viewingAs = null;
    this.notifications = null;
    this.tenant = null;
    this.portal = false;
    this.portalNav = null;
    this.practices = null;
    this.authed = false;
    // F46: a deliberate sign-out goes to the sign-in page, not to the "You are signed out" denial panel.
    try { if (typeof window !== "undefined") window.location.assign("/login"); } catch { /* no navigation here (a test host) */ }
  };

  switchPractice = async (slug) => {
    if (!slug) return;
    this.switchingTo = slug;
    try { await performWrite(this.permissions, "logout"); } catch { /* best-effort */ }
    this.practices = null;
    this.authed = false;
  };

  enterSeeAs = async (personId) => {
    this.seeAsError = null;
    try {
      const { viewingAs } = await performWrite(this.permissions, "teamSeeAs", [{ personId }]);
      this.viewingAs = viewingAs;
    } catch (err) {
      this.seeAsError = err instanceof ApiError ? err.message : String(err?.message ?? err);
      throw err;
    }
  };

  exitSeeAs = async () => {
    this.seeAsError = null;
    try {
      await performWrite(this.permissions, "teamSeeAsExit");
      this.viewingAs = null;
    } catch (err) {
      this.seeAsError = err instanceof ApiError ? err.message : String(err?.message ?? err);
      throw err;
    }
  };

  loadPortal = async () => {
    try {
      this.portalNav = await api.appSurfaces();
      this.portalError = null;
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) { this.authed = false; return; }
      this.portalError = err;
    }
  };

  loadPortalSurface = async (key) => {
    const row = (this.portalNav?.surfaces ?? []).find((s) => s.key === key);
    if (!row?.api) { this.portalData = null; return; }
    this.portalSurfaceKey = key;
    try {
      this.portalData = await api.appRead(row.api);
      this.portalError = null;
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) { this.authed = false; return; }
      this.portalData = null;
      this.portalError = err;
    }
  };

  boot = async () => {
    await this.loadNav();
    if (this.portal) { await this.loadPortal(); return; }
    if (this.authed !== true) return;
    await Promise.all([
      this.loadPractices(), this.loadCapabilities(), this.loadCounts(), this.loadUnread(),
    ]);
  };
}
