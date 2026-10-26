// ═══════════════════════════════════════════════════════════════════════════════════════════════
// THE ROUTE TABLE (R3.Z, REACT-PLAN §4.4, Ruling R-5, R-54) — Screen.svelte's precedence, as DATA.
//
// ★★★ ORDER IS PRECEDENCE, FIRST MATCH WINS, transcribed from Screen.svelte:352-481 (the fetch) and :1057-2076 (the
//     render): still-on-React → client app → records and record-like ids → leads board → /home → settings forms →
//     platform → signup questions → engagements self-fetch → dedicated screens → section pages → list views (api.view).
// ★★★ PROPS ARE THE COMPONENT'S OWN DECLARED NAMES (TASKS field 4, from the Svelte compiler's props.json) — never
//     what Screen.svelte happened to pass. That is the fix for RECON §16 C1–C3: SetBranding reads `data` (was handed
//     `view`), MoneyInvoiceRecord reads `invoiceId` (was handed `id`), the Home variants call `onOpen` (were handed
//     `onNavigate`), ModifiersPage reads `data` (was handed nothing), PackageEditor requires five callbacks (was
//     handed none and threw). Gate db/gates/react_routes_resolve.mjs evaluates every `props` builder here against
//     the component's declared params and fails on a name the component does not read or a required one missing.
// ★★ Every pre-load Screen.svelte made is kept even where the component ignores the data: the load is what turns a
//    403 into the DENIED screen and a failure into the ERROR screen, instead of mounting a screen that then fails.
// ★★ A component is named by (section, name) → screenFiles.json → its file, or by file directly. No barrels (R-54).
// ★ A route never falls back to a spinner: nothing matched → the server's `api.view` answer, whose "section" kind
//   renders SectionNotBuilt with the server's reason.
//
//   row = { id, match(path, query) → params|null, load?(ctx) → Promise<data>, variants: [{ when?(ctx), component,
//           props(ctx), before?, after? }], surfaces?: { key: { component, props(ctx, args) } } }
//   ctx = { app, path, query, params, data, kind, onNavigate, refetch, done, closeForm, formDone, rank, me, open }
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { api } from "@/lib/api.js";
import { isStillOnReact, STILL_ON_REACT } from "@keystone/nav/stillOnReact.mjs";
import { pageFor, SECTION_PAGES } from "./sectionPages.js";
import { features } from "./features.js";

const S = (section, name) => ({ section, name });
const F = (file) => ({ file });
const UUID = "([0-9a-f-]{36})";
const exact = (p) => (path) => (path === p ? {} : null);
const re = (rx, ...names) => (path) => { const m = rx.exec(path); return m ? Object.fromEntries(names.map((n, i) => [n, decodeURIComponent(m[i + 1])])) : null; };
const view = async (c) => (await api.view(c.path));             // { kind, data }
// ★ Monday of the current week, browser-local, YYYY-MM-DD — /people/scheduling's pre-load (Screen.svelte:311-318).
function currentMonday() {
  const d = new Date(); const day = d.getDay(); const diff = day === 0 ? -6 : 1 - day;
  const m = new Date(d.getFullYear(), d.getMonth(), d.getDate() + diff); const pad = (n) => String(n).padStart(2, "0");
  return `${m.getFullYear()}-${pad(m.getMonth() + 1)}-${pad(m.getDate())}`;
}
const ONLY_NAV = (c) => ({ onNavigate: c.onNavigate });
const refetchDone = (c) => ({ onDone: c.refetch });

// ── the money list screens wear the Stripe banner above them (Screen.svelte:1766-1873) ──────────────────────────
const STRIPE_BANNER = { component: F("lib/money/StripeNeedsBanner.jsx"), props: () => ({}) };
// Part 29b item 4 — Docustay's own money, tagged "Docustay", read-only, rendered only for the people `platform.docustay_viewers` names (the server answers 403 to anyone else and the band renders nothing)
const DOCUSTAY_BAND = (kind) => ({ component: F("lib/money/DocustayMoneyBand.jsx"), props: () => ({ kind }) });

// ── `?new=1` surfaces (Screen.svelte:926-1055) — the ONE switch every list promising a New button answers through ──
export const NEW_SURFACE_COMPONENTS = {
  person: { component: S("people", "PersonForm"), props: (c) => ({ onCancel: c.closeForm, onDone: (id) => { c.done(); if (id) c.onNavigate(`/record/person/${id}`); else c.closeForm(); } }) },
  account: { component: S("accounts", "AccountForm"), props: (c) => ({ onCancel: c.closeForm, onDone: (id) => { c.done(); if (id) c.onNavigate(`/record/account/${id}`); else c.closeForm(); } }) },
  payerGroup: { component: S("accounts", "NewAccountSheet"), props: (c) => ({ onCancel: c.closeForm, onDone: (id) => { c.done(); if (id) c.onNavigate(`/record/account/${id}`); else c.closeForm(); } }) },
  money: { component: S("money", "MoneyActions"), props: (c) => ({ people: c.data?.people ?? [], plans: c.data?.plans ?? [], services: c.data?.services ?? [], rank: c.rank, openNew: c.newSurface?.open, onDone: c.formDone }) },
  // ★ the maintainer, 29 Sep 2026 (Docustay brief) — "templateBuilder" retired here too; see surfaceRegistry.js's
  //   own note at the two keys that used to select it. TemplateBuilder.jsx (the component) is left
  //   in place, unregistered — DocTemplateEditor.jsx is the one real template creator now.
  webhookEndpoint: { component: S("settings", "WebhookEndpointForm"), props: (c) => ({ onCancel: c.closeForm, onDone: c.formDone }) },
  // ★ the maintainer, 29 Sep 2026 — SLIDEUP-AUDIT.md headline finding: the real InvoiceEditor.jsx (R6.035, 863
  //   lines, built from the InvoiceEditor frame) had no route; this surface opened InvoiceDrawer.jsx
  //   instead (253 lines, no frame at all). InvoiceDrawer is retired; InvoiceEditorSlideUp adapts
  //   InvoiceEditor's route-shaped props into this surface and wraps it in SlideUpScreen.
  // ★ the maintainer, 29 Sep 2026 — F818: `editId` reopens this surface on an EXISTING draft instead of always
  //   creating a new one — see InvoiceEditorSlideUp.jsx. Additive: nothing sets `editId` except the
  //   invoices list's own draft rows (MoneyInvoicesInvoicesList.jsx), so every other `?new=1&for=…`
  //   caller is unaffected.
  invoice: { component: S("money", "InvoiceEditorSlideUp"), props: (c) => ({ initialPayerUserId: c.query?.for ?? null, invoiceId: c.query?.editId ?? null, onCancel: c.closeForm, onDone: c.formDone }) },
  // ★ the maintainer, 29 Sep 2026 — used to pass templates/people from `c.data`, which only a "page"-type
  //   route's own PAGE_LOADS entry populates; DocsSend.jsx now fetches its own (see its header
  //   note), so this works identically from every route type that opens it.
  sendDocument: { component: S("documents", "SendDocumentDrawer"), props: (c) => ({ builder: c.path.includes("/forms/") ? "form" : "contract", onCancel: c.closeForm, onDone: c.formDone }) },
  // ★ Square Contracts rebuild, 29 Sep 2026 — DocsHome's own "New document" button, the stepped
  //   wizard (template → up to 20 recipients → preview → send) from §3 of the rebuild ruling.
  newDocument: { component: F("lib/screens/documents/NewDocumentWizard.jsx"), props: (c) => ({ onCancel: c.closeForm, onDone: c.formDone }) },
};

