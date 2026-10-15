// ═══════════════════════════════════════════════════════════════════════════════════════════════
// BookingSettingsTeamLeaf — the fifth Booking settings tab (6 Oct 2026). Frame: specs/mockups/BookingSettingsTeam.frame.html.
// Backend: GET /api/booking/team · POST /api/booking/team/service · POST /api/booking/team/rotate-key (src/routes/teamBookingAdmin.mjs).
// Who takes each public service, the rule that picks one, the booking links, each person's calendar state, and the website key (owner only).
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useEffect, useState } from "react";
import { request, ApiError } from "@/lib/api.js";
import ScreenState from "@/lib/empty/ScreenState.jsx";
import { Tabs, TabsList, TabsTrigger } from "@/lib/components/ui/tabs";
import { NativeSelect, NativeSelectOption } from "@/lib/components/ui/native-select.jsx";
import { Input } from "@/lib/components/ui/input.jsx";
import { Switch } from "@/lib/components/ui/switch.jsx";
import { Button } from "@/lib/components/ui/button.jsx";

const TABS = [
  { key: "calendar", label: "Calendar and booking", href: "/engagements/booking/settings/calendar" },
  { key: "team", label: "Team and website", href: "/engagements/booking/settings/team" },
  { key: "paying", label: "Paying and cancelling", href: "/engagements/booking/settings/paying" },
  { key: "sending", label: "What we send", href: "/engagements/booking/settings/sending" },
  { key: "history", label: "History", href: "/engagements/booking/settings/history" },
];
const RULE_LABELS = { round_robin: "Round robin — whoever had one longest ago", priority: "In the order below", least_booked: "Whoever has the fewest" };
const CAL_LABEL = { connected: "Calendar connected", not_connected: "Calendar not connected", needs_attention: "Calendar needs to be connected again" };

const rowCls = "flex gap-5 items-start";
const rowStyle = { padding: "16px 0", borderBottom: "1px solid var(--line-soft)" };
function Row({ label, sub, children, testId }) {
  return (
    <div className={rowCls} style={rowStyle} data-testid={testId}>
      <div style={{ width: "280px", flex: "0 0 280px" }}>
        <b className="block text-sm font-medium text-ink">{label}</b>
        {sub && <p className="m-0 mt-1 text-xs text-ink-muted leading-normal">{sub}</p>}
      </div>
      <div style={{ flex: "1 1 auto", maxWidth: "560px" }}>{children}</div>
    </div>
  );
}
const Url = ({ children, testId }) => (
  <code className="block rounded-sm bg-surface-sunken px-3 py-2 text-xs text-ink break-all" data-testid={testId}>{children ?? "—"}</code>
);

