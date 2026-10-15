// ═══════════════════════════════════════════════════════════════════════════════════════════════
// MoneyActions — subscription create/entitlement grant/card add/subscription cancel
// Ported from webui/src/lib/forms/MoneyActions.svelte
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useState, useEffect } from "react";
import { api, ApiError } from "@/lib/api.js";
import { RANK_ORDER } from "@/lib/permissions/rank.js";
import { Button } from "@/lib/components/ui/button.jsx";
import { Field, FieldLabel, FieldDescription } from "@/lib/components/ui/field.jsx";
import { Input } from "@/lib/components/ui/input.jsx";
import Combobox from "@/lib/components/kit/Combobox.jsx";
import SideSheet from "@/lib/forms/SideSheet.jsx";
import DecisionModal from "@/lib/forms/DecisionModal.jsx";

export default function MoneyActions({
  people = [],
  plans = [],
  services = [],
  subscription = null,
  stripe = null,
  rank = null,
  onDone = null,
  openNew = null,
}) {
  const isAdmin = RANK_ORDER.indexOf(rank ?? "") >= RANK_ORDER.indexOf("admin");

  const [open, setOpen] = useState(null);
  const [consumed, setConsumed] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [atPeriodEnd, setAtPeriodEnd] = useState(true);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(null);

  // subscription form state
  const [planId, setPlanId] = useState("");
  const [subUser, setSubUser] = useState("");

  // entitlement form state
  const [ownerUserId, setOwnerUserId] = useState("");
  const [serviceId, setServiceId] = useState("");
  const [credits, setCredits] = useState("");
  const [expiresAt, setExpiresAt] = useState("");

  const [cardMount, setCardMount] = useState(null);

  // Handle deep link to open a surface
  useEffect(() => {
    if (openNew && !consumed) {
      setConsumed(true);
      setOpen(openNew);
    }
  }, [openNew, consumed]);

  // Mount Stripe card element
  useEffect(() => {
    if (open !== "card" || !cardMount || !stripe?.mountCardElement) return;
    const unmount = stripe.mountCardElement(cardMount);
    return () => unmount?.();
  }, [open, cardMount, stripe]);

  const planOf = (id) => plans.find((p) => p.id === id) ?? null;
  const money = (minor, cur) =>
    minor == null
      ? ""
      : new Intl.NumberFormat("en-US", { style: "currency", currency: cur ?? "USD" }).format(
          minor / 100
        );

  async function run(fn) {
    if (busy) return;
    setBusy(true);
    setProblem(null);
    try {
      await fn();
      setOpen(null);
      setCancelOpen(false);
      onDone?.();
    } catch (err) {
      setProblem(
        err instanceof ApiError ? err.message : String(err?.message ?? err)
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      {isAdmin && (
        <>
          <Button
            variant="default"
            data-testid="sub-create-trigger"
            onClick={() => {
              setProblem(null);
              setOpen("subscription");
            }}
          >
            New subscription
          </Button>
          <Button
            variant="outline"
            data-testid="ent-create-trigger"
            onClick={() => {
              setProblem(null);
              setOpen("entitlement");
            }}
          >
            Grant credits
          </Button>
          <Button
            variant="outline"
            data-testid="card-trigger"
            onClick={() => {
              setProblem(null);
              setOpen("card");
            }}
          >
            Add a card
          </Button>

          {subscription?.state === "active" && (
            <Button
              variant="outline"
              data-testid="sub-cancel-trigger"
              onClick={() => {
                setProblem(null);
                setCancelOpen(true);
              }}
            >
              Cancel subscription
            </Button>
          )}
        </>
      )}

      {/* Subscription Form */}
      {open === "subscription" && (
        <SideSheet
          title="New subscription"
          testId="sub-form"
          busy={busy}
          error={problem}
          saveLabel="Start the subscription"
          onCancel={() => setOpen(null)}
          onSave={() =>
            run(() =>
              api.createSubscription({ planId, appUserId: subUser })
            )
          }
        >
          <div className="flex flex-col gap-4">
            <Field>
              <FieldLabel>Who</FieldLabel>
              <Combobox
                testId="sub-user"
                value={subUser}
                options={people.map((p) => ({
                  value: p.id,
                  label: p.display_name ?? p.name,
                }))}
                onValueChange={setSubUser}
              />
            </Field>
            <Field>
              <FieldLabel>Plan</FieldLabel>
              <Combobox
                testId="sub-plan"
                value={planId}
                options={plans.map((p) => ({ value: p.id, label: p.name }))}
                onValueChange={setPlanId}
              />
              {planOf(planId) && (
                <span className="text-meta text-mute" data-testid="sub-plan-terms">
                  {money(planOf(planId).amount_minor, planOf(planId).currency)}{" "}
                  every {planOf(planId).interval}.
                </span>
              )}
            </Field>
          </div>
        </SideSheet>
      )}

      {/* Entitlement Form */}
      {open === "entitlement" && (
        <SideSheet
          title="Grant credits"
          testId="ent-form"
          busy={busy}
          error={problem}
          saveLabel="Grant them"
          onCancel={() => setOpen(null)}
          onSave={() =>
            run(() =>
              api.createEntitlement({
                ownerUserId,
                serviceId,
                totalCredits: Number(credits),
                expiresAt: expiresAt || undefined,
              })
            )
          }
        >
          <div className="flex flex-col gap-4">
            <Field>
              <FieldLabel>Who</FieldLabel>
              <Combobox
                testId="ent-owner"
                value={ownerUserId}
                options={people.map((p) => ({
                  value: p.id,
                  label: p.display_name ?? p.name,
                }))}
                onValueChange={setOwnerUserId}
              />
            </Field>
            <Field>
              <FieldLabel>For which service</FieldLabel>
              <Combobox
                testId="ent-service"
                value={serviceId}
                options={services.map((s) => ({
                  value: s.id,
                  label: s.name,
                }))}
                onValueChange={setServiceId}
              />
            </Field>
            <Field>
              <FieldLabel>How many sessions</FieldLabel>
              <Input
                type="number"
                min="1"
                data-testid="ent-credits"
                value={credits}
                onChange={(e) => setCredits(e.target.value)}
              />
              <FieldDescription>
                Each credit is one session, consumed when a session is held.
              </FieldDescription>
            </Field>
            <Field>
              <FieldLabel>Expires (optional)</FieldLabel>
              <Input
                type="date"
                data-testid="ent-expires"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
              />
            </Field>
          </div>
        </SideSheet>
      )}

      {/* Card Form */}
      {open === "card" && (
        <SideSheet
          title="Add a card"
          testId="card-form"
          busy={busy}
          error={problem}
          saveLabel="Save the card"
          onCancel={() => setOpen(null)}
          onSave={() =>
            run(async () => {
              const token = await stripe.createPaymentMethod();
              return api.createPaymentMethod(token);
            })
          }
        >
          <div className="flex flex-col gap-4">
            {stripe?.mountCardElement ? (
              <>
                <div
                  className="min-h-12 rounded-control border border-line bg-surface p-3"
                  data-testid="card-element"
                  ref={setCardMount}
                />
                <p className="text-meta text-mute">
                  Card details go straight to Stripe. They are never sent to, or
                  stored by, Workbench.
                </p>
              </>
            ) : (
              <>
                <p
                  className="text-meta text-mute"
                  data-testid="card-not-configured"
                >
                  Card payments are not set up for this practice yet, so there
                  is nowhere to put a card.
                </p>
                <p className="text-meta text-mute">
                  Connect Stripe under Settings → Billing first. Nothing has
                  been lost — invoices and subscriptions still work; only taking
                  a card on file needs the connection.
                </p>
              </>
            )}
          </div>
        </SideSheet>
      )}

      {/* Cancel Subscription Confirm */}
      <DecisionModal
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        title="Cancel subscription?"
        subtitle={`${subscription?.plan_name ?? "this subscription"}${
          subscription?.payer_name
            ? ` for ${subscription.payer_name}`
            : ""
        }`}
        rows={[
          {
            headline: atPeriodEnd
              ? "It keeps running and billing until the current period ends, then stops. Sessions already booked are kept."
              : "It stops now. No further payments are taken. Sessions already booked are kept.",
            detail:
              atPeriodEnd && subscription?.current_period_end
                ? `Ends on ${subscription.current_period_end}.`
                : null,
          },
        ]}
        cancelLabel="Keep it running"
        confirmLabel={atPeriodEnd ? "Stop at period end" : "Stop it now"}
        busy={busy}
        error={problem}
        testId="sub-cancel"
        onCancel={() => setCancelOpen(false)}
        onConfirm={() =>
          run(() =>
            api.cancelSubscription({
              subscriptionId: subscription.id,
              atPeriodEnd,
            })
          )
        }
      >
        <label className="mt-3 flex cursor-pointer items-center gap-3">
          <input
            type="checkbox"
            data-testid="sub-cancel-at-period-end"
            checked={atPeriodEnd}
            onChange={(e) => setAtPeriodEnd(e.target.checked)}
            className="cursor-pointer"
          />
          <span className="text-ui" data-testid="sub-cancel-when">
            Let the current period finish first
          </span>
        </label>
      </DecisionModal>
    </div>
  );
}