// ── the record page's action strip, keyed by the SHELL TYPE the server sends (Screen.svelte:702-821) ──────────────
export const RECORD_ACTIONS = [
  { type: "person", component: S("people", "PersonActions"), props: (c) => ({ person: { id: c.params.id, display_name: c.data.shell.header?.title ?? null, email: c.data.shell.fields?.email ?? null, role: c.data.shell.fields?.role ?? null, staff_role: c.data.shell.fields?.staff_role ?? null, lifecycle_status: c.data.shell.fields?.lifecycle_status ?? null, firebase_uid: c.data.shell.fields?.firebase_uid ?? null }, rank: c.rank, onDone: c.done }) },
  { type: "booking", component: S("engagements", "AttendanceControl"), props: (c) => ({ booking: { id: c.params.id, ...(c.data.shell.fields ?? {}) }, participants: c.data?.relatedRows?.participants ?? [], onDone: c.done }) },
  { type: "document", component: S("documents", "DocumentActions"), props: (c) => ({ document: { id: c.params.id, ...(c.data.shell.fields ?? {}) }, rank: c.rank, onDone: c.done }) },
  { type: "account", component: S("accounts", "AccountActions"), props: (c) => ({ account: { id: c.params.id, name: c.data.shell.header?.title ?? null, ...(c.data.shell.fields ?? {}) }, scheduleItems: c.data?.relatedRows?.scheduleItems ?? [], rank: c.rank, onDone: c.done }) },
  // Part 29b item 4 — Docustay customers and installs: a read-only panel, only for the people the platform names (it renders nothing, and asks for nothing, on any other account)
  { id: "docustay-account-panel", type: "account", component: F("lib/record/DocustayAccountPanel.jsx"), props: (c) => ({ accountId: c.params.id, accountType: (c.data.shell.panels ?? []).flatMap((p) => p.fields ?? []).find((f) => f.field === "account_type")?.value ?? null }) },
  { type: ["service", "plan"], component: S("items", "ItemsRecordActions"), props: (c) => ({ item: { id: c.params.id, itemType: c.data.shell.type, name: c.data.shell.header?.title ?? null, active: !!c.data.shell.header?.status }, whatKeepsWorking: c.data?.whatKeepsWorking ?? {}, rank: c.rank, onDone: c.done }) },
];
export const ARCHIVE_CONTROL = { component: F("lib/record/ArchiveControl.jsx"), props: (c) => ({ type: c.data.shell.type, id: c.params.id, archived: !!c.data.shell.archived, rank: c.rank, onDone: c.refetch }) };

