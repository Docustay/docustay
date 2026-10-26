import { useState } from "react";
import { api, ApiError } from "@/lib/api.js";
import { Button } from "@/lib/components/ui/button.jsx";
import * as Alert from "@/lib/components/ui/alert.jsx";
import { RANK_ORDER } from "@/lib/permissions/rank.js";
import Figure from "@/lib/components/kit/Figure.jsx";
import SetBillingBillingCancelConfirm from "@/lib/screens/SetBillingBillingCancelConfirm.jsx";

export default function SetBilling({ view = null, rank = null, onNavigate = null, onDone = null }) {
  const isAdmin = RANK_ORDER.indexOf(rank ?? "") >= RANK_ORDER.indexOf("admin");
  const isOwner = (rank ?? "") === "owner";

  const readOnly = view?.status === "past_due" || view?.status === "canceled";
  const trialing = view?.status === "trialing";

  const statusLabel =
    view?.status === "trialing"
      ? "Trial"
      : view?.status === "active"
        ? "Active"
        : view?.status === "past_due"
          ? "Past due"
          : view?.status === "canceled"
            ? "Canceled"
            : "";

  function daysLeft() {
    if (!view?.trialEndsAt) return null;
    const ms = new Date(view.trialEndsAt).getTime() - Date.now();
    return Math.max(0, Math.ceil(ms / 86_400_000));
  }

  function seatsCaption() {
    const count = view?.seatCount ?? 0;
    return view?.seatLimit != null ? `${count} of ${view.seatLimit}` : `${count}`;
  }

  function aiCaption() {
    const used = view?.usage?.aiDrafts?.used ?? 0;
    const limit = view?.usage?.aiDrafts?.limit ?? null;
    return limit != null ? `${used} of ${limit}` : `${used}`;
  }

  function resetsCaption() {
    const now = new Date();
    const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    return `Resets ${next.getDate()} ${next.toLocaleDateString("en-US", { month: "short" })}`;
  }

  function money(minor) {
    if (minor == null) return null;
    const dollars = minor / 100;
    return `$${Number.isInteger(dollars) ? dollars : dollars.toFixed(2)}`;
  }

  function goto(e, href) {
    e?.preventDefault?.();
    onNavigate?.(href);
  }

  const [portalBusy, setPortalBusy] = useState(false);
  const [portalError, setPortalError] = useState(null);

  async function openPortal() {
    if (portalBusy) return;
    setPortalBusy(true);
    setPortalError(null);
    try {
      const { url } = await api.billingPortalSession();
      window.location.href = url;
    } catch (err) {
      setPortalError(err instanceof ApiError ? err.message : String(err?.message ?? err));
    } finally {
      setPortalBusy(false);
    }
  }

  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelTyped, setCancelTyped] = useState("");
  const [cancelBusy, setCancelBusy] = useState(false);
  const [cancelError, setCancelError] = useState(null);

  function openCancel() {
    setCancelTyped("");
    setCancelError(null);
    setCancelOpen(true);
  }

  async function confirmCancel() {
    if (cancelBusy) return;
    setCancelBusy(true);
    setCancelError(null);
    try {
      await api.closeBilling({ confirmPracticeName: cancelTyped });
      setCancelOpen(false);
      onDone?.();
    } catch (err) {
      setCancelError(err instanceof ApiError ? err.message : String(err?.message ?? err));
    } finally {
      setCancelBusy(false);
    }
  }

  return (
    <div className="flex flex-col" data-testid="settings-billing">
      <p className="text-xs text-muted-foreground m-0">
        <a href="/settings" onClick={(e) => goto(e, "/settings")} className="text-primary hover:text-primary/80">
          Settings
        </a>
      </p>
      <h1 className="text-2xl font-medium tracking-tight mt-1 mb-0">Billing</h1>
      <p className="text-sm text-muted-foreground mt-1.5 mb-4">What your practice pays Workbench.</p>

      {trialing && (
        <Alert.Alert role="alert" className="mb-4 border-primary/20 bg-primary/5" data-testid="billing-trial-banner">
          <Alert.AlertDescription className="text-sm text-foreground">
            <strong>Free trial · {daysLeft() ?? "—"} days left.</strong> No card needed until then. After that your
            practice goes read-only until you choose a plan — nothing is deleted.
          </Alert.AlertDescription>
          <div className="mt-3">
            <Button size="sm" onClick={(e) => goto(e, "/settings/plans")} data-testid="billing-choose-plan">
              Choose a plan
            </Button>
          </div>
        </Alert.Alert>
      )}

      {readOnly && (
        <Alert.Alert role="alert" className="mb-4 border-destructive/20 bg-destructive/5" data-testid="billing-readonly-banner">
          <Alert.AlertDescription className="text-sm text-foreground">
            <strong>This practice is read-only.</strong> Billing needs your attention before anyone can write here
            again. Nothing has been deleted.
          </Alert.AlertDescription>
          <div className="mt-3">
            <Button size="sm" onClick={(e) => goto(e, "/settings/plans")} data-testid="billing-choose-plan-readonly">
              Choose a plan
            </Button>
          </div>
        </Alert.Alert>
      )}

      <div className="flex gap-8 py-5 border-t border-b border-line">
        <div className="flex-1 min-w-0 flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">Plan</span>
          <Figure className="text-2xl" data-testid="billing-plan-name">
            {view?.planName ?? "None chosen yet"}
          </Figure>
          <span className="text-xs text-muted-foreground">{statusLabel}</span>
        </div>
        <div className="flex-1 min-w-0 flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">Staff seats</span>
          <Figure className="text-2xl" data-testid="billing-seats">
            {seatsCaption()}
          </Figure>
          <span className="text-xs text-muted-foreground"></span>
        </div>
        <div className="flex-1 min-w-0 flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">AI drafts this month</span>
          <Figure className="text-2xl" data-testid="billing-ai-drafts">
            {aiCaption()}
          </Figure>
          <span className="text-xs text-muted-foreground">{resetsCaption()}</span>
        </div>
        <div className="flex-1 min-w-0 flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">After trial</span>
          <Figure className="text-2xl" data-testid="billing-after-trial">
            {money(view?.monthlyPriceMinor) ? `${money(view.monthlyPriceMinor)} / month` : "Choose a plan"}
          </Figure>
          <span className="text-xs text-muted-foreground">
            {money(view?.yearlyPriceMinor) ? `or ${money(view.yearlyPriceMinor)} / year` : ""}
          </span>
        </div>
      </div>

      <section className="grid grid-cols-[240px_1fr] gap-8 py-6 border-b border-line">
        <div className="flex flex-col gap-1">
          <h2 className="text-base font-semibold m-0">Payment method</h2>
          <p className="text-xs text-muted-foreground m-0">For your Workbench bill only.</p>
        </div>
        <div className="flex flex-col items-start gap-2">
          {portalError && (
            <p className="text-sm text-destructive" data-testid="billing-portal-error" role="alert">
              {portalError}
            </p>
          )}
          {view?.stripeCustomerId ? (
            <>
              <p className="text-sm text-foreground m-0" data-testid="billing-card-on-file">
                Card on file.
              </p>
              <Button variant="outline" size="sm" onClick={openPortal} disabled={!isAdmin || portalBusy} data-testid="billing-manage">
                {portalBusy ? "Opening…" : "Manage billing"}
              </Button>
            </>
          ) : (
            <>
              <p className="text-sm text-foreground m-0" data-testid="billing-no-card">
                No card yet.
              </p>
              <Button variant="outline" size="sm" onClick={openPortal} disabled={!isAdmin || portalBusy} data-testid="billing-add-card">
                {portalBusy ? "Opening…" : "Add a card"}
              </Button>
            </>
          )}
          {!isAdmin && (
            <p className="text-xs text-muted-foreground mt-2" data-testid="billing-payment-readonly">
              You can see this but not change it. Managing billing is an admin action.
            </p>
          )}
        </div>
      </section>

      <section className="grid grid-cols-[240px_1fr] gap-8 py-6 border-b border-line">
        <div className="flex flex-col gap-1">
          <h2 className="text-base font-semibold m-0">Workbench invoices</h2>
          <p className="text-xs text-muted-foreground m-0">Your bills from us.</p>
        </div>
        <div className="flex flex-col items-start gap-2">
          <p className="text-sm text-muted-foreground m-0" data-testid="billing-invoices-empty">
            None yet.
          </p>
        </div>
      </section>

      <section className="grid grid-cols-[240px_1fr] gap-8 py-6">
        <div className="flex flex-col gap-1">
          <h2 className="text-base font-semibold m-0">Cancel</h2>
          <p className="text-xs text-muted-foreground m-0">Read-only for 90 days, export any time.</p>
        </div>
        <div className="flex flex-col items-start gap-2">
          {isOwner ? (
            <a
              href="/settings/billing"
              className="text-sm text-primary hover:text-primary/80 no-underline"
              data-testid="billing-cancel"
              onClick={(e) => {
                e.preventDefault();
                openCancel();
              }}
            >
              Cancel Workbench
            </a>
          ) : (
            <p className="text-xs text-muted-foreground" data-testid="billing-cancel-no-permission">
              Only the practice's owner can cancel Workbench.
            </p>
          )}
        </div>
      </section>

      <SetBillingBillingCancelConfirm
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        cancelTyped={cancelTyped}
        cancelBusy={cancelBusy}
        cancelError={cancelError}
        onCancelTypedChange={setCancelTyped}
        confirmCancel={confirmCancel}
        onCancel={() => setCancelOpen(false)}
      />
    </div>
  );
}
