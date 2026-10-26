// ═══════════════════════════════════════════════════════════════════════════════════════════════
// R8.009 — IntegrationsScreen.
//
// Task 6.2 / 06-settings.md §2.2 — `/settings/integrations` (`SetIntegrations`). Screen showing
// connected integrations, available integrations, and coming soon integrations.
// Built on ConnectPage archetype from frame SetIntegrations.frame.html.
//
// ★★★ `connected`/`available` NAME REAL SIGNALS, NEVER FABRICATED ONES (§2.2): Google Workspace
//     is connected because a non-revoked `google_identity` row exists; Stripe is connected
//     because `mainstay_subscription.stripe_customer_id IS NOT NULL`.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useState } from "react";
import { api, ApiError } from "@/lib/api.js";
import { Badge } from "@/lib/components/ui/badge.jsx";
import { Button } from "@/lib/components/ui/button.jsx";
import EmptyState from "@/lib/empty/EmptyState.jsx";
import IntegrationsScreenIntegrationDisconnectConfirm from "./IntegrationsScreenIntegrationDisconnectConfirm.jsx";
import GtmSheet from "./GtmSheet.jsx";

const DISCONNECT_TEXT = {
  "google-workspace": "Workbench stops syncing your calendar and email.",
  "stripe": "Workbench stops processing payments and managing subscriptions.",
};

function initial(name) {
  const s = String(name ?? "").trim();
  return s ? s.charAt(0).toUpperCase() : "?";
}

function fmtWhen(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" });
}

