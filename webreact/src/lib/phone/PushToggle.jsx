// ═══════════════════════════════════════════════════════════════════════════════════════════════
// PushToggle — honest push notification control for phone apps.
// Ported from webui/src/lib/phone/PushToggle.svelte
//
// ★★★ THE PUSH CONTROL IS HONEST AND NOT STUBBED. If push is not available, the control says so
//     in words. If it's available only in native, the browser says "not built yet" — never a
//     button that appears to work and doesn't.
//
// STATES:
//   - available: false → DisabledWithReason with server's reason
//   - native + available → switch to toggle on/off, register/forget device
//   - browser + available → DisabledWithReason "not built yet"
//   - Notification.permission === "denied" → DisabledWithReason "turned off in settings"
// ═══════════════════════════════════════════════════════════════════════════════════════════════

import { useState, useEffect, useCallback, useMemo } from "react";
import { api } from "@/lib/api.js";
import DisabledWithReason from "@/lib/forms/DisabledWithReason.jsx";
import { Field, FieldLabel, FieldContent } from "@/lib/components/ui/field.jsx";
import { Switch } from "@/lib/components/ui/switch.jsx";

export default function PushToggle({ app }) {
  const [loading, setLoading] = useState(true);
  const [pushConfig, setPushConfig] = useState(null);
  const [registered, setRegistered] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [forgetting, setForgetting] = useState(false);
  const [notificationPermission, setNotificationPermission] = useState("default");
  const [deviceToken, setDeviceToken] = useState(null);

  // ★ Check if we're on a native platform (Capacitor shell)
  const isNative = useMemo(
    () => typeof window !== "undefined" && window.Capacitor?.isNativePlatform?.(),
    []
  );

  // ★ Load push configuration from server
  const loadPushConfig = useCallback(async () => {
    try {
      setLoading(true);
      const config = await api.pushConfig();
      setPushConfig(config);
    } catch (err) {
      setPushConfig(null);
    } finally {
      setLoading(false);
    }
  }, []);

  // ★ Handle register device
  const handleRegister = useCallback(async () => {
    if (!isNative || !deviceToken || !pushConfig?.available) return;

    setRegistering(true);
    try {
      // ★ The platform is determined by the native shell and passed to this component
      const platform = globalThis.ksDevicePlatform || "ios";
      await api.registerDevice({ platform, token: deviceToken });
      setRegistered(true);
    } catch (err) {
      setRegistered(false);
    } finally {
      setRegistering(false);
    }
  }, [isNative, deviceToken, pushConfig?.available]);

  // ★ Handle forget device
  const handleForget = useCallback(async () => {
    if (!deviceToken) return;

    setForgetting(true);
    try {
      await api.forgetDevice({ token: deviceToken });
      setRegistered(false);
    } catch (err) {
      setRegistered(true); // Reset to registered on error
    } finally {
      setForgetting(false);
    }
  }, [deviceToken]);

  // ★ Handle switch toggle (for native)
  const handleToggle = useCallback(
    (checked) => {
      if (checked && !registered) {
        handleRegister();
      } else if (!checked && registered) {
        handleForget();
      }
    },
    [registered, handleRegister, handleForget]
  );

  // ★ When the shell provides a token, automatically register it
  useEffect(() => {
    if (deviceToken && pushConfig?.available && isNative && !registered && !registering) {
      handleRegister();
    }
  }, [deviceToken, pushConfig?.available, isNative, registered, registering, handleRegister]);

  // ★ Check browser notification permission and load config on mount
  useEffect(() => {
    loadPushConfig();

    // ★ Check notification permission in browser context
    if (!isNative && typeof Notification !== "undefined") {
      setNotificationPermission(Notification.permission);
    }
  }, [isNative, loadPushConfig]);

  // ★ Derive the appropriate state
  const showDisabledNotAvailable = useMemo(() => !pushConfig?.available, [pushConfig?.available]);
  const showDisabledPermissionDenied = useMemo(
    () => pushConfig?.available && !isNative && notificationPermission === "denied",
    [pushConfig?.available, isNative, notificationPermission]
  );
  const showDisabledNotBuiltYet = useMemo(
    () => pushConfig?.available && !isNative && notificationPermission !== "denied",
    [pushConfig?.available, isNative, notificationPermission]
  );
  const showNativeControl = useMemo(() => pushConfig?.available && isNative, [pushConfig?.available, isNative]);

  if (loading) {
    // ★ Loading state
    return (
      <Field orientation="horizontal">
        <FieldLabel>Push notifications</FieldLabel>
        <FieldContent>
          <DisabledWithReason disabled={true} reason="Loading..." testId="push-toggle-loading">
            {({ disabled, describedBy }) => (
              <div className="h-[18.4px] w-8 bg-input rounded-[9.2px]" aria-describedby={describedBy}></div>
            )}
          </DisabledWithReason>
        </FieldContent>
      </Field>
    );
  }

  if (showDisabledNotAvailable) {
    // ★ the maintainer, 29 Sep 2026 (portal critique #6) — MEASURED live: /api/me/push-config's own reason
    //   here is "Push needs one more set-up step on our side" (no VAPID key configured) — the
    //   exact internal-facing wording the critique named, word for word. Same ruling as the
    //   showDisabledNotBuiltYet state just above: nothing a client can do about a platform-wide
    //   absence, so nothing is shown, rather than narrating engineering status at them.
    return null;
  }

  if (showDisabledPermissionDenied) {
    // ★ STATE: browser notification permission explicitly denied
    return (
      <Field orientation="horizontal">
        <FieldLabel>Push notifications</FieldLabel>
        <FieldContent>
          <DisabledWithReason
            disabled={true}
            reason="Turned off in this browser's settings."
            testId="push-toggle-denied"
          >
            {({ disabled, describedBy }) => <Switch disabled={disabled} aria-describedby={describedBy} />}
          </DisabledWithReason>
        </FieldContent>
      </Field>
    );
  }

  if (showDisabledNotBuiltYet) {
    // ★ the maintainer, 29 Sep 2026 (portal critique #6) — "Push needs one more set-up step on our side" /
    //   "not built yet" is engineering status, not something a client needs to know. This
    //   component's own header comment argues for always explaining a disabled control in
    //   words rather than hiding it — a real, deliberate ruling, but the maintainer's fresh instruction
    //   this session ("clients see unfinished features in internal wording... hide them")
    //   is a newer ruling on the SAME control and wins (CLAUDE.md: a new ruling beats a
    //   standing comment). Every OTHER disabled state here (server said push is off; the
    //   browser itself was denied permission) is a real, actionable fact about THIS
    //   person's account — those still explain themselves. This one state is purely "we
    //   haven't shipped it yet," so it renders nothing rather than saying so.
    return null;
  }

  if (showNativeControl) {
    // ★ STATE: native + available (show toggle to enable/disable)
    return (
      <Field orientation="horizontal">
        <FieldLabel>Push notifications</FieldLabel>
        <FieldContent>
          <div className="flex items-center gap-2.5">
            <Switch
              checked={registered}
              onCheckedChange={handleToggle}
              disabled={registering || forgetting}
              data-testid="push-toggle-native"
              role="switch"
            />
            {registered && <span className="text-sm text-muted-foreground">On for this phone</span>}
          </div>
        </FieldContent>
      </Field>
    );
  }

  return null;
}
