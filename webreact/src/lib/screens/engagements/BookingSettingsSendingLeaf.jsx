// ═══════════════════════════════════════════════════════════════════════════════════════════════
// R5.011 — BookingSettingsSendingLeaf: rebuild from specs/mockups/BookingSettingsSending.frame.html
// Ported from webui/src/lib/screens/engagements/BookingSettingsSendingLeaf.svelte (464 lines,
// 67 of them <style>): same props, testids and copy; markup/data/handlers ported; styles become
// Tailwind utilities + tokens (20 ks-* classes replaced).
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useState, useEffect } from "react";
import { request, ApiError } from "@/lib/api.js";
import { api } from "@/lib/api.js";
import ScreenState from "@/lib/empty/ScreenState.jsx";
import DisabledWithReason from "@/lib/forms/DisabledWithReason.jsx";
import { Switch } from "@/lib/components/ui/switch.jsx";
import { Badge } from "@/lib/components/ui/badge.jsx";
import { Tabs, TabsList, TabsTrigger } from "@/lib/components/ui/tabs.jsx";
import * as NativeSelect from "@/lib/components/ui/native-select.jsx";
import { toast } from "sonner";
import BookingSettingsSendingLeafTable1Table from "./BookingSettingsSendingLeafTable1Table.jsx";

const LEAF_TABS = [
  { key: "calendar", label: "Calendar and booking", href: "/engagements/booking/settings/calendar" },
  { key: "team", label: "Team and website", href: "/engagements/booking/settings/team" },
  { key: "paying", label: "Paying and cancelling", href: "/engagements/booking/settings/paying" },
  { key: "sending", label: "What we send", href: "/engagements/booking/settings/sending" },
  { key: "history", label: "History", href: "/engagements/booking/settings/history" },
];

// ★ BOOKING OVERHAUL, 29 Sep 2026 — the single reminder-minutes dropdown is replaced by three
//   independent toggles (matching src/booking/reminders.mjs's own DEFAULT_REMINDER_OFFSETS exactly,
//   so a practice that never touches this screen keeps the identical 24h-only behaviour it always
//   had). REMINDER_KEY/DEFAULT_REMINDER_MINUTES stay defined ONLY because a booking's own per-booking
//   override (never set by any caller today, but a real, honoured column) is still read from it.
const REMINDER_KEY = "booking.reminder_minutes";
const DEFAULT_REMINDER_MINUTES = 1440;
const REMINDER_OFFSET_KEY = "booking.reminder_offsets";
const DEFAULT_REMINDER_OFFSETS = [
  { minutes: 2880, enabled: false, label: "48 hours before" },
  { minutes: 1440, enabled: true, label: "24 hours before" },
  { minutes: 60, enabled: false, label: "1 hour before" },
];