// ── dedicated screens: a loader and a renderer per fixed path (Screen.svelte:186-304 + :1376-1958) ────────────────
const D = (path, load, component, props, extra = {}) => ({ id: `dedicated:${path}`, match: exact(path), load, variants: [{ component, props, ...extra }] });
const VIEW_RANK_DONE = (c) => ({ view: c.data, rank: c.rank, onDone: c.refetch });
const DEDICATED = [
  D("/settings", () => api.settingsHome(), S("settings", "SettingsHome"), (c) => ({ view: c.data, onNavigate: c.onNavigate })),
  D("/settings/integrations", () => api.settingsIntegrations(), S("settings", "IntegrationsScreen"), (c) => ({ view: c.data, onNavigate: c.onNavigate, onDone: c.refetch })),
  // RolesScreen was never built in React; the old address opens the working roles screen.
  D("/settings/roles", () => api.teamRolesSettings(), S("settings", "TeamRolesScreen"), (c) => ({ view: c.data, rank: c.rank, onNavigate: c.onNavigate, onDone: c.refetch })),
  D("/people/team", () => api.teamRoster(), S("people", "TeamListScreen"),
    (c) => ({ data: c.data, rank: c.rank, onNavigate: c.onNavigate, onDone: c.refetch, onSeeAs: c.app.enterSeeAs, myAppUserId: c.me?.appUserId ?? null }),
    { after: [{ when: (c) => c.query?.invite === "1", component: S("people", "TeamInviteDrawer"), props: (c) => ({ seats: c.data?.seats, onCancel: c.closeForm, onDone: c.formDone }) }] }),
  D("/settings/roles/presets", () => api.teamRolesSettings(), S("settings", "TeamRolesScreen"), (c) => ({ view: c.data, rank: c.rank, onNavigate: c.onNavigate, onDone: c.refetch })),
  D("/settings/terminology", () => api.terminologySettings(), S("settings", "TerminologyScreen"), VIEW_RANK_DONE),
  // Programs & client types (QUEUE §4, 2 Oct 2026): client-type words share the terminology store, so the pre-load is the same read.
  D("/settings/programs", () => api.terminologySettings(), S("settings", "ProgramsAndClientTypes"), (c) => ({ view: c.data, rank: c.rank, onNavigate: c.onNavigate, onDone: c.refetch })),
  D("/settings/client-app", () => api.clientAppSettings(), S("settings", "ClientAppScreen"), VIEW_RANK_DONE),
  D("/settings/shape", () => api.shapeSettings(), S("settings", "ShapeScreen"), VIEW_RANK_DONE),
  D("/settings/documents", () => api.documentAxes(), S("settings", "DocumentAxesScreen"), VIEW_RANK_DONE),
  D("/settings/notifications", () => api.notificationPrefs(), S("settings", "NotificationPrefsScreen"), (c) => ({ view: c.data, onNavigate: c.onNavigate, onDone: c.refetch })),
  D("/settings/developer/api-keys", () => api.apiKeys(), S("settings", "ApiKeysScreen"), VIEW_RANK_DONE),
  D("/settings/developer/audit-log", () => api.auditLog(), S("settings", "AuditLogScreen"), (c) => ({ view: c.data })),
  D("/settings/developer", () => api.developerSettings(), S("settings", "SetDeveloper"), (c) => ({ view: c.data, onNavigate: c.onNavigate })),
  D("/tasks/automations", () => api.automations(), S("tasks", "AutomationsPage"), ONLY_NAV),
  D("/settings/email", () => api.emailSettings(), S("settings", "EmailSettingsPage"), (c) => ({ mailbox: c.data?.mailbox ?? null, routing: c.data?.routing ?? {}, lastChanged: c.data?.lastChanged ?? null, rank: c.rank, onNavigate: c.onNavigate, onDone: c.refetch })),
  D("/settings/billing", () => api.billingSettings(), S("settings", "SetBilling"), (c) => ({ view: c.data, rank: c.rank, onNavigate: c.onNavigate, onDone: c.refetch })),
  D("/settings/plans", () => api.plansSettings(), S("settings", "SetPlans"), VIEW_RANK_DONE),
  D("/account/security", () => api.accountSecurity(), F("lib/screens/SecurityScreen.jsx"), (c) => ({ view: c.data, onDone: c.refetch })),
  // ★ the maintainer, 23 Oct 2026 (sidebar audit): ONE sign-in page. Account security (sessions + two-step, every role) replaces the older staff-only session list.
  D("/settings/sign-in", () => api.accountSecurity(), F("lib/screens/SecurityScreen.jsx"), (c) => ({ view: c.data, onDone: c.refetch })),
  D("/settings/calendar", () => api.calendarSettings(), S("settings", "CalendarSettingsScreen"), (c) => ({ view: c.data, onNavigate: c.onNavigate, onDone: c.refetch, calendarPreferences: c.me?.calendarPreferences ?? null })),
  D("/network", () => api.networkParties(), S("network", "NetworkListScreen"), (c) => ({ data: c.data, onNavigate: c.onNavigate, onDone: c.refetch })),
  D("/settings/import", () => api.importSettings(), S("settings", "SetImport"), (c) => ({ view: c.data, onNavigate: c.onNavigate, onDone: c.refetch })),
  D("/settings/data", () => api.dataSettings(), S("settings", "SetData"), (c) => ({ view: c.data, rank: c.rank, onNavigate: c.onNavigate, onDone: c.refetch })),
  D("/people/scheduling", () => api.schedule(currentMonday()), S("people", "SchedulingScreen"), ONLY_NAV),
  D("/accounts/all", () => api.payerGroups(), S("accounts", "AccountsList"), ONLY_NAV, { newSurface: true }),
  D("/network/releases", async () => ({}), S("network", "NetworkReleases"), ONLY_NAV),
  // ★ FOUND LIVE, 28 Sep 2026 — "New invoice" changed the URL to ?new=1 and opened nothing. Two
  //   bugs stacked: this D() entry never set `newSurface: true` (Screen.jsx:86 gates the whole
  //   ?new=1 mechanism on it — compare /accounts/all above, which does set it), and
  //   surfaceRegistry.js's NEW_SURFACES entry named a component key ("invoiceEditor") that does
  //   not exist in NEW_SURFACE_COMPONENTS — the real, already-built, already-used-elsewhere
  //   invoice-creation surface is keyed "invoice" (InvoiceDrawer.jsx; AccountRecord.jsx already
  //   deep-links to /money/invoices?new=1&for=… expecting exactly this). InvoiceDrawer needs a
  //   real `people` list to fill its payer picker (required to submit at all, no manual-entry
  //   fallback) — moneyInvoicesSummary() never returned one, so `load` now also fetches it via
  //   the same api.view() mechanism other screens already use for people lists.
  D("/money/invoices", async (c) => {
    // ★ InvoiceDrawer's line-item picker (itemOf/catalogue.map) needs {id, name, amountMinor,
    //   sourceType}. src/money/writes.mjs's LINE_ITEM_SOURCES is exactly ["service", "package",
    //   "plan", "modifier"] — modifiers are never sold as a standalone invoice line on their own,
    //   so services + packages + plans is the real catalogue. Each list route returns
    //   price_amount_minor (confirmed against webreact/src/fixtures/list.items.{services,
    //   packages,plans}.owner.json — MEASURED, not guessed), mapped to amountMinor here since
    //   that is the field name the drawer already reads.
    const toItem = (sourceType) => (r) => ({ id: r.id, name: r.name, amountMinor: r.price_amount_minor ?? null, sourceType });
    const [summary, peopleView, servicesView, packagesView, plansView] = await Promise.all([
      api.moneyInvoicesSummary(),
      api.view("/people/all").catch(() => ({ data: { rows: [] } })),
      api.view("/items/services").catch(() => ({ data: { rows: [] } })),
      api.view("/items/packages").catch(() => ({ data: { rows: [] } })),
      api.view("/items/plans").catch(() => ({ data: { rows: [] } })),
    ]);
    const catalogue = [
      ...(servicesView.data?.rows ?? []).map(toItem("service")),
      ...(packagesView.data?.rows ?? []).map(toItem("package")),
      ...(plansView.data?.rows ?? []).map(toItem("plan")),
    ];
    return { ...summary, people: peopleView.data?.rows ?? [], catalogue };
  }, S("money", "MoneyInvoices"), ONLY_NAV, { before: [STRIPE_BANNER, DOCUSTAY_BAND("invoices")], newSurface: true }),
  D("/money/estimates", () => api.moneyEstimates(), F("lib/screens/money/MoneyEstimates.jsx"), (c) => ({ path: c.path, params: c.params, app: c.app, onNavigate: c.onNavigate, onRefetch: c.refetch }), { before: [STRIPE_BANNER] }),
  D("/money/subscriptions", () => api.moneySubscriptions(), F("lib/screens/money/MoneySubs.jsx"), ONLY_NAV, { before: [STRIPE_BANNER, DOCUSTAY_BAND("subscriptions")] }),
  D("/money/payments", () => api.moneyPayments(), S("money", "MoneyPayments"), (c) => ({ view: c.data, onNavigate: c.onNavigate }), { before: [STRIPE_BANNER, DOCUSTAY_BAND("payments")] }),
  D("/money/credits", () => api.moneyCredits(), F("lib/screens/money/MoneyCredits.jsx"), ONLY_NAV, { before: [STRIPE_BANNER] }),
  D("/money/payouts", () => api.moneyPayouts(), S("money", "MoneyPayouts"), ONLY_NAV, { before: [STRIPE_BANNER] }),
  D("/money/disputes", () => api.moneyDisputes(), S("money", "MoneyDisputes"), ONLY_NAV, { before: [STRIPE_BANNER] }),
  D("/money/balances", () => api.moneyBalances(), F("lib/screens/money/MoneyBalances.jsx"), ONLY_NAV, { before: [STRIPE_BANNER] }),
  D("/money/readers", () => api.moneyDevices(), F("lib/screens/money/MoneyReaders.jsx"), ONLY_NAV, { before: [STRIPE_BANNER] }),
  D("/money/connect", () => api.moneyConnect(), S("money", "MoneyConnect"), ONLY_NAV),
  D("/settings/money", () => api.moneySettings(), F("lib/screens/money/MoneySettings.jsx"), ONLY_NAV),
  // ★ There is no read route for payment links (src/routes/money.mjs:190) — Screen.svelte called api.moneyPaymentLinks,
  //   which does not exist, so the Svelte path always failed. Nothing to pre-load; the screen does its own reads.
  D("/money/payment-links", async () => ({}), F("lib/screens/money/PaymentLinks.jsx"), ONLY_NAV, { before: [STRIPE_BANNER] }),
  D("/money/payment-methods", async () => ({}), F("lib/screens/money/PaymentMethods.jsx"), ONLY_NAV),
  D("/money/virtual-terminal", async () => ({}), F("lib/screens/money/VirtualTerminal.jsx"), ONLY_NAV),
  D("/money/statements", async () => ({}), F("lib/screens/money/MoneyStatements.jsx"), ONLY_NAV),
  D("/tasks/mine", () => api.taskList("mine"), S("tasks", "TasksMine"), (c) => ({ app: c.app, onNavigate: c.onNavigate })),
  D("/tasks/team", () => api.taskList("team"), S("tasks", "TasksTeam"), (c) => ({ data: c.data, onNavigate: c.onNavigate, onDone: c.refetch })),
  D("/growth/campaigns", () => api.campaigns(), S("growth", "Campaigns"), ONLY_NAV),
  D("/growth/campaigns/new", async () => null, S("growth", "CampaignEditor"), (c) => ({ campaignId: null, onNavigate: c.onNavigate })),
  D("/growth/lists", () => api.segments(), S("growth", "Segments"), (c) => ({ onNavigate: c.onNavigate, rows: c.data?.rows ?? [] })),
  D("/reports", () => api.reportsHub(), S("reports", "ReportsHome"), ONLY_NAV),
  // ★ The report screens are PRESENTATION: their data/phase/range props are fed by the reports task (R8) — the
  //   router hands what Screen.svelte handed (onNavigate, and `app` where declared). R8 owns the report shell.
  D("/reports/money", null, S("reports", "ReportMoney"), ONLY_NAV),
  D("/reports/people", null, S("reports", "ReportPeople"), ONLY_NAV),
  D("/reports/sessions", null, S("reports", "ReportSessions"), (c) => ({ app: c.app, onNavigate: c.onNavigate })),
  D("/reports/found", null, S("reports", "ReportLeads"), ONLY_NAV),
  D(`/reports/coaches`, null, S("reports", "ReportCoaches"), ONLY_NAV),
  D("/reports/receipt", null, S("reports", "RunReceipt"), ONLY_NAV),
  D("/settings/developer/webhook-log", () => api.webhookEndpoints(), S("settings", "SettingsWebhookLog"), (c) => ({ view: c.data })),
  D("/settings/domains", () => api.customDomains(), S("settings", "SettingsDomains"), (c) => ({ view: c.data, onRefetch: c.refetch })),
  D("/settings/branding", () => api.brandingSettings(), S("settings", "SetBranding"), (c) => ({ data: c.data, onNavigate: c.onNavigate })),
  D("/settings/usage", () => api.settingsUsage(), S("settings", "SetUsage"), ONLY_NAV),
  D("/settings/mine", () => api.settingsMine(), F("lib/screens/settings/SettingsMine.jsx"), (c) => ({ view: c.data, onNavigate: c.onNavigate, onDone: c.refetch })),
  D("/settings/fields-required", () => api.requiredFields(), S("settings", "RequiredFieldsScreen"), () => ({})),
  D("/home/prompts", () => api.promptFeed({}), S("home", "PromptFeed"), () => ({})),
  { id: "dedicated:/whats-new", match: (p) => (p === "/whats-new" || p === "/whats-new/log" ? {} : null), load: () => api.whatsNew(), variants: [{ component: S("whatsnew", "WhatsNew"), props: () => ({}) }] },
];

