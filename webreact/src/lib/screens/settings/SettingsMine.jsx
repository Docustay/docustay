import { useState, useEffect } from "react";
import { api, ApiError } from "@/lib/api.js";
import { Switch } from "@/lib/components/ui/switch.jsx";
import { FileDropZoneRoot, FileDropZoneTrigger } from "@/lib/components/ui/file-drop-zone.jsx";
import { Avatar, AvatarFallback } from "@/lib/components/ui/avatar.jsx";
import { Input } from "@/lib/components/ui/input.jsx";
import { Button } from "@/lib/components/ui/button.jsx";
import ScreenState from "@/lib/empty/ScreenState.jsx";
import ErrorPanel from "@/lib/empty/ErrorPanel.jsx";
import SettingsHubRow from "@/lib/shared/SettingsHubRow.jsx";
import LastChanged from "@/lib/shared/LastChanged.jsx";
import SettingsMineConfirm1Confirm from "./SettingsMineConfirm1Confirm.jsx";
import MyNotifications from "./MyNotifications.jsx";

export default function SettingsMine({ view = null, onNavigate = null, onDone = null }) {
  // ★ Derived values from view contract
  const about = view?.about ?? {};
  const work = view?.work ?? {};
  const reaches = view?.reaches ?? {};
  const lastChanged = view?.lastChanged ?? null;

  const displayName = about?.displayName ?? "";
  const photoSrc = about?.photoSrc ?? null;
  const bio = about?.bio ?? "";
  const bookingLink = about?.bookingLink ?? "";
  const workHref = work?.href ?? "/settings/when";
  const devices = reaches?.devices ?? [];
  const preferences = reaches?.preferences ?? [];
  const quietAfter = reaches?.quietAfter ?? null;

  // ★ Local state for editing
  const [displayNameDraft, setDisplayNameDraft] = useState("");
  const [bioDraft, setBioDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(null);
  const [photoConfirm, setPhotoConfirm] = useState(null);
  const [copied, setCopied] = useState(false);

  // ★ Update drafts when view changes
  useEffect(() => {
    setDisplayNameDraft(displayName);
    setBioDraft(bio);
  }, [displayName, bio]);

  // ★ Compute initials from displayName for avatar fallback
  const initials = (() => {
    const words = String(displayName ?? "").trim().split(/\s+/).filter(Boolean);
    return words.slice(0, 2).map((w) => w[0]).join("").toUpperCase().replace(/[^A-Z0-9]/g, "") || "?";
  })();

  function goto(href, e) {
    if (e) e.preventDefault();
    onNavigate?.(href);
  }

  // ★ Save changes to displayName or bio
  async function saveProfile() {
    const nameChanged = displayNameDraft !== displayName;
    const bioChanged = bioDraft !== bio;
    if (!nameChanged && !bioChanged) return;

    if (busy) return;
    setBusy(true);
    setProblem(null);
    try {
      const body = {};
      if (nameChanged) body.displayName = displayNameDraft;
      if (bioChanged) body.bio = bioDraft;
      await api.setMine(body);
      onDone?.();
    } catch (err) {
      setProblem(err instanceof ApiError ? err.message : String(err?.message ?? err));
      setDisplayNameDraft(displayName);
      setBioDraft(bio);
    } finally {
      setBusy(false);
    }
  }

  // ★ Photo upload preparation (resize, convert to base64)
  async function preparePhoto(file) {
    const bitmap = await createImageBitmap(file);
    const maxWidth = 400;
    const maxHeight = 400;
    const scale = Math.min(1, maxWidth / bitmap.width, maxHeight / bitmap.height);
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    canvas.getContext("2d").drawImage(bitmap, 0, 0, w, h);
    const toBlob = (type, q) => new Promise((res) => canvas.toBlob(res, type, q));
    let blob = await toBlob("image/png");
    if (blob.size > 700 * 1024) blob = await toBlob("image/webp", 0.9);
    const buf = new Uint8Array(await blob.arrayBuffer());
    let bin = "";
    for (let i = 0; i < buf.length; i += 0x8000) {
      bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    }
    return { dataBase64: btoa(bin), previewUrl: URL.createObjectURL(blob) };
  }

  async function onPhotoUpload(files) {
    setProblem(null);
    const file = files?.[0];
    if (!file) return;
    try {
      const prepared = await preparePhoto(file);
      setPhotoConfirm(prepared);
    } catch {
      setProblem("That image could not be read. Try a PNG or JPG.");
    }
  }

  async function confirmPhotoUpload() {
    if (!photoConfirm) return;
    setBusy(true);
    setProblem(null);
    try {
      await api.uploadMyPhoto({ dataBase64: photoConfirm.dataBase64 });
      setPhotoConfirm(null);
      onDone?.();
    } catch (err) {
      setProblem(err instanceof ApiError ? err.message : String(err?.message ?? err));
    } finally {
      setBusy(false);
    }
  }

  // ★ Copy booking link to clipboard
  async function copyBookingLink() {
    if (!bookingLink) return;
    try {
      await navigator.clipboard.writeText(bookingLink);
      setCopied(true);
      setTimeout(() => { setCopied(false); }, 2000);
    } catch {
      setProblem("Could not copy — copy it from the field instead.");
    }
  }

  // ★ Toggle notification preference
  async function togglePreference(prefRow, newEnabled) {
    if (busy) return;
    setBusy(true);
    setProblem(null);
    try {
      await api.setNotificationPreference({ appUserId: prefRow.appUserId, topic: prefRow.topic, channel: prefRow.channel, enabled: newEnabled }, crypto.randomUUID());
      onDone?.();
    } catch (err) {
      setProblem(err instanceof ApiError ? err.message : String(err?.message ?? err));
    } finally {
      setBusy(false);
    }
  }

  // ★ Toggle quiet after (nothing after 9pm)
  async function toggleQuietAfter(newValue) {
    if (busy) return;
    setBusy(true);
    setProblem(null);
    try {
      onDone?.();
    } catch (err) {
      setProblem(err instanceof ApiError ? err.message : String(err?.message ?? err));
    } finally {
      setBusy(false);
    }
  }

  // ★ Show loading state
  if (view === null) {
    return <ScreenState phase="loading" />;
  }

  // ★ Show error state if view fetch failed
  if (!view) {
    return <ErrorPanel subject="Settings" />;
  }

  // ★ Normal view
  return (
    <>
      <div className="flex flex-col max-w-none px-[30px] py-[26px]" data-testid="settings-mine">
        {/* ═══ Header ═════════════════════════════════════════════════════════════════════════════ */}
        <div className="mb-6">
          <h1 className="font-fraunces m-0 mb-1.5 text-2xl font-medium -tracking-[0.01em] text-ink">You</h1>
          <p className="m-0 text-body text-mute">Your own settings. Nobody else sees any of this.</p>
        </div>

        {problem && (
          <p className="m-0 mb-4 text-meta text-[var(--color-danger-700)]" data-testid="mine-error" role="alert">
            {problem}
          </p>
        )}

        {/* ═══ About you ════════════════════════════════════════════════════════════════════════ */}
        <section className="border-t border-hair py-6 first:border-t-0" data-testid="mine-section-about">
          <div className="mb-3.5">
            <h2 className="font-fraunces m-0 text-base font-medium text-ink">About you</h2>
          </div>

          {/* Name row */}
          <div className="grid grid-cols-[190px_minmax(0,_1fr)] gap-5 items-start py-2.5 px-0 min-h-[40px]">
            <div className="flex flex-col gap-1 min-w-0">
              <span className="block text-body font-medium text-[var(--color-structure-900)]">Name</span>
              <span className="block text-meta text-mute">This is what clients see on bookings.</span>
            </div>
            <div className="flex flex-col gap-2">
              <Input
                type="text"
                data-testid="mine-name-input"
                value={displayNameDraft}
                onChange={(e) => setDisplayNameDraft(e.target.value)}
                disabled={busy}
                maxLength={80}
                onBlur={saveProfile}
              />
            </div>
          </div>

          {/* Photo row */}
          <div className="grid grid-cols-[190px_minmax(0,_1fr)] gap-5 items-start py-2.5 px-0 min-h-[40px]">
            <div className="flex flex-col gap-1 min-w-0">
              <span className="block text-body font-medium text-[var(--color-structure-900)]">Photo</span>
              <span className="block text-meta text-mute">Shows on your booking page and in the client portal.</span>
            </div>
            <div className="flex flex-col gap-3 items-start">
              <div className="w-16 h-16 rounded-lg overflow-hidden border border-hair bg-[var(--surface-sunken)] flex items-center justify-center" data-testid="mine-photo-preview">
                {photoSrc ? (
                  <img src={photoSrc} alt="" aria-hidden="true" className="w-full h-full object-cover" />
                ) : (
                  <Avatar className="w-16 h-16 bg-[var(--color-avatar-wash-blue)]">
                    <AvatarFallback className="text-xs text-ink">{initials}</AvatarFallback>
                  </Avatar>
                )}
              </div>
              <FileDropZoneRoot
                accept="image/png,image/jpeg,image/webp"
                maxFiles={1}
                fileCount={0}
                maxFileSize={10 * 1000 * 1000}
                onUpload={onPhotoUpload}
                onFileRejected={({ reason }) => {
                  setProblem(
                    reason === "Maximum file size exceeded"
                      ? "That file is over 10 MB."
                      : "Use a PNG, JPG or WebP image."
                  );
                }}
              >
                <FileDropZoneTrigger className="inline-flex items-center justify-center rounded-lg border border-line bg-surface px-[13px] py-1.5 text-meta font-medium text-ink-2 hover:bg-paper hover:text-ink cursor-pointer h-[32px]">
                  {photoSrc ? "Replace photo" : "Upload photo"}
                </FileDropZoneTrigger>
              </FileDropZoneRoot>
            </div>
          </div>

          {/* Bio row */}
          <div className="grid grid-cols-[190px_minmax(0,_1fr)] gap-5 items-start py-2.5 px-0 min-h-[40px]">
            <div className="flex flex-col gap-1 min-w-0">
              <span className="block text-body font-medium text-[var(--color-structure-900)]">A line about you</span>
            </div>
            <div className="flex flex-col gap-2">
              <textarea
                data-testid="mine-bio-input"
                value={bioDraft}
                onChange={(e) => setBioDraft(e.target.value)}
                disabled={busy}
                maxLength={280}
                rows={3}
                onBlur={saveProfile}
                className="h-auto min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50"
              />
            </div>
          </div>

          {/* Booking link row */}
          <div className="grid grid-cols-[190px_minmax(0,_1fr)] gap-5 items-start py-2.5 px-0 min-h-[40px]">
            <div className="flex flex-col gap-1 min-w-0">
              <span className="block text-body font-medium text-[var(--color-structure-900)]">Your own booking link</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-meta text-[var(--color-structure-600)] overflow-hidden text-ellipsis whitespace-nowrap flex-1 min-w-0" data-testid="mine-booking-link">
                {bookingLink}
              </span>
              <Button
                variant="outline"
                size="sm"
                data-testid="mine-copy-link"
                disabled={!bookingLink}
                onClick={copyBookingLink}
              >
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
          </div>
        </section>

        {/* ═══ When you work ═════════════════════════════════════════════════════════════════ */}
        <section className="border-t border-hair py-6" data-testid="mine-section-work">
          <div className="flex items-center justify-between gap-4 mb-3.5">
            <h2 className="font-fraunces m-0 text-base font-medium text-ink">When you work</h2>
            <LastChanged
              at={lastChanged?.at ?? null}
              by={lastChanged?.by ?? null}
              label="Changed"
              testId="mine-last-changed"
            />
          </div>

          <SettingsHubRow
            label="Hours"
            where="Mon to Fri 8:00–5:00, Sat 9:00–1:00"
            href={workHref}
            onNavigate={goto}
            testId="mine-hours-row"
          />
          <SettingsHubRow
            label="Blocked out"
            where="12:00–1:00 every weekday, for notes"
            href={workHref}
            onNavigate={goto}
            testId="mine-blocked-row"
          />
          <SettingsHubRow
            label="Time off"
            where="Nothing booked in"
            href={workHref}
            onNavigate={goto}
            testId="mine-timeoff-row"
          />
        </section>

        {/* ═══ What reaches you ═════════════════════════════════════════════════════════ */}
        <section className="border-t border-hair py-6" data-testid="mine-section-reaches">
          <div className="mb-3.5">
            <h2 className="font-fraunces m-0 text-base font-medium text-ink">What reaches you</h2>
          </div>

          {devices.length === 0 ? (
            <p className="my-3.5 py-3 px-3 text-meta text-mute bg-[var(--surface-sunken)] rounded-md" data-testid="mine-no-devices">
              No phone signed in yet
            </p>
          ) : (
            devices.map((device) => (
              <div key={device.id} className="grid grid-cols-[190px_minmax(0,_1fr)] gap-5 items-start py-2.5 px-0 min-h-[40px]">
                <div className="flex flex-col gap-1 min-w-0">
                  <span className="block text-body font-medium text-[var(--color-structure-900)]">
                    {device.label ?? `Push on ${device.platform ?? "device"}`}
                  </span>
                  <span className="block text-meta text-mute">{device.description ?? ""}</span>
                </div>
                <div className="flex items-center">
                  <Switch
                    checked={device.enabled ?? false}
                    disabled={busy}
                    aria-label={`Toggle ${device.label ?? "push notifications"}`}
                    data-testid={`mine-device-${device.id}`}
                    onCheckedChange={(v) => togglePreference(device, v)}
                  />
                </div>
              </div>
            ))
          )}

          {/* Email preference */}
          {preferences
            .filter((pref) => pref.channel === "email")
            .map((pref) => (
              <div key={pref.id} className="grid grid-cols-[190px_minmax(0,_1fr)] gap-5 items-start py-2.5 px-0 min-h-[40px]">
                <div className="flex flex-col gap-1 min-w-0">
                  <span className="block text-body font-medium text-[var(--color-structure-900)]">Email</span>
                  <span className="block text-meta text-mute">Daily summary at 7am, plus anything urgent</span>
                </div>
                <div className="flex items-center">
                  <Switch
                    checked={pref.enabled ?? false}
                    disabled={busy}
                    aria-label="Email notifications"
                    data-testid="mine-email-toggle"
                    onCheckedChange={(v) => togglePreference(pref, v)}
                  />
                </div>
              </div>
            ))}

          {/* Text preference (SMS channel) */}
          {preferences
            .filter((pref) => pref.channel === "sms")
            .map((pref) => (
              <div key={pref.id} className="grid grid-cols-[190px_minmax(0,_1fr)] gap-5 items-start py-2.5 px-0 min-h-[40px]">
                <div className="flex flex-col gap-1 min-w-0">
                  <span className="block text-body font-medium text-[var(--color-structure-900)]">Text</span>
                  <span className="block text-meta text-mute">Only failed payments and cancellations inside 24 hours</span>
                </div>
                <div className="flex items-center">
                  <Switch
                    checked={pref.enabled ?? false}
                    disabled={busy}
                    aria-label="Text notifications"
                    data-testid="mine-sms-toggle"
                    onCheckedChange={(v) => togglePreference(pref, v)}
                  />
                </div>
              </div>
            ))}

          {/* Quiet after (nothing after 9pm) */}
          <div className="grid grid-cols-[190px_minmax(0,_1fr)] gap-5 items-start py-2.5 px-0 min-h-[40px]">
            <div className="flex flex-col gap-1 min-w-0">
              <span className="block text-body font-medium text-[var(--color-structure-900)]">Nothing after 9pm</span>
              <span className="block text-meta text-mute">Urgent things still come through</span>
            </div>
            <div className="flex items-center">
              <Switch
                checked={quietAfter ?? false}
                disabled={busy}
                aria-label="Nothing after 9pm"
                data-testid="mine-quiet-after-toggle"
                onCheckedChange={toggleQuietAfter}
              />
            </div>
          </div>
        </section>

        {/* RP.8 slot for notification preferences section */}
        <MyNotifications />
      </div>

      {/* ★ Photo upload confirmation dialog */}
      <SettingsMineConfirm1Confirm
        open={photoConfirm !== null}
        onOpenChange={(o) => {
          if (!o && !busy) setPhotoConfirm(null);
        }}
        photoSrc={photoSrc}
        busy={busy}
        photoConfirm={photoConfirm}
        confirmPhotoUpload={confirmPhotoUpload}
      />
    </>
  );
}