export default function IntegrationsScreen({ view = null, onNavigate = null, onDone = null }) {
  const connected = view?.connected ?? [];
  const available = view?.available ?? [];
  const comingLater = view?.comingLater ?? [];

  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(null);
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const [disconnectTarget, setDisconnectTarget] = useState(null);
  const [gtmSheetOpen, setGtmSheetOpen] = useState(false);

  function goto(e, href) {
    e.preventDefault();
    onNavigate?.(href);
  }

  async function confirmDisconnect() {
    if (!disconnectTarget || busy) return;
    setBusy(true);
    setProblem(null);
    try {
      if (disconnectTarget.key === "google-workspace") {
        await api.post("/api/settings/email/disconnect", {});
      } else if (disconnectTarget.key === "stripe") {
        // ★ Stripe disconnect handled through /settings/billing, not a direct API call
        // Redirect to billing settings for manual disconnect
        onNavigate?.("/settings/billing");
        return;
      }
      setDisconnectOpen(false);
      setDisconnectTarget(null);
      onDone?.();
    } catch (err) {
      setProblem(err instanceof ApiError ? err.message : String(err?.message ?? err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-6 max-w-[980px]" data-testid="settings-integrations">
      <p className="m-0 text-xs text-muted">
        <a href="/settings" onClick={(e) => goto(e, "/settings")} className="text-primary no-underline cursor-pointer">
          Settings
        </a>
      </p>
      <h1 className="mt-1 text-title font-medium tracking-tight text-ink">
        Integrations
      </h1>
      <p className="my-1.5 mb-4 text-base text-muted">
        Everything Workbench connects to.
      </p>

      <h2 className="mt-5.5 mb-2.5 text-heading font-semibold text-ink">
        Connected
      </h2>
      {connected.length === 0 ? (
        <EmptyState
          kind="first-run"
          headline="Nothing connected yet"
          line="Connect Google Workspace or Stripe below to see them here."
          testId="integrations-connected-empty"
        />
      ) : (
        <div data-testid="integrations-connected-grid" className="grid grid-cols-3 gap-[var(--gap)]">
          {connected.map((item) => (
            <div key={item.key} data-testid={`integration-connected-${item.key}`} className="border border-line rounded-[14px] p-4 flex flex-col gap-[var(--stack)] min-w-0">
              <div className="flex items-center gap-[var(--stack)]">
                <span className="w-9 h-9 flex-shrink-0 rounded-sm bg-surface-sunken text-ink flex items-center justify-center font-semibold">
                  {initial(item.name)}
                </span>
                <span className="text-base font-semibold text-ink flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
                  {item.name}
                </span>
                <Badge className="px-2.5 py-1 text-xs font-medium h-[var(--chip-h)] bg-chip-ok-bg text-chip-ok-ink">
                  Connected
                </Badge>
              </div>
              <span className="text-xs text-muted break-words">
                {item.detail}
              </span>
              {item.lastSyncedAt && (
                <span className="text-xs text-muted" data-testid={`integration-synced-${item.key}`}>
                  Last synced {fmtWhen(item.lastSyncedAt)}
                </span>
              )}
              <Button
                variant="outline"
                size="sm"
                data-testid={`integration-disconnect-${item.key}`}
                onClick={() => {
                  setProblem(null);
                  setDisconnectTarget({ key: item.key, name: item.name });
                  setDisconnectOpen(true);
                }}
                className="self-start"
              >
                Disconnect
              </Button>
            </div>
          ))}
        </div>
      )}

      <h2 className="mt-5.5 mb-2.5 text-heading font-semibold text-ink">
        Available
      </h2>
      {available.length === 0 ? (
        <p className="m-0 text-sm text-muted" data-testid="integrations-available-empty">
          Nothing else is available to connect right now.
        </p>
      ) : (
        <div data-testid="integrations-available-grid" className="grid grid-cols-3 gap-[var(--gap)]">
          {available.map((item) => (
            <div key={item.key} data-testid={`integration-available-${item.key}`} className="border border-line rounded-[14px] p-4 flex flex-col gap-[var(--stack)] min-w-0">
              <div className="flex items-center gap-[var(--stack)]">
                <span className="w-9 h-9 flex-shrink-0 rounded-sm bg-surface-sunken text-ink flex items-center justify-center font-semibold">
                  {initial(item.name)}
                </span>
                <span className="text-base font-semibold text-ink flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
                  {item.name}
                </span>
                <Badge className="px-2.5 py-1 text-xs font-medium h-[var(--chip-h)] bg-chip-neutral-bg text-chip-neutral-ink">
                  Not connected
                </Badge>
              </div>
              <span className="text-xs text-muted break-words">
                {item.detail}
              </span>
              {item.action === "gtm" ? (
                <Button
                  variant="outline"
                  size="sm"
                  data-testid={`integration-setup-${item.key}`}
                  onClick={() => {
                    setProblem(null);
                    setGtmSheetOpen(true);
                  }}
                  className="self-start"
                >
                  Set up
                </Button>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={(e) => goto(e, item.href)}
                  className="self-start"
                >
                  Connect
                </Button>
              )}
            </div>
          ))}
        </div>
      )}

      <h2 className="mt-5.5 mb-2.5 text-heading font-semibold text-ink">
        Coming later
      </h2>
      {comingLater.length === 0 ? (
        <p className="m-0 text-sm text-muted" data-testid="integrations-later-empty">
          Nothing else is planned right now.
        </p>
      ) : (
        <div data-testid="integrations-later-grid" className="grid grid-cols-4 gap-[var(--gap)]">
          {comingLater.map((item) => (
            <div key={item.key} data-testid={`integration-later-${item.key}`} className="border border-line rounded-[14px] p-4 flex flex-col gap-[var(--stack)] min-w-0 opacity-60">
              <div className="flex items-center gap-[var(--stack)]">
                <span className="w-9 h-9 flex-shrink-0 rounded-sm bg-surface-sunken text-ink flex items-center justify-center font-semibold">
                  {initial(item.name)}
                </span>
                <span className="text-base font-semibold text-ink flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
                  {item.name}
                </span>
                <Badge className="px-2.5 py-1 text-xs font-medium h-[var(--chip-h)] bg-chip-neutral-bg text-chip-neutral-ink">
                  Later
                </Badge>
              </div>
            </div>
          ))}
        </div>
      )}

      <IntegrationsScreenIntegrationDisconnectConfirm
        open={disconnectOpen}
        onOpenChange={setDisconnectOpen}
        connected={connected}
        busy={busy}
        problem={problem}
        disconnectTarget={disconnectTarget}
        DISCONNECT_TEXT={DISCONNECT_TEXT}
        confirmDisconnect={confirmDisconnect}
      />

      {gtmSheetOpen && (
        <GtmSheet
          onCancel={() => {
            setGtmSheetOpen(false);
          }}
          onDone={() => {
            setGtmSheetOpen(false);
            onDone?.();
          }}
        />
      )}
    </div>
  );
}