// ── engagements screens that fetch for themselves (Screen.svelte:340-350, :1143-1230) ─────────────────────────────
const SELF = (path, name, props = ONLY_NAV) => ({ id: `self:${path}`, match: exact(path), variants: [{ component: S("engagements", name), props }] });
// ★ Booking everywhere (frames 15, 18, 28): the staff booking screens live in lib/screens/booking/, named by FILE (R-54), and fetch for themselves.
const SELF_FILE = (path, file, props = ONLY_NAV) => ({ id: `self:${path}`, match: exact(path), variants: [{ component: F(file), props }] });
const ENGAGEMENTS_SELF = [
  SELF_FILE("/engagements/booking/pages", "lib/screens/booking/BookingPagesScreen.jsx"),
  SELF_FILE("/engagements/booking/mine", "lib/screens/booking/MyBookingScreen.jsx"),
  SELF("/engagements/booking/rules", "ServiceRulesScreen"),
  SELF("/engagements/booking/channels", "BookingChannelsScreen"),
  SELF("/engagements/availability", "AvailabilityScreen"),
  SELF("/engagements/booking/settings/calendar", "BookingSettingsCalendarLeaf", (c) => ({ onNavigate: c.onNavigate, hostId: c.me?.appUserId ?? null })),
  SELF("/engagements/booking/settings/team", "BookingSettingsTeamLeaf"),
  SELF("/engagements/booking/settings/paying", "BookingSettingsPayingLeaf"),
  SELF("/engagements/booking/settings/sending", "BookingSettingsSendingLeaf"),
  SELF("/engagements/booking/settings/history", "BookingHistoryLeaf"),
];

