// ═══════════════════════════════════════════════════════════════════════════════════════════════
// BookingSettingsHub — rebuilt from webui/src/lib/screens/engagements/BookingSettingsHub.svelte.
// TASK 13.39 — BOOKING SETTINGS HUB. `/engagements/booking/settings`. Layout from
// `specs/mockups/SettingsBooking.frame.html`, behaviour from the Svelte source.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useEffect, useState } from "react";
import { request, api, ApiError } from "@/lib/api.js";
import ScreenState from "@/lib/empty/ScreenState.jsx";
import SettingsHubRow from "@/lib/shared/SettingsHubRow.jsx";
import PromptCard from "@/lib/prompts/PromptCard.jsx";
import { Switch } from "@/lib/components/ui/switch.jsx";
import BookingOffConfirm from "./BookingOffConfirm.jsx";

export default function BookingSettingsHub({ onNavigate = null }) {
  function go(href) {
    if (onNavigate) onNavigate(href);
    else window.location.assign(href);
  }

  const [phase, setPhase] = useState("loading");
  const [error, setError] = useState(null);
  const [view, setView] = useState(null);
  const [prompts, setPrompts] = useState([]);
  const [switchBusy, setSwitchBusy] = useState(false);
  const [switchError, setSwitchError] = useState(null);
  const [offConfirmOpen, setOffConfirmOpen] = useState(false);

  async function load() {
    setPhase("loading");
    setError(null);
    try {
      const data = await request("/api/engagements/booking-settings");
      setView(data);
      setPhase("ready");
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setPhase("denied");
        setError(err);
      } else {
        setPhase("error");
        setError(err instanceof ApiError
          ? { message: err.message, requestId: err.requestId }
          : { message: String(err?.message ?? err) });
      }
    }
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    let live = true;
    api.prompts("booking_settings").then((r) => { if (live) setPrompts(r?.prompts ?? []); })
      .catch(() => { if (live) setPrompts([]); });
    return () => { live = false; };
  }, []);

  async function dismissPromptNow(p) {
    try {
      await api.dismissPrompt(p.kind, p.subjectId ?? null);
      setPrompts((prev) => prev.filter((x) => x.dismissKey !== p.dismissKey));
    } catch {
      // ★ Same silent-fallback shape as NetworkListScreen — the card simply stays if the
      //   dismiss write fails; nothing else on this screen depends on it.
    }
  }

  const onlineEnabled = view?.keys?.["booking.online_enabled"] === true;
  const turnOff = view?.turnOff ?? null;

  async function handleSwitchToggle(next) {
    if (switchBusy) return;
    if (next === true) {
      setSwitchBusy(true);
      setSwitchError(null);
      try {
        await request("/api/settings", {
          method: "POST",
          body: { key: "booking.online_enabled", value: true },
        });
        await load();
      } catch (err) {
        setSwitchError(err instanceof ApiError ? err.message : String(err?.message ?? err));
      } finally {
        setSwitchBusy(false);
      }
    } else {
      // ★★★ Never writes from here — see header. Opens the DecisionModal, which owns the write.
      setOffConfirmOpen(true);
    }
  }

  function handleOffCancelled() {
    setOffConfirmOpen(false);
  }

  async function handleOffConfirmed() {
    setOffConfirmOpen(false);
    await load();
  }

  const HUB_ROWS = [
    {
      key: "calendar",
      label: "Calendar and booking",
      where: "Hours, notice, how far ahead, buffers, Google Calendar.",
      href: "/engagements/booking/settings/calendar",
    },
    {
      key: "team",
      label: "Team and website",
      where: "Who takes a booking, how one is picked, your booking links, and your website's key.",
      href: "/engagements/booking/settings/team",
    },
    {
      key: "paying",
      label: "Paying and cancelling",
      where: "What has to happen before someone books, and what a late cancellation costs.",
      href: "/engagements/booking/settings/paying",
    },
    {
      key: "sending",
      label: "What we send",
      where: "Fourteen things, each by email, text or push, at a time you choose.",
      href: "/engagements/booking/settings/sending",
    },
    {
      key: "history",
      label: "History",
      where: "Everything that happened, and who did it.",
      href: "/engagements/booking/settings/history",
    },
  ];

  return (
    <div className="flex w-full flex-col" data-testid="booking-settings-hub">
      <div className="mb-4.5">
        <h1 className="m-0 text-title font-medium tracking-tight text-ink">Booking</h1>
        <p className="m-0 mt-1.25 text-sm text-mute">Five sets of settings. Any service can do its own thing.</p>
      </div>

      <ScreenState
        phase={phase}
        error={phase === "error" ? error : null}
        reason={phase === "denied" ? (error?.message ?? null) : null}
        testIds={{ error: "booking-settings-hub-error", denied: "booking-settings-hub-denied" }}
      >
        <div className="flex flex-col gap-4">
          <div className="flex items-start gap-4 rounded-card border border-line bg-surface p-4" data-testid="booking-settings-hub-online-switch-row">
            <span className="flex flex-1 flex-col gap-0.75">
              <b className="text-ui font-medium text-ink">Online booking</b>
              <span className="text-xs text-mute leading-relaxed">
                Your booking page, and everywhere it's shared. Turning this off takes it off the internet.
              </span>
            </span>
            <Switch
              checked={onlineEnabled}
              disabled={switchBusy}
              data-testid="booking-settings-hub-online-switch"
              onCheckedChange={handleSwitchToggle}
            />
          </div>
          {switchError && (
            <p className="m-0 rounded-sm bg-bad-bg px-3.5 py-2.5 text-sm text-bad" role="alert" data-testid="booking-settings-hub-switch-error">{switchError}</p>
          )}

          <div className="flex gap-5.5 items-start">
            <div className="flex flex-1 flex-col gap-2.5">
              {HUB_ROWS.map((row) => (
                <div key={row.key} className="rounded-card border border-line bg-surface p-0 overflow-hidden">
                  <SettingsHubRow
                    label={row.label}
                    where={row.where}
                    href={row.href}
                    onNavigate={onNavigate}
                    testId={`booking-settings-hub-row-${row.key}`}
                  />
                </div>
              ))}
            </div>

            <div className="w-80 flex-shrink-0">
              <div className="rounded-card border border-line bg-surface overflow-hidden">
                <div className="border-b border-hair px-4.25 py-3.5 text-ui font-medium text-ink">Worth knowing</div>
                <div className="flex flex-col gap-2.5 p-3.5">
                  {prompts.length === 0 ? (
                    <p className="m-0 text-sm text-mute" data-testid="booking-settings-hub-prompts-empty">
                      Nothing needs your attention here right now.
                    </p>
                  ) : (
                    prompts.map((p) => (
                      <PromptCard
                        key={p.dismissKey}
                        icon={p.icon}
                        tone={p.tone}
                        headline={p.headline}
                        why={p.why}
                        action={p.action}
                        kind={p.kind}
                        onDismiss={() => dismissPromptNow(p)}
                        testId={`booking-settings-hub-prompt-${p.dismissKey}`}
                      />
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </ScreenState>

      {offConfirmOpen && (
        <BookingOffConfirm
          open={offConfirmOpen}
          onOpenChange={setOffConfirmOpen}
          turnOff={turnOff}
          onCancel={handleOffCancelled}
          onConfirmed={handleOffConfirmed}
        />
      )}
    </div>
  );
}
