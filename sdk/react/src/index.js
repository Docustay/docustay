import { createElement, useEffect, useRef } from "react";
import "@docustay2026/embed";

/**
 * <DocustaySign url={session.url} onCompleted={() => …} />
 * `url` comes from POST /api/v1/documents/{id}/embed-session, called from YOUR server.
 * Callbacks: onReady, onWaiting, onCompleted, onDeclined, onError, onResize, and onEvent (every event as { type, documentId, … }).
 */
export function DocustaySign({ url, height, autoHeight = false, title, className, style, onReady, onWaiting, onCompleted, onDeclined, onError, onResize, onEvent }) {
  const ref = useRef(null);
  const handlers = useRef({});
  handlers.current = { ready: onReady, waiting: onWaiting, completed: onCompleted, declined: onDeclined, error: onError, resize: onResize };
  const onEventRef = useRef(onEvent); onEventRef.current = onEvent;
  useEffect(() => {
    const el = ref.current; if (!el) return undefined;
    const types = ["ready", "waiting", "completed", "declined", "error", "resize"];
    const fns = types.map((type) => { const fn = (e) => { handlers.current[type]?.(e.detail); onEventRef.current?.({ type, ...e.detail }); }; el.addEventListener(type, fn); return [type, fn]; });
    return () => fns.forEach(([type, fn]) => el.removeEventListener(type, fn));
  }, []);
  return createElement("docustay-sign", { ref, url, ...(height != null ? { height: String(height) } : {}), ...(autoHeight ? { "auto-height": "" } : {}), ...(title ? { title } : {}), class: className, style });
}