// ── section pages (sectionPages.js): each page component takes its OWN declared props ───────────────────────────
const PAGE = (c) => ({ path: c.path, params: c.params, app: c.app, onNavigate: c.onNavigate, onRefetch: c.refetch });
// ★ the maintainer, 29 Sep 2026 (Square Contracts rebuild) — "redirect every old address," extended: Sent and
//   the four Templates sub-tabs are retired too, folded into the two unified lists (DocsHome.jsx,
//   DocsTemplates.jsx), each of which reads its filter chip's initial state from a query param so
//   an old bookmark for "Waiting" or "Agreements" still lands pre-filtered instead of just dumping
//   the person on the unfiltered list.
const OLD_DOCUMENT_ADDRESSES = Object.freeze({
  "/settings/booking-link":         "/engagements/booking/mine",   // the old My link page: your own page is on My booking / Booking pages (23 Oct 2026)
  "/engagements/booking/links":    "/engagements/booking/pages?show=custom",   // the old Booking links tab is gone; its pages are Custom pages (23 Oct 2026)
  "/items/programs":               "/settings/programs",   // Programs moved to Settings → Programs & client types (2 Oct 2026)
  "/documents/pipeline":            "/documents?status=waiting",
  "/documents/contracts":           "/documents/templates?type=agreements",
  "/documents/contracts/all":       "/documents?type=agreements",
  "/documents/forms":               "/documents/templates?type=forms",
  "/documents/executed":            "/documents?status=signed",
  "/documents/sent":                "/documents",
  "/documents/sent/all":            "/documents",
  "/documents/sent/waiting":        "/documents?status=waiting",
  "/documents/sent/signed":         "/documents?status=signed",
  "/documents/sent/declined":       "/documents?status=declined",
  "/documents/sent/expired":        "/documents?status=expired",
  "/documents/templates/all":       "/documents/templates",
  "/documents/templates/agreements": "/documents/templates?type=agreements",
  "/documents/templates/forms":      "/documents/templates?type=forms",
  "/documents/templates/retired":    "/documents/templates?type=retired",
});
const PAGE_PROPS = {
  // F97: /items/discounts[/new|/:id] → the same address under /items/coupons (everything else still falls back to the table, then /documents)
  Redirect: (c) => ({ to: OLD_DOCUMENT_ADDRESSES[c.path] ?? (c.path.startsWith("/items/discounts") ? c.path.replace("/items/discounts", "/items/coupons") : "/documents"), onNavigate: c.onNavigate }),
  PackageEditor: (c) => ({
    packageId: c.params.id ?? null,
    onClose: () => c.onNavigate("/items/packages"),
    onChangePrice: (args) => c.open("changePrice", args),
    onAttachAgreement: (args) => c.open("attachAgreement", args),
    onSeeCredits: () => c.onNavigate("/money/credits"),
    onOpenBookingPage: () => c.onNavigate("/engagements/booking/pages?show=custom"),
  }),
  ModifiersPage: (c) => ({ data: c.data, rank: c.rank, onNavigate: c.onNavigate, onDone: c.refetch }),
  OptionsPage: (c) => ({ onNavigate: c.onNavigate, onDone: c.refetch, rank: c.rank }),
  UnitsPage: ONLY_NAV, GiftCardsPage: ONLY_NAV, ItemsDefaultsPage: ONLY_NAV, MoneyAccountManagement: ONLY_NAV, SetTax: ONLY_NAV,
  LandingPages: ONLY_NAV, Campaigns: ONLY_NAV,
  ...Object.fromEntries(["Dashboard", "Website", "Search", "AiVisibility", "Listings", "Reviews", "Social", "Ads", "Calls", "Competitors", "Connections"]
    .map((n) => [`Run${n}`, (c) => ({ rank: c.rank, onNavigate: c.onNavigate })])),

  // ★ the maintainer, 29 Sep 2026 — FOUND LIVE: `() => ({})` handed TemplateList no `onNavigate` at all, so
  //   every row click and "New template" called `onNavigate?.(...)` against `undefined` — silently
  //   doing nothing. `TemplateEditor` gets the `:key` param the new route above carries; "new" is
  //   `handleEdit(null)`'s destination (fixed below to read "new", not the literal string "null").
  TemplateList: (c) => ({ onNavigate: c.onNavigate }),
  TemplateEditor: (c) => ({
    templateKey: c.params.key && c.params.key !== "new" ? c.params.key : null,
    onNavigate: c.onNavigate,
  }),
  CampaignEditor: (c) => ({ campaignId: c.params.id ?? null, onNavigate: c.onNavigate }),
  Segments: (c) => ({ onNavigate: c.onNavigate, rows: c.data?.rows ?? [] }),
  // ★ FOUND LIVE, 28 Sep 2026 — DocTemplateEditor's own guard threw on every load because nothing
  //   ever supplied onPreview, even though a real destination (DocPreview.jsx) is already
  //   registered at /documents/:id/preview.
  // ★ the maintainer, 29 Sep 2026 (Docustay brief) — the Publish button no longer takes an `onPublish` prop at
  //   all: it opens DocsPublish.jsx (14.69, newly built) via DocTemplateEditor's own local state,
  //   the same way its other in-editor modals already work. Nothing to pass here any more.
  SourceWriter: PAGE,
  DocTemplateEditor: (c) => ({ ...PAGE(c), onPreview: (id) => c.onNavigate(`/documents/${id}/preview`) }),
  // ★ the maintainer, 29 Sep 2026 — FOUND LIVE: DocPreview's own guard throws because nothing ever supplied
  //   `onSend` — "Send it" was drawn dead. The real send surface (routes.js's `sendDocument`,
  //   14.70's DocsSend) only opens via `?new=1` on a path surfaceRegistry.js's NEW_SURFACES
  //   recognises; a per-id preview path can't be a static table entry, and DocsSend itself has no
  //   way to take a preselected template. Same known shortcut DocPipeline's own "Send a document"
  //   button already uses (routes to the generic contracts/forms send drawer, not a preselected
  //   one) — `builder` (tagged onto each row during DocPreview's own fetch, just above) picks
  //   which of the two.
  DocPreview: (c) => ({
    ...PAGE(c),
    onSend: (id, builder) => c.onNavigate(builder === "form" ? "/documents/forms/all?new=1" : "/documents/contracts/all?new=1"),
  }),
  // ★ the maintainer, 29 Sep 2026 — FOUND LIVE: ServiceEditor's "Change price" button has always called
  //   `onChangePrice?.(...)` against `undefined` — no entry here, no `changePrice` surface below.
  //   Same `ModalChangePrice` PackageEditor already opens (subjectType 'service' this time), same
  //   pattern. `onAddVariation` deliberately stays unwired: no ModalAddVariation component exists
  //   anywhere in the tree to open, and building one is outside this ruling's scope — it only
  //   renders when `variationRows` is already non-empty, which nothing in this codebase creates
  //   today, so it stays a found-not-fixed note rather than a second unscoped build.
  ServiceEditor: (c) => ({
    path: c.path, params: c.params, app: c.app, onNavigate: c.onNavigate, onRefetch: c.refetch,
    onChangePrice: (args) => c.open("changePrice", args),
  }),
};
const PAGE_LOADS = {
  ModifiersPage: async (c) => (await api.view(c.path)).data,   // C3: the list view the server already serves for this path
  Segments: () => api.segments().then((r) => r ?? { rows: [] }),
};
const PAGE_SURFACES = {
  PackageEditor: {
    changePrice: { component: S("items", "ModalChangePrice"), props: (c, a, close) => ({ open: true, subjectType: a?.subjectType, subjectId: a?.subjectId, onClose: close, onOpenChange: () => close(), onChanged: () => { close(); c.refetch(); } }) },
    attachAgreement: { component: S("items", "ModalAttachAgreement"), props: (c, a, close) => ({ open: true, itemType: a?.itemType, itemId: a?.itemId, onClose: close, onOpenChange: () => close(), onAttached: () => { close(); c.refetch(); } }) },
  },
  // ★ the maintainer, 29 Sep 2026 — the same ModalChangePrice PackageEditor already uses. `ServiceEditor` calls
  //   `onChangePrice({service: record.item})`, so `a.service.id` (not `a.subjectId`) is the shape
  //   arriving here — named explicitly rather than guessing.
  ServiceEditor: {
    changePrice: { component: S("items", "ModalChangePrice"), props: (c, a, close) => ({ open: true, subjectType: "service", subjectId: a?.service?.id, itemName: a?.service?.name ?? null, onClose: close, onOpenChange: () => close(),
      // F90: the editor passes its own `onChanged` so a new price re-reads only the price and keeps the unsaved draft; a refetch here would unmount the editor.
      onChanged: (res) => { close(); if (typeof a?.onChanged === "function") a.onChanged(res); else c.refetch(); } }) },
  },
};
const PAGES = {
  id: "page",
  // ★ the maintainer, 23 Oct 2026 — the 11 sample-data Run screens route only while the beta's runScreens switch is on;
  //   switched off (production), their paths fall through to the server's answer exactly as before.
  match: (p) => {
    const hit = pageFor(p);
    if (!hit) return null;
    if (hit.section === "run" && hit.component.startsWith("Run") && !features().runScreens) return null;
    return { ...hit.params, $page: hit };
  },
  load: (c) => (PAGE_LOADS[c.params.$page.component] ? PAGE_LOADS[c.params.$page.component](c) : null),
  // ★ the maintainer, 29 Sep 2026 — FOUND LIVE: Pipeline's "Send a document" button (and its own empty-state
  //   copy) navigates to `<path>?new=1`, and surfaceRegistry.js maps /documents/contracts/all and
  //   /documents/forms/all to a real "sendDocument" surface — but this variant never carried
  //   `newSurface: true`, so Screen.jsx:86's `variant.newSurface && newSurface` gate was false for
  //   EVERY page routed through this generic section-page type, no matter what surfaceRegistry.js
  //   said. The button was a guaranteed dead end for any component reached this way (DocsList
  //   included). `newSurface: true` only OPENS the slot; surfaceFor(path) (per-path, unchanged)
  //   still decides whether anything actually renders in it, same as the "list" variant and
  //   `/accounts/all` already do above.
  variants: [{ component: (c) => S(c.params.$page.section, c.params.$page.component), props: (c) => (PAGE_PROPS[c.params.$page.component] ?? PAGE)(c), newSurface: true }],
  surfaces: (c) => PAGE_SURFACES[c.params.$page.component] ?? null,
};

