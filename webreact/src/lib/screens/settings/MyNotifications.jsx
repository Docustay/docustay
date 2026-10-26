import { useState, useEffect } from "react";
import { api, ApiError } from "@/lib/api.js";
import { Button } from "@/lib/components/ui/button.jsx";

/**
 * ★ RP.8 — MY NOTIFICATION PREFERENCES
 * Personal overrides (tier 1 of the three-tier fallback) are read from
 * `GET /api/notifications/my-preferences` and toggled with
 * `POST /api/notifications/preferences` (the same endpoint NotificationPrefsScreen
 * uses, but with `appUserId` = caller).
 *
 * Toggles default to "on" when no explicit row exists (tier 3, implicit on);
 * a row with `enabled:false` is shown as "off".
 */
export default function MyNotifications() {
  // ★ The seven non-alwaysOn topics from src/notifications/topics.mjs, matched to the same
  //   catalogue the practice matrix uses.
  const NOTIFICATION_TOPICS = [
    { topic: "booking.booking.reminder", label: "Reminder before a session", alwaysOn: false },
    { topic: "documents.document.signed", label: "A document needs a countersignature", alwaysOn: false },
    { topic: "money.invoice.opened", label: "An invoice is overdue", alwaysOn: false },
  ];

  // ★ Channels matching src/notifications/writes.mjs's CHANNELS exactly.
  const CHANNEL_COLUMNS = [
    { key: "in_app", label: "in-app" },
    { key: "email", label: "email" },
    { key: "push", label: "push" },
  ];

  const [myPreferences, setMyPreferences] = useState([]);
  const [userId, setUserId] = useState(null);
  const [prefBusy, setPrefBusy] = useState(null);
  const [prefProblem, setPrefProblem] = useState(null);
  const [answered, setAnswered] = useState({});

  // ★ Load the user's personal notification preferences (tier 1, explicit overrides).
  async function loadMyPreferences() {
    try {
      const result = await api.getNotificationPreferences();
      setUserId(result?.userId ?? null);
      setMyPreferences(result?.preferences ?? []);
    } catch (err) {
      setPrefProblem(err instanceof ApiError ? err.message : String(err?.message ?? err));
    }
  }

  // ★ Get the effective toggle state: check answered (optimistic), then myPreferences (server state),
  //   defaulting to true (tier 3, implicit on).
  const getEnabled = (topic, channel) => {
    const key = `${topic}|${channel}`;
    if (Object.prototype.hasOwnProperty.call(answered, key)) return answered[key];
    const pref = myPreferences.find((p) => p.topic === topic && p.channel === channel);
    return pref ? pref.enabled : true;
  };

  // ★ Toggle one topic-channel preference.
  async function togglePreference(topic, channel) {
    const key = `${topic}|${channel}`;
    if (prefBusy || !userId) return;
    setPrefBusy(key);
    setPrefProblem(null);
    const next = !getEnabled(topic, channel);
    try {
      await api.setNotificationPreference(
        { appUserId: userId, topic, channel, enabled: next }
      );
      setAnswered({ ...answered, [key]: next });
    } catch (err) {
      setPrefProblem(err instanceof ApiError ? err.message : String(err?.message ?? err));
    } finally {
      setPrefBusy(null);
    }
  }

  // ★ Load preferences when component mounts.
  useEffect(() => {
    void loadMyPreferences();
  }, []);

  return (
    <section className="border-t border-hair py-6" data-testid="mine-notifications">
      <div className="mb-3.5">
        <h2 className="font-fraunces m-0 text-base font-medium text-ink">My notification preferences</h2>
        <p className="m-0 mt-0.5 text-meta text-mute">Override the practice default for your own notifications.</p>
      </div>

      {prefProblem && (
        <p
          className="m-0 mb-4 text-meta text-[var(--color-danger-700)]"
          data-testid="prefs-error"
          role="alert"
        >
          {prefProblem}
        </p>
      )}

      <div className="flex flex-col gap-4">
        {NOTIFICATION_TOPICS.map((topic) => (
          <div key={topic.topic} className="grid grid-cols-[190px_minmax(0,_1fr)] gap-5 items-center py-2.5 px-0">
            <div className="flex flex-col gap-1 min-w-0">
              <span className="block text-body font-medium text-[var(--color-structure-900)]">
                {topic.label}
              </span>
            </div>
            <div className="flex gap-1">
              {CHANNEL_COLUMNS.map((ch) => {
                const on = getEnabled(topic.topic, ch.key);
                return (
                  <button
                    key={ch.key}
                    type="button"
                    className={`px-3.5 py-1.5 text-meta rounded-full border font-medium transition-colors ${
                      on
                        ? "bg-[var(--color-structure-900)] border-[var(--color-structure-900)] text-[var(--color-structure-0)]"
                        : "bg-transparent border-[var(--color-border-muted)] text-[var(--color-structure-500)] hover:border-[var(--color-structure-300)]"
                    } ${
                      prefBusy === `${topic.topic}|${ch.key}` ? "opacity-60 cursor-not-allowed" : "cursor-pointer"
                    }`}
                    role="switch"
                    aria-checked={on ? "true" : "false"}
                    aria-label={`${topic.label} — ${ch.label} — ${on ? "on" : "off"}`}
                    data-testid={`prefs-pill-${topic.topic}-${ch.key}`}
                    disabled={prefBusy === `${topic.topic}|${ch.key}`}
                    onClick={() => togglePreference(topic.topic, ch.key)}
                  >
                    {ch.label}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