export default function BookingSettingsTeamLeaf({ onNavigate = null }) {
  const [phase, setPhase] = useState("loading");
  const [error, setError] = useState(null);
  const [view, setView] = useState(null);
  const [draft, setDraft] = useState({});          // serviceId → { hosts: {appUserId: priority}, rule }
  const [busy, setBusy] = useState(null);
  const [writeError, setWriteError] = useState(null);
  const [saved, setSaved] = useState(null);
  const [showKey, setShowKey] = useState(false);
  const [confirmRotate, setConfirmRotate] = useState(false);
  const [copied, setCopied] = useState(null);

  const go = (href) => (onNavigate ? onNavigate(href) : window.location.assign(href));
  const onTabChange = (value) => { const tab = TABS.find((t) => t.key === value); if (tab && tab.key !== "team") go(tab.href); };

  async function load() {
    setError(null);
    try {
      const data = await request("/api/booking/team");
      setView(data);
      setDraft(Object.fromEntries(data.services.map((s) => [s.id, {
        hosts: Object.fromEntries(s.hosts.map((h) => [h.appUserId, h.priority])),
        rule: s.rule ?? data.defaultRule,
      }])));
      setPhase("ready");
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) { setPhase("denied"); setError(err); }
      else { setPhase("error"); setError(err instanceof ApiError ? { message: err.message, requestId: err.requestId } : { message: String(err?.message ?? err) }); }
    }
  }
  useEffect(() => { load(); }, []);

  async function run(tag, fn) {
    setWriteError(null); setSaved(null); setBusy(tag);
    try { await fn(); } catch (err) { setWriteError(err instanceof ApiError ? err.message : String(err?.message ?? err)); } finally { setBusy(null); }
  }

  const saveService = (s) => run(`svc:${s.id}`, async () => {
    const d = draft[s.id];
    await request("/api/booking/team/service", { method: "POST", body: {
      serviceId: s.id, rule: d.rule, hosts: Object.entries(d.hosts).map(([appUserId, priority]) => ({ appUserId, priority: Number(priority) || 100 })),
    } });
    await load(); setSaved(s.id);
  });
  const setStaffChoice = (next) => run("choice", async () => { await request("/api/settings", { method: "POST", body: { key: "booking.show_staff_choice", value: next } }); await load(); });
  const rotate = () => run("rotate", async () => { await request("/api/booking/team/rotate-key", { method: "POST", body: {} }); setConfirmRotate(false); setShowKey(true); await load(); });
  async function copy(text, tag) {
    try { await navigator.clipboard.writeText(text); setCopied(tag); setTimeout(() => setCopied(null), 1500); } catch { setCopied(null); }
  }

  const staffName = (id) => view?.staff.find((u) => u.id === id)?.name ?? "";

  return (
    <div className="flex w-full flex-col" data-testid="booking-settings-team">
      <div className="mb-4.5">
        <h1 className="m-0 text-title font-medium tracking-tight text-ink">Booking settings</h1>
        <p className="m-0 mt-1.25 text-sm text-mute">How booking works for the whole practice. Any service can differ.</p>
      </div>
      <Tabs value="team" onValueChange={onTabChange} className="mb-5.5">
        <TabsList variant="line">
          {TABS.map((t) => <TabsTrigger key={t.key} value={t.key}>{t.label}</TabsTrigger>)}
        </TabsList>
      </Tabs>

      <ScreenState phase={phase} error={phase === "error" ? error : null} reason={phase === "denied" ? (error?.message ?? null) : null}
        testIds={{ error: "booking-team-error", denied: "booking-team-denied" }}>
        {view && (
          <>
            {writeError && <p className="m-0 mb-3 rounded-sm bg-bad-bg px-3.5 py-2.5 text-sm text-bad" role="alert" data-testid="booking-team-write-error">{writeError}</p>}
            {!view.onlineEnabled && (
              <p className="m-0 mb-3 rounded-sm bg-chip-warn-bg px-3.5 py-2.5 text-sm text-chip-warn-ink" data-testid="booking-team-off">
                Online booking is off, so none of these pages take bookings. Turn it on under Booking.
              </p>
            )}

            <section className="bg-surface border border-line rounded-card" style={{ marginBottom: "18px" }} data-testid="booking-team-pages">
              <div className="border-b border-line-soft text-sm font-medium text-ink" style={{ padding: "14px 17px" }}>Your booking pages</div>
              <div style={{ padding: "2px 17px 6px" }}>
                <Row label="The company page" sub="Anyone on the team can take a booking from here.">
                  <div className="flex items-center gap-2"><Url testId="booking-team-company-url">{view.urls.company}</Url>
                    {view.urls.company && <Button variant="outline" size="sm" onClick={() => copy(view.urls.company, "company")}>{copied === "company" ? "Copied" : "Copy"}</Button>}</div>
                </Row>
                <Row label="Each person's page" sub="Only that person's own times.">
                  {view.urls.people.length === 0 ? <span className="text-sm text-mute">Nobody has a booking link yet. People set theirs under My booking link.</span>
                    : <div className="flex flex-col gap-2">{view.urls.people.map((p) => (
                      <div key={p.appUserId} className="flex items-center gap-2"><span className="w-32 text-sm text-ink">{p.name}</span><Url>{p.url}</Url></div>))}</div>}
                </Row>
                <Row label="Your own domain" sub="Optional.">
                  {view.urls.custom ? <Url>{view.urls.custom}</Url> : <Button variant="link" size="sm" onClick={() => go("/settings/domains")}>Set up under Domains</Button>}
                </Row>
              </div>
            </section>

            {view.services.length === 0 && (
              <p className="m-0 mb-4 text-sm text-mute" data-testid="booking-team-no-services">No service on this practice has a booking name yet, so none can be booked from a website.</p>
            )}
            {view.services.map((s) => {
              const d = draft[s.id] ?? { hosts: {}, rule: view.defaultRule };
              return (
                <section key={s.id} className="bg-surface border border-line rounded-card" style={{ marginBottom: "18px" }} data-testid={`booking-team-service-${s.key}`}>
                  <div className="border-b border-line-soft text-sm font-medium text-ink" style={{ padding: "14px 17px" }}>{s.name}
                    <span className="ml-2 text-xs text-mute">{s.durationMinutes} min · {s.modalities.join(" or ") || "—"}{s.publicBookable ? "" : " · not open to the public"}</span></div>
                  <div style={{ padding: "2px 17px 6px" }}>
                    <Row label="Who takes it" sub="A booking goes to whoever is free. People who are off, or whose calendar is busy, are never offered.">
                      <div className="flex flex-col">
                        {view.staff.map((u) => {
                          const on = u.id in d.hosts;
                          return (
                            <div key={u.id} className="flex items-center gap-3 py-2" style={{ borderBottom: "1px solid var(--line-soft)" }} data-testid={`booking-team-person-${u.id}`}>
                              <input type="checkbox" checked={on} aria-label={`${u.name} takes ${s.name}`}
                                onChange={(e) => setDraft((p) => { const hosts = { ...p[s.id].hosts }; if (e.target.checked) hosts[u.id] = hosts[u.id] ?? 100; else delete hosts[u.id]; return { ...p, [s.id]: { ...p[s.id], hosts } }; })} />
                              <span className="flex-1 text-sm text-ink">{u.name}
                                <span className="block text-xs text-mute">{CAL_LABEL[u.calendar]}{u.needs.length ? ` · missing: ${u.needs.join(", ")}` : ""}</span></span>
                              {d.rule === "priority" && on && (
                                <Input type="number" min="1" max="1000" className="w-20" aria-label={`${u.name} order`} value={d.hosts[u.id]}
                                  onChange={(e) => setDraft((p) => ({ ...p, [s.id]: { ...p[s.id], hosts: { ...p[s.id].hosts, [u.id]: e.target.value } } }))} />)}
                            </div>
                          );
                        })}
                      </div>
                    </Row>
                    <Row label="How a person is chosen" sub="Round robin gives the next booking to whoever was given one longest ago.">
                      <NativeSelect value={d.rule} data-testid={`booking-team-rule-${s.key}`} onChange={(e) => setDraft((p) => ({ ...p, [s.id]: { ...p[s.id], rule: e.target.value } }))}>
                        {view.rules.map((r) => <NativeSelectOption key={r} value={r}>{RULE_LABELS[r] ?? r}</NativeSelectOption>)}
                      </NativeSelect>
                    </Row>
                    <div className="flex items-center gap-3" style={{ padding: "14px 0" }}>
                      <Button size="sm" disabled={busy === `svc:${s.id}` || Object.keys(d.hosts).length === 0} onClick={() => saveService(s)} data-testid={`booking-team-save-${s.key}`}>
                        {busy === `svc:${s.id}` ? "Saving…" : "Save"}</Button>
                      {Object.keys(d.hosts).length === 0 && <span className="text-xs text-mute">Choose at least one person.</span>}
                      {saved === s.id && <span className="text-xs text-ok" role="status">Saved.</span>}
                    </div>
                  </div>
                </section>
              );
            })}

            <section className="bg-surface border border-line rounded-card" style={{ marginBottom: "18px" }}>
              <div className="border-b border-line-soft text-sm font-medium text-ink" style={{ padding: "14px 17px" }}>Choosing a person</div>
              <div style={{ padding: "2px 17px 6px" }}>
                <Row label="Let people pick who they see" sub="Or let the system hand out whoever is free.">
                  <div className="flex items-start gap-3"><span className="flex-1 text-sm text-ink">Show a choice of staff when booking</span>
                    <Switch checked={view.staffChoice} disabled={busy === "choice"} data-testid="booking-team-choice-switch" onCheckedChange={setStaffChoice} /></div>
                </Row>
              </div>
            </section>

            <section className="bg-surface border border-line rounded-card" style={{ marginBottom: "18px" }} data-testid="booking-team-website">
              <div className="border-b border-line-soft text-sm font-medium text-ink" style={{ padding: "14px 17px" }}>Your website</div>
              <div style={{ padding: "2px 17px 6px" }}>
                <Row label="Where it calls" sub="The address your website sends bookings to.">
                  <Url testId="booking-team-api-base">{view.urls.apiBase}</Url>
                </Row>
                <Row label="Website key" sub="Your website uses this to book for you. It stays on the website's server, never in a page. Only an owner can see it.">
                  {!view.websiteConnection.masterConfigured ? (
                    <p className="m-0 text-sm text-bad" data-testid="booking-team-key-unavailable">Website booking isn't switched on for this server yet.</p>
                  ) : !view.websiteConnection.keyVisibleToYou ? (
                    <p className="m-0 text-sm text-mute" data-testid="booking-team-key-owner-only">Ask an owner for this key.</p>
                  ) : (
                    <div className="flex flex-col gap-2">
                      <Url testId="booking-team-key">{showKey ? view.websiteConnection.key : "msk_••••••••••••••••••••"}</Url>
                      <div className="flex gap-2">
                        <Button variant="outline" size="sm" onClick={() => setShowKey((v) => !v)} data-testid="booking-team-key-show">{showKey ? "Hide" : "Show"}</Button>
                        <Button variant="outline" size="sm" onClick={() => copy(view.websiteConnection.key, "key")} data-testid="booking-team-key-copy">{copied === "key" ? "Copied" : "Copy"}</Button>
                        {!confirmRotate
                          ? <Button variant="outline" size="sm" onClick={() => setConfirmRotate(true)} data-testid="booking-team-key-rotate">Make a new key</Button>
                          : <>
                              <Button size="sm" disabled={busy === "rotate"} onClick={rotate} data-testid="booking-team-key-rotate-confirm">Yes — the old key stops working now</Button>
                              <Button variant="ghost" size="sm" onClick={() => setConfirmRotate(false)}>Keep it</Button>
                            </>}
                      </div>
                    </div>
                  )}
                </Row>
              </div>
            </section>
          </>
        )}
      </ScreenState>
    </div>
  );
}
