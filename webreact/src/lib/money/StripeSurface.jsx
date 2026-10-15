// ═══════════════════════════════════════════════════════════════════════════════════════════════
// StripeSurface — Ported from webui/src/lib/money/StripeSurface.svelte. Same props, testids, behavior.
// Manages Stripe Connect embedded component initialization: fetches a session, mounts the component,
// and handles loading/error states. Children, above, and below are render props (React nodes).
// ★ Stripe components run in their own iframe and do not use our CSS variables — the appearance
//   configuration passes literal values to Stripe's appearance API.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useEffect, useRef, useState } from "react";
import { request, ApiError } from "@/lib/api.js";
import { Skeleton } from "@/lib/components/ui/skeleton.jsx";
import ErrorPanel from "@/lib/empty/ErrorPanel.jsx";
import { loadConnectAndInitialize } from "@stripe/connect-js";
import { stripeAppearance, fonts } from "./stripeAppearance.js";

/**
 * @param surface - key from SURFACE_COMPONENTS (payment_methods, disputes, payouts, etc.)
 * @param heading - optional section title above the component
 * @param children, above, below - React nodes (render props)
 */
export default function StripeSurface({ surface, heading, children, above, below }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [stripeConnect, setStripeConnect] = useState(null);
  const [clientSecret, setClientSecret] = useState(null);
  const [mounted, setMounted] = useState(false);
  const [currentSurface, setCurrentSurface] = useState(null);
  const containerRef = useRef(null);

  // ★ STEP 1: Fetch component session from the API
  useEffect(() => {
    let isMounted = true;

    (async () => {
      try {
        setLoading(true);
        setError(null);
        const session = await request("/api/money/stripe/component-session", {
          method: "POST",
          body: { surface },
        });

        if (!session?.clientSecret || !session?.publishableKey) {
          throw new Error("Missing client secret or publishable key from server");
        }

        if (!isMounted) return;

        setClientSecret(session.clientSecret);

        // ★ Initialize Stripe Connect with the session
        const stripeInstance = await loadConnectAndInitialize({
          publishableKey: session.publishableKey,
          fetchClientSecret: () => Promise.resolve(session.clientSecret),
          appearance: stripeAppearance(),
          fonts,
        });

        if (!isMounted) return;

        setStripeConnect(stripeInstance);
        setCurrentSurface(surface);
      } catch (err) {
        // ★ Handle 409 ConnectNotLive — show onboarding instead
        if (err instanceof ApiError && err.status === 409) {
          try {
            const session = await request("/api/money/stripe/component-session", {
              method: "POST",
              body: { surface: "onboarding" },
            });

            if (!session?.clientSecret || !session?.publishableKey) {
              throw new Error("Missing client secret or publishable key from server");
            }

            if (!isMounted) return;

            setClientSecret(session.clientSecret);

            const stripeInstance = await loadConnectAndInitialize({
              publishableKey: session.publishableKey,
              fetchClientSecret: () => Promise.resolve(session.clientSecret),
              appearance: stripeAppearance(),
              fonts,
            });

            if (!isMounted) return;

            setStripeConnect(stripeInstance);
            setCurrentSurface("onboarding");
          } catch (onboardingErr) {
            if (isMounted) {
              setError(
                onboardingErr instanceof ApiError
                  ? onboardingErr.message
                  : String(onboardingErr?.message ?? onboardingErr)
              );
            }
          }
        } else {
          if (isMounted) {
            setError(err instanceof ApiError ? err.message : String(err?.message ?? err));
          }
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    })();

    return () => {
      isMounted = false;
    };
  }, [surface]);

  // ★ STEP 2: Mount the Stripe component when container is ready
  useEffect(() => {
    if (mounted || !containerRef.current || !stripeConnect || !currentSurface) return;

    const componentMap = {
      onboarding: "account-onboarding",
      notification: "notification-banner",
      disputes: "disputes-list",
      payouts: "payouts",
      payouts_list: "payouts-list",
      payout_details: "payout-details",
      balances: "balances",
      documents: "documents",
      reconcile: "payout-reconciliation-report",
      instant_payout: "instant-payouts-promotion",
      payments: "payments",
      payment_details: "payment-details",
      account_management: "account-management",
      tax_settings: "tax-settings",
      tax_registrations: "tax-registrations",
    };

    const componentName = componentMap[currentSurface];

    if (!componentName) {
      setError(`Stripe's embedded ${currentSurface.replaceAll("_", " ")} screen isn't available in this version of the app.`);
      return;
    }

    (async () => {
      try {
        const element = stripeConnect.create(componentName);
        containerRef.current.replaceChildren(element);
        setMounted(true);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : String(err?.message ?? err));
      }
    })();
  }, [stripeConnect, currentSurface, mounted]);

  return (
    <div className="w-full">
      {heading && <h2 className="m-0 text-heading font-semibold text-ink mb-[var(--stack)]">{heading}</h2>}

      {above && <div className="mb-[var(--stack)]">{above}</div>}

      {loading ? (
        <div className="bg-surface border border-line rounded-card p-[var(--pad-card)]">
          <Skeleton className="h-10 mb-3" />
          <Skeleton className="h-10 mb-3" />
          <Skeleton className="h-10" />
        </div>
      ) : error ? (
        <ErrorPanel
          error={{ message: error || "Stripe isn't answering — nothing here is lost. Try again." }}
          variant="band"
          testId="stripe-surface-error"
        />
      ) : (
        <div ref={containerRef} className="bg-surface border border-line rounded-card p-[var(--pad-card)]" />
      )}

      {below && <div className="mt-[var(--stack)]">{below}</div>}
    </div>
  );
}
