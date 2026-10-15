// ═══════════════════════════════════════════════════════════════════════════════════════════════
// MoneyConnect — rebuild from MoneyConnect.frame.html, StripeOnboarding.frame.html on page layout.
// Ported from webui/src/lib/screens/money/MoneyConnect.svelte; same props, testids and copy.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useEffect, useState } from "react";
import { request, ApiError } from "@/lib/api.js";
import ScreenState from "@/lib/empty/ScreenState.jsx";
import PageTitle from "@/lib/components/kit/PageTitle.jsx";
import { Button } from "@/lib/components/ui/button.jsx";

export default function MoneyConnect({ onNavigate = null }) {
  const [connectState, setConnectState] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [connecting, setConnecting] = useState(false);

  async function fetchData() {
    try {
      setLoading(true);
      setError(null);
      const res = await request("/api/settings/money/connect");
      setConnectState(res);
    } catch (err) {
      console.error("Error fetching Stripe status:", err);
      setError(err instanceof ApiError ? err.message : String(err?.message ?? err));
    } finally {
      setLoading(false);
    }
  }

  async function handleConnectStripe() {
    try {
      setConnecting(true);
      const res = await request("/api/settings/connect/start", { method: "POST" });
      if (res.url) window.location.href = res.url;
    } catch (err) {
      setError(err.message || "Failed to start Stripe connection");
      setConnecting(false);
    }
  }

  async function handleDisconnect() {
    if (!confirm("Are you sure you want to disconnect Stripe?")) return;
    try {
      setConnecting(true);
      await request("/api/settings/money/disconnect", {
        method: "POST",
      });
      await fetchData();
    } catch (err) {
      setError(err.message || "Failed to disconnect");
    } finally {
      setConnecting(false);
    }
  }

  useEffect(() => {
    fetchData();
  }, []);

  if (loading) {
    return <ScreenState phase="loading" />;
  }

  if (error) {
    return <ScreenState phase="error" error={error} />;
  }

  if (!connectState) {
    return null;
  }

  const state = connectState.state || "not_connected";

  return (
    <div className="w-full" data-testid="money-connect">
      {state === "not_connected" && (
        <div className="flex gap-5.5 items-start">
          <div className="flex-1 max-w-[620px]">
            {/* Page header */}
            <div className="mb-4.5">
              <PageTitle>Getting paid</PageTitle>
              <p className="mt-1.25 text-control text-mute">
                Connect Stripe and you can take money five minutes from now.
              </p>
            </div>

            {/* Main pitch card */}
            <div className="rounded-card border border-line bg-surface p-5.5 mb-4.5">
              <h2 className="m-0 mb-2 text-heading font-medium text-ink">
                Stripe handles the money. We never touch it.
              </h2>
              <p className="m-0 mb-3.5 text-field text-ink-2 leading-relaxed">
                Your clients pay Stripe, Stripe pays your bank, usually two working days later. Workbench never holds your money, which is why there is nothing here to withdraw and no float to worry about.
              </p>

              {/* Checkmark list */}
              <div className="flex flex-col gap-0">
                <div className="flex gap-3.25 py-3.5 border-b border-hair last:border-b-0">
                  <span className="w-6 flex-shrink-0 text-ok font-semibold">✓</span>
                  <div className="flex-1">
                    <div className="font-medium text-control text-ink-2">You need about five minutes</div>
                    <div className="text-meta text-mute leading-normal mt-0.75">Your bank details, and something with your address on it.</div>
                  </div>
                </div>
                <div className="flex gap-3.25 py-3.5 border-b border-hair last:border-b-0">
                  <span className="w-6 flex-shrink-0 text-ok font-semibold">✓</span>
                  <div className="flex-1">
                    <div className="font-medium text-control text-ink-2">Cards work straight away</div>
                    <div className="text-meta text-mute leading-normal mt-0.75">Bank transfer, wallets and pay-over-time can be turned on after.</div>
                  </div>
                </div>
                <div className="flex gap-3.25 py-3.5 border-b border-hair last:border-b-0">
                  <span className="w-6 flex-shrink-0 text-ok font-semibold">✓</span>
                  <div className="flex-1">
                    <div className="font-medium text-control text-ink-2">2.9% and 30¢ on a card</div>
                    <div className="text-meta text-mute leading-normal mt-0.75">0.8% capped at $5 on a bank transfer. No monthly fee from Stripe.</div>
                  </div>
                </div>
                <div className="flex gap-3.25 py-3.5 border-b border-hair last:border-b-0">
                  <span className="w-6 flex-shrink-0 text-ok font-semibold">✓</span>
                  <div className="flex-1">
                    <div className="font-medium text-control text-ink-2">Workbench takes 0.5%</div>
                    <div className="text-meta text-mute leading-normal mt-0.75">On top, and only on what you actually process.</div>
                  </div>
                </div>
              </div>

              <Button
                onClick={handleConnectStripe}
                disabled={connecting}
                className="mt-4.5"
              >
                Connect Stripe
              </Button>

              <p className="m-0 mt-3 text-meta text-mute leading-relaxed">
                You'll leave Workbench for a few minutes and come straight back.
              </p>
            </div>
          </div>

          {/* Side column */}
          <div className="w-80 flex-shrink-0">
            <div className="rounded-card border border-line bg-surface p-5.5 mb-4.5">
              <h3 className="m-0 mb-1.5 text-heading font-medium text-ink-2">
                Until it's connected
              </h3>
              <ul className="list-none p-0 m-0">
                <li className="flex flex-col gap-0.75 py-2.75 border-b border-hair last:border-b-0">
                  <div className="text-field text-ink-2">You can still book people</div>
                  <div className="text-meta text-mute">Bookings don't need money</div>
                </li>
                <li className="flex flex-col gap-0.75 py-2.75 border-b border-hair last:border-b-0">
                  <div className="text-field text-ink-2">You can write invoices</div>
                  <div className="text-meta text-mute">They just can't be paid yet</div>
                </li>
                <li className="flex flex-col gap-0.75 py-2.75 border-b border-hair last:border-b-0">
                  <div className="text-field text-ink-2">You can record cash</div>
                  <div className="text-meta text-mute">If someone pays you in the room</div>
                </li>
                <li className="flex flex-col gap-0.75 py-2.75 border-b border-hair last:border-b-0">
                  <div className="text-field text-ink-2">Subscriptions can't start</div>
                  <div className="text-meta text-mute">They need a card on file</div>
                </li>
              </ul>
            </div>
          </div>
        </div>
      )}

      {state === "pending" && (
        <div className="flex gap-5.5 items-start">
          <div className="flex-1 max-w-[620px]">
            {/* Page header */}
            <div className="mb-4.5">
              <PageTitle>Getting you set up to take money</PageTitle>
              <p className="mt-1.25 text-control text-mute">
                Four of six done. About five minutes left.
              </p>
            </div>

            {/* ★ the maintainer's ruling, 28 Sep 2026 — the one exception to "no embeds": a NEW connected
                practice's identity and bank details go to Stripe's own hosted page and back, a
                redirect, never an embed. This was already built as "the fallback" — it's the only
                path now, not a backup for an embed that no longer exists. */}
            <div className="text-heading text-ink-2 mb-6.5 leading-relaxed max-w-prose">
              Stripe handles this part. They verify who you are because they are the ones moving the money. We never see your bank details or the documents you upload.
            </div>
            <div className="text-center py-10">
              <Button onClick={handleConnectStripe} disabled={connecting}>
                {connecting ? "Connecting…" : "Start onboarding"}
              </Button>
            </div>
          </div>

          {/* Side column */}
          <div className="w-80 flex-shrink-0">
            <div className="rounded-card border border-line bg-surface p-5.5 mb-4.5">
              <h3 className="m-0 mb-1.5 text-heading font-medium text-ink-2">
                Until this is done
              </h3>
              <ul className="list-none p-0 m-0">
                <li className="flex flex-col gap-0.75 py-2.75 border-b border-hair last:border-b-0">
                  <div className="text-field text-ink-2">You can still book people</div>
                  <div className="text-meta text-mute">Bookings don't need money</div>
                </li>
                <li className="flex flex-col gap-0.75 py-2.75 border-b border-hair last:border-b-0">
                  <div className="text-field text-ink-2">You can write invoices</div>
                  <div className="text-meta text-mute">They just can't be paid yet</div>
                </li>
              </ul>
            </div>
          </div>
        </div>
      )}

      {state === "connected" && (
        <div className="flex gap-5.5 items-start">
          <div className="flex-1 max-w-[620px]">
            {/* Page header */}
            <div className="mb-4.5">
              <PageTitle>Getting paid</PageTitle>
              <p className="mt-1.25 text-control text-mute">
                Your Stripe account is connected and ready.
              </p>
            </div>

            {/* Status card */}
            <div className="rounded-card border border-line bg-surface p-5.5 mb-4.5">
              <h2 className="m-0 mb-2 text-heading font-medium text-ink">
                Stripe account connected
              </h2>
              {connectState.stripeAccountId && (
                <p className="m-0 mb-3 text-meta text-mute">
                  Account ID: {connectState.stripeAccountId}
                </p>
              )}
              <p className="m-0 mb-4.5 text-field text-ink-2 leading-relaxed">
                Your Stripe account is active. You can now accept payments from your clients.
              </p>

              <div className="flex gap-2.5">
                <Button variant="outline">
                  Manage in Stripe
                </Button>
                <Button
                  variant="destructive"
                  onClick={handleDisconnect}
                  disabled={connecting}
                >
                  {connecting ? "Disconnecting..." : "Disconnect Stripe"}
                </Button>
              </div>
            </div>
          </div>

          {/* Side column */}
          <div className="w-80 flex-shrink-0">
            <div className="rounded-card border border-line bg-surface p-5.5 mb-4.5">
              <h3 className="m-0 mb-1.5 text-heading font-medium text-ink-2">
                Your setup
              </h3>
              <ul className="list-none p-0 m-0">
                <li className="flex flex-col gap-0.75 py-2.75 border-b border-hair last:border-b-0">
                  <div className="text-field text-ink-2">Payments working</div>
                  <div className="text-meta text-mute">Clients can pay with cards</div>
                </li>
                <li className="flex flex-col gap-0.75 py-2.75 border-b border-hair last:border-b-0">
                  <div className="text-field text-ink-2">Money direct to bank</div>
                  <div className="text-meta text-mute">Usually in 2 working days</div>
                </li>
              </ul>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