// ── the list views (api.view), with the renderer overrides Screen.svelte applies by path (:1073-1266) ─────────────
// ★ SECTION C (the maintainer, 1 Oct 2026) — active/paused/former are bulk-eligible the same way all/clients/
//   adolescents/parents/leads already are; archived is not (its only bulk-shaped action is restore,
//   which BulkBar does not model today).
const PEOPLE_BULK_PATHS = new Set(["/people/all", "/people/clients", "/people/adolescents", "/people/parents", "/people/leads", "/people/active", "/people/paused", "/people/former"]);
const PEOPLE_LEDGER_PATHS = new Set([...PEOPLE_BULK_PATHS, "/people/archived"]);
export { PEOPLE_BULK_PATHS };
const LIST = (c) => c.kind === "list";
const VIEW_FALLBACK = {
  id: "view",
  match: () => ({}),
  load: view,
  variants: [
    { when: (c) => LIST(c) && c.path === "/documents/pipeline", component: S("documents", "StageBoard"), props: (c) => ({ view: c.data, rows: c.data.rows, onOpen: (t, id) => c.onNavigate(`/record/${t}/${id}`) }) },
    { when: (c) => LIST(c) && c.path === "/engagements/calendar", component: S("engagements", "WeekView"), props: (c) => ({ view: c.data, rows: c.data.rows, timezone: c.data.timezone ?? null, onOpen: (t, id) => c.onNavigate(`/record/${t}/${id}`), onNavigate: c.onNavigate }) },
    { when: (c) => LIST(c) && c.path === "/engagements/sessions", component: S("engagements", "SessionsLedger"), props: (c) => ({ view: c.data, onNavigate: c.onNavigate, onDone: c.refetch }) },
    { when: (c) => c.path === "/engagements/waitlist", component: S("engagements", "WaitlistScreen"), props: (c) => ({ onNavigate: c.onNavigate, onDone: c.refetch, myAppUserId: c.me?.appUserId ?? null }) },
    { when: (c) => LIST(c) && c.path === "/engagements/booking", component: S("engagements", "OnlineBookingScreen"), props: ONLY_NAV },
    { when: (c) => LIST(c) && c.path === "/engagements/booking/settings", component: S("engagements", "BookingSettingsHub"), props: ONLY_NAV },
    { when: (c) => LIST(c) && PEOPLE_LEDGER_PATHS.has(c.path), component: S("people", "PeopleLedger"), props: (c) => ({ view: c.data, path: c.path, rank: c.rank, onNavigate: c.onNavigate, onDone: c.refetch }), newSurface: true },
    { when: LIST, component: "list", newSurface: true },
    { when: (c) => c.kind === "section", component: F("lib/shell/SectionNotBuilt.jsx"), props: (c) => ({ path: c.data.path, label: c.data.label ?? c.data.path, state: c.data }) },
  ],
};

