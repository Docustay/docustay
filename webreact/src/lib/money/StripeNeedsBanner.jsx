// ═══════════════════════════════════════════════════════════════════════════════════════════════
// StripeNeedsBanner — shows when Stripe account is restricted.
// Ported from webui/src/lib/money/StripeNeedsBanner.svelte: fetches /api/settings/money/connect,
// shows banner only when state === "restricted", renders StripeSurface component.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useEffect, useState } from "react";
import { api } from "@/lib/api.js";
import Banner from "@/lib/components/kit/Banner.jsx";
import StripeSurface from "./StripeSurface.jsx";

export default function StripeNeedsBanner() {
  const [connectState, setConnectState] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    async function fetchData() {
      try {
        setLoading(true);
        setError(null);
        const res = await api.moneyConnect();
        setConnectState(res);
      } catch (err) {
        console.error("Error fetching Stripe status:", err);
        setError(err);
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, []);

  if (loading || !connectState || connectState.state !== "restricted") {
    return null;
  }

  return (
    <Banner variant="bad" testId="money-stripe-needs-banner">
      <div className="space-y-3">
        <div className="font-medium">
          Nothing is ever lost — It all releases the moment you sort it.
        </div>
        <StripeSurface surface="notification" />
      </div>
    </Banner>
  );
}