export default function BookingSettingsSendingLeaf({ onNavigate = null }) {
  const [phase, setPhase] = useState("loading");
  const [error, setError] = useState(null);
  const [view, setView] = useState(null);
  const [notifTopics, setNotifTopics] = useState([]);
  const [reminderOffsets, setReminderOffsets] = useState(DEFAULT_REMINDER_OFFSETS);
  const [reminderBusyMinutes, setReminderBusyMinutes] = useState(null);
  const [reminderProblem, setReminderProblem] = useState(null);
  const [mailbox, setMailbox] = useState(null);
  const [senderProblem, setSenderProblem] = useState(null);
  const [rowBusy, setRowBusy] = useState(null);

  const rows = view?.rows ?? [];
  const channelsAvailable = view?.channelsAvailable ?? { email: true, text: false, push: false };
  const rowsByKey = new Map(rows.map((r) => [r.key, r]));

  function go(href) {
    if (onNavigate) onNavigate(href);
    else window.location.assign(href);
  }

  function topicChecked(topic, channel) {
    const t = notifTopics.find((x) => x.key === topic);
    return t?.roles?.client_parent?.[channel] ?? true;
  }

  function cellFor(row, channel) {
    if (row.state === "switchable") {
      return { kind: "switch", checked: topicChecked(row.topic, channel) };
    }
    if (row.state === "always_on") {
      return { kind: "text", text: "Always sent" };
    }
    if (row.state === "no_switch") {
      return { kind: "text", text: row.reason };
    }
    if (row.state === "shared") {
      const target = rowsByKey.get(row.sharesWith);
      return {
        kind: "disabled",
        checked: true,
        reason: `Uses the same setting as ${target?.name ?? row.sharesWith} above — one message, whoever did it`,
      };
    }
    return { kind: "disabled", checked: false, reason: row.reason ?? "Not built yet." };
  }

  async function load() {
    setPhase("loading");
    setError(null);
    try {
      const [matrix, notif] = await Promise.all([
        request("/api/engagements/sending-matrix"),
        request("/api/settings/notifications"),
      ]);
      setView(matrix);
      setNotifTopics(notif?.topics ?? []);
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
      return;
    }

    try {
      const bs = await request("/api/engagements/booking-settings");
      const stored = bs?.keys?.[REMINDER_OFFSET_KEY];
      const byMinutes = new Map((Array.isArray(stored) ? stored : []).map((o) => [o.minutes, o.enabled]));
      setReminderOffsets(DEFAULT_REMINDER_OFFSETS.map((d) => ({
        ...d, enabled: byMinutes.has(d.minutes) ? byMinutes.get(d.minutes) : d.enabled,
      })));
    } catch (err) {
      setReminderProblem(err instanceof ApiError ? err.message : String(err?.message ?? err));
    }

    try {
      const es = await request("/api/settings/email");
      setMailbox(es?.mailbox ?? null);
    } catch (err) {
      setSenderProblem(err instanceof ApiError ? err.message : String(err?.message ?? err));
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function onToggle(row, channel, next) {
    const testIdBase = `sending-row-${row.key}-${channel}`;
    setRowBusy(testIdBase);
    try {
      await api.setNotificationRule({ topic: row.topic, role: "client_parent", channel, enabled: next });
      setNotifTopics(notifTopics.map((t) => (t.key !== row.topic ? t : {
        ...t,
        roles: { ...t.roles, client_parent: { ...t.roles?.client_parent, [channel]: next } },
      })));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : String(err?.message ?? err));
    } finally {
      setRowBusy(null);
    }
  }

  // ★ BOOKING OVERHAUL, 29 Sep 2026 — one toggle, one PATCH of the whole three-entry array (the
  //   setting is stored and validated as one closed-shape value, src/settings/keys.mjs's own
  //   `reminderOffsets` validator — there is no per-offset write route, nor does there need to be).
  async function onOffsetToggle(minutes, next) {
    const previous = reminderOffsets;
    const updated = reminderOffsets.map((o) => (o.minutes === minutes ? { ...o, enabled: next } : o));
    setReminderOffsets(updated);
    setReminderProblem(null);
    setReminderBusyMinutes(minutes);
    try {
      await api.setSetting({
        key: REMINDER_OFFSET_KEY,
        value: updated.map(({ minutes: m, enabled }) => ({ minutes: m, enabled })),
      });
    } catch (err) {
      setReminderOffsets(previous);
      setReminderProblem(err instanceof ApiError ? err.message : String(err?.message ?? err));
    } finally {
      setReminderBusyMinutes(null);
    }
  }

  const mailboxVerified = !!(
    mailbox?.email &&
    mailbox?.addresses?.find((a) => a.email === mailbox.email)?.verified
  );

  function channelCell(row, channel, testIdBase) {
    if (channel === "text") {
      return (
        <DisabledWithReason disabled={true} reason="Text messages aren't set up yet" testId={testIdBase}>
          {({ disabled, describedBy }) => (
            <Switch
              checked={false}
              disabled={disabled}
              aria-describedby={describedBy}
              aria-label={`${row.name} — Text`}
              data-testid={`${testIdBase}-toggle`}
            />
          )}
        </DisabledWithReason>
      );
    }
    if (channel === "push" && !channelsAvailable.push) {
      return (
        <DisabledWithReason disabled={true} reason="No push service configured" testId={testIdBase}>
          {({ disabled, describedBy }) => (
            <Switch
              checked={false}
              disabled={disabled}
              aria-describedby={describedBy}
              aria-label={`${row.name} — Push`}
              data-testid={`${testIdBase}-toggle`}
            />
          )}
        </DisabledWithReason>
      );
    }

    const cell = cellFor(row, channel);
    if (cell.kind === "switch") {
      return (
        <Switch
          checked={cell.checked}
          disabled={rowBusy === testIdBase}
          aria-label={`${row.name} — ${channel === "email" ? "Email" : "Push"}`}
          onCheckedChange={(v) => onToggle(row, channel, v)}
          data-testid={`${testIdBase}-toggle`}
        />
      );
    }
    if (cell.kind === "text") {
      return <span className="text-sm text-ink-faint" data-testid={`${testIdBase}-reason`}>{cell.text}</span>;
    }
    return (
      <DisabledWithReason disabled={true} reason={cell.reason} testId={testIdBase}>
        {({ disabled, describedBy }) => (
          <Switch
            checked={cell.checked}
            disabled={disabled}
            aria-describedby={describedBy}
            aria-label={`${row.name} — ${channel === "email" ? "Email" : "Push"}`}
            data-testid={`${testIdBase}-toggle`}
          />
        )}
      </DisabledWithReason>
    );
  }

  return (
    <div className="w-full flex flex-col gap-2" data-testid="booking-settings-sending">
      <div className="flex flex-col gap-1">
        <h1 className="m-0 font-fraunces text-title font-medium text-ink">Booking settings</h1>
        <p className="m-0 text-ui text-ink-muted">Fourteen things we can send. Turn any of them off.</p>
      </div>

      <Tabs value="sending" className="w-full">
        <TabsList className="mb-5.5 border-b border-line flex gap-5.5 bg-transparent h-auto p-0 rounded-none" aria-label="Booking settings sections">
          {LEAF_TABS.map((t) => (
            <TabsTrigger
              key={t.key}
              value={t.key}
              data-testid={`sending-leaf-tab-${t.key}`}
              aria-current={t.key === "sending" ? "page" : undefined}
              onClick={(e) => { e.preventDefault(); if (t.key !== "sending") go(t.href); }}
              className="px-0 pb-2.5 font-medium text-sm text-ink-muted border-b-2 border-transparent data-[state=active]:text-ink data-[state=active]:border-brand rounded-none"
            >
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <ScreenState
        phase={phase}
        error={phase === "error" ? error : null}
        reason={phase === "denied" ? (error?.message ?? null) : null}
        testIds={{ error: "sending-error", denied: "sending-denied" }}
      >
        <section className="w-full bg-surface border border-line rounded-card mt-2" data-testid="sending-block-around">
          <div className="flex items-center gap-2.5 px-2 py-2 border-b border-line-soft">
            <b className="flex-1 text-ui font-medium text-ink">Around a session</b>
            <DisabledWithReason
              disabled={true}
              reason="Wording is fixed in code for now — there's no editor yet."
              testId="sending-edit-wording"
            >
              {({ disabled, describedBy }) => (
                <span
                  aria-disabled={disabled}
                  aria-describedby={describedBy}
                  className="text-meta text-ink cursor-default"
                  data-testid="sending-edit-wording-link"
                >
                  Edit the wording
                </span>
              )}
            </DisabledWithReason>
          </div>

          <div className="w-full overflow-x-auto">
            <BookingSettingsSendingLeafTable1Table
              rows={rows}
              reminderOffsets={reminderOffsets}
              reminderBusyMinutes={reminderBusyMinutes}
              reminderProblem={reminderProblem}
              onOffsetToggle={onOffsetToggle}
              channelCell={channelCell}
              rowBusy={rowBusy}
            />
          </div>
        </section>

        <section className="w-full bg-surface border border-line rounded-card mt-2" data-testid="sending-block-how-they-read">
          <div className="flex items-center gap-2.5 px-2 py-2 border-b border-line-soft">
            <b className="text-ui font-medium text-ink">How they read</b>
          </div>

          <div className="flex gap-2.5 items-start px-2 py-2 border-b border-line-soft" data-testid="sending-sender-row">
            <div className="w-[280px] flex-shrink-0 flex flex-col gap-1">
              <b className="text-ui text-ink font-medium">Who they come from</b>
              <span className="text-meta text-ink-muted">The name and address people see.</span>
            </div>
            <div className="flex-1 min-w-0 flex items-center gap-2.5 flex-wrap">
              <DisabledWithReason
                disabled={true}
                reason="Managed in Email settings — open it to change this."
                testId="sending-sender"
              >
                {({ disabled, describedBy }) => (
                  <span
                    aria-disabled={disabled}
                    aria-describedby={describedBy}
                    className="text-ui text-ink"
                    data-testid="sending-sender-email"
                  >
                    {mailbox?.email ?? "Not connected yet"}
                  </span>
                )}
              </DisabledWithReason>
              {mailboxVerified && (
                <Badge className="bg-chip-ok-bg text-chip-ok-ink" data-testid="sending-sender-verified">
                  Verified
                </Badge>
              )}
              <a
                href="/settings/email"
                data-testid="sending-sender-manage"
                onClick={(e) => { e.preventDefault(); go("/settings/email"); }}
                className="text-sm text-brand"
              >
                Manage in Email settings
              </a>
              {senderProblem && (
                <span className="block text-xs text-chip-bad-ink" data-testid="sending-sender-problem" role="alert">
                  {senderProblem}
                </span>
              )}
            </div>
          </div>

          <div className="flex gap-2.5 items-start px-2 py-2" data-testid="sending-ai-row">
            <div className="w-[280px] flex-shrink-0 flex flex-col gap-1">
              <b className="text-ui text-ink font-medium">Let AI adjust the wording</b>
              <span className="text-meta text-ink-muted">It keeps your meaning and fits the moment — a late cancellation reads differently to a first booking.</span>
            </div>
            <div className="flex-1 min-w-0 flex items-center gap-2.5 flex-wrap">
              <DisabledWithReason
                disabled={true}
                reason="Not built — wording is fixed for now."
                testId="sending-ai-wording"
              >
                {({ disabled, describedBy }) => (
                  <Switch
                    checked={false}
                    disabled={disabled}
                    aria-describedby={describedBy}
                    data-testid="sending-ai-wording-toggle"
                  />
                )}
              </DisabledWithReason>
            </div>
          </div>
        </section>
      </ScreenState>
    </div>
  );
}