export const ROUTES = [
  { id: "still-on-react", match: (p) => (isStillOnReact(p) ? {} : null), variants: [{ component: F("lib/screens/StillOnReact.jsx"), props: (c) => ({ path: c.path, label: STILL_ON_REACT[c.path]?.label ?? c.path }) }] },
  {
    id: "client-app", match: (p) => (p.startsWith("/app/") ? {} : null),
    load: async (c) => {
      const list = await api.appSurfaces();
      const row = (list.surfaces ?? []).find((s) => s.path === c.path);
      return { role: list.role, terms: list.terms ?? {}, surface: row ? row.key : c.path.replace(/^\/app\//, ""), data: row ? await api.appRead(row.api) : null };
    },
    variants: [{ component: S("portal", "ClientApp"), props: (c) => ({ role: c.data.role, surface: c.data.surface, data: c.data.data, terms: c.data.terms, onNavigate: c.onNavigate }) }],
  },
  {
    id: "record", match: re(/^\/record\/([^/]+)\/([^/]+)$/, "type", "id"),
    load: (c) => api.record(c.params.type, c.params.id),
    variants: [
      { when: (c) => c.data?.shell?.type === "person", component: F("lib/record/PersonRecord.jsx"), props: (c) => ({ data: c.data, personId: c.params.id, rank: c.rank, onNavigate: c.onNavigate, onDone: c.done }) },
      { component: "record" },
    ],
  },
  { id: "team-remove", match: re(/^\/people\/team\/([^/]+)\/remove$/, "personId"), load: (c) => api.offboardPreview(c.params.personId),
    variants: [{ component: S("people", "TeamRemoveScreen"), props: (c) => ({ preview: c.data, personId: c.params.personId, onNavigate: c.onNavigate, onDone: () => { c.refetch(); c.onNavigate("/people/team"); } }) }] },
  { id: "account-record", match: re(new RegExp(`^/accounts/${UUID}$`), "id"), load: (c) => api.payerGroup(c.params.id),
    variants: [{ component: S("accounts", "AccountRecord"), props: (c) => ({ id: c.params.id, onNavigate: c.onNavigate }) }] },
  { id: "network-partner", match: re(new RegExp(`^/network/${UUID}$`), "id"), load: (c) => api.networkPartner(c.params.id),
    variants: [{ component: S("network", "NetworkPartner"), props: (c) => ({ data: c.data, onNavigate: c.onNavigate, onDone: c.refetch }) }] },
  { id: "team-see-as", match: re(/^\/people\/team\/([^/]+)\/see-as$/, "personId"),
    variants: [{ component: S("people", "TeamSeeAs"), props: (c) => ({ personId: c.params.personId, onNavigate: c.onNavigate }) }] },
  { id: "money-invoice", match: re(new RegExp(`^/money/invoices/${UUID}$`), "id"), variants: [{ component: F("lib/screens/money/MoneyInvoiceRecord.jsx"), props: (c) => ({ invoiceId: c.params.id, onNavigate: c.onNavigate }) }] },
  { id: "money-payment", match: re(new RegExp(`^/money/payments/${UUID}$`), "id"), variants: [{ component: F("lib/screens/money/MoneyPaymentRecord.jsx"), props: (c) => ({ id: c.params.id, onNavigate: c.onNavigate }) }] },
  { id: "money-subscription", match: re(new RegExp(`^/money/subscriptions/${UUID}$`), "id"), variants: [{ component: F("lib/screens/money/MoneySubRecord.jsx"), props: (c) => ({ subscriptionId: c.params.id, onNavigate: c.onNavigate }) }] },
  { id: "money-payout", match: re(new RegExp(`^/money/payouts/${UUID}$`), "id"), variants: [{ component: F("lib/screens/money/PayoutDetail.jsx"), props: (c) => ({ payoutId: c.params.id, onNavigate: c.onNavigate }) }] },
  { id: "money-dispute", match: re(new RegExp(`^/money/disputes/${UUID}$`), "id"), variants: [{ component: F("lib/screens/money/DisputeDetail.jsx"), props: (c) => ({ id: c.params.id, onNavigate: c.onNavigate }) }] },
  // ★ `key` is React's own and never reaches a component: AutomationEdit takes `automationKey` (Ruling 27 Sep).
  { id: "automation-edit", match: re(/^\/tasks\/automations\/([^/]+)$/, "key"), variants: [{ component: S("tasks", "AutomationEdit"), props: (c) => ({ automationKey: c.params.key, onNavigate: c.onNavigate }) }] },
  { id: "leads-board", match: (p, q) => (p === "/people/leads" && q?.view === "board" ? {} : null), variants: [{ component: S("people", "LeadBoard"), props: (c) => ({ app: c.app, onNavigate: c.onNavigate }) }] },
  {
    id: "home", match: exact("/home"), load: () => api.home(),
    variants: [
      { when: (c) => !c.data, component: S("home", "HomeLoading"), props: () => ({}) },
      { when: (c) => c.data.view === "staff", component: S("home", "HomeStaff"), props: (c) => ({ data: c.data, onOpen: c.onNavigate, onDismiss: c.refetch }) },
      { when: (c) => c.data.view === "first_run", component: S("home", "HomeFirstRun"), props: (c) => ({ data: c.data, onOpen: c.onNavigate, onDismiss: c.refetch }) },
      { component: S("home", "Home"), props: (c) => ({ data: c.data, onOpen: c.onNavigate, onDismiss: c.refetch }) },
    ],
  },
  { id: "settings-form:/settings/practice", match: exact("/settings/practice"), load: () => api.practiceSettings(), variants: [{ component: S("settings", "SettingsForm"), props: (c) => ({ data: c.data, onSaved: () => { c.refetch(); c.app.loadNav?.(); } }) }] },
  { id: "settings-form:/settings/developer/sandbox", match: exact("/settings/developer/sandbox"), load: () => api.sandboxSettings(), variants: [{ component: S("settings", "SettingsForm"), props: (c) => ({ data: c.data, onSaved: () => { c.refetch(); c.app.loadNav?.(); } }) }] },
  { id: "platform", match: (p) => (p === "/platform" || p.startsWith("/platform/") ? {} : null), variants: [{ component: S("platform", "PlatformScreen"), props: (c) => ({ app: c.app, path: c.path, onNavigate: c.onNavigate }) }] },
  { id: "signup-questions", match: exact("/signup/questions"), variants: [{ component: S("home", "SignupQuestions"), props: (c) => ({ onDone: async () => { await c.app.loadNav(); c.onNavigate("/home"); } }) }] },
  // an emailed or in-app notice about a document links to /documents/<id> (the Documents island's own address, which is a page in the stand-alone product): here the document is a record
  { id: "document-bare-link", match: re(new RegExp(`^/documents/${UUID}$`), "id"), variants: [{ component: S("documents", "Redirect"), props: (c) => ({ to: `/record/document/${c.params.id}`, onNavigate: c.onNavigate }) }] },
  ...ENGAGEMENTS_SELF,
  ...DEDICATED,
  PAGES,
  VIEW_FALLBACK,
];

/** The first row whose `match` answers — never null: the api.view fallback matches everything. */
export function resolveRoute(path, query = {}) {
  for (const route of ROUTES) {
    const params = route.match(path, query);
    if (params) return { route, params };
  }
  throw new Error(`resolveRoute: nothing matched ${path} — the fallback row is missing`);
}

/** The variant that renders for this context (a variant with no `when` always matches). */
export function variantFor(route, ctx) {
  return route.variants.find((v) => !v.when || v.when(ctx)) ?? null;
}

export { SECTION_PAGES };
