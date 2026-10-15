import { useEffect, useState } from "react";
import { request } from "@/lib/api.js";
import DeviceRow from "@/lib/money/DeviceRow.jsx";
import ErrorPanel from "@/lib/empty/ErrorPanel.jsx";
import { Button } from "@/lib/components/ui/button.jsx";

export default function MoneyReaders({ onNavigate }) {
  const [phase, setPhase] = useState("loading");
  const [devices, setDevices] = useState([]);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState("shop");
  const [registrationCode, setRegistrationCode] = useState("");
  const [deviceName, setDeviceName] = useState("");
  const [registering, setRegistering] = useState(false);
  const [registerError, setRegisterError] = useState(null);

  async function fetchDevices() {
    try {
      setPhase("loading");
      setError(null);
      const res = await request("/api/money/devices");
      setDevices(res.devices || []);
      setPhase(res.devices && res.devices.length === 0 ? "empty" : "ready");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase("error");
    }
  }

  async function handleRegister() {
    if (!registrationCode.trim() || !deviceName.trim()) {
      setRegisterError("Both registration code and name are required.");
      return;
    }

    setRegistering(true);
    setRegisterError(null);

    try {
      await request("/api/money/devices/register", {
        method: "POST",
        body: { registrationCode, name: deviceName },
      });

      setRegistrationCode("");
      setDeviceName("");
      await fetchDevices();
    } catch (err) {
      setRegisterError(err instanceof Error ? err.message : String(err));
    } finally {
      setRegistering(false);
    }
  }

  async function handleDeactivate(deviceId) {
    if (!confirm("Deactivate it here and it stops working immediately.")) {
      return;
    }

    try {
      await request("/api/money/devices/deactivate", {
        method: "POST",
        body: { deviceId },
      });

      await fetchDevices();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  // Load initial data on mount
  useEffect(() => {
    fetchDevices();
  }, []);

  return (
    <div className="money-readers flex flex-col gap-6" data-testid="money-readers">
      {/* Tabs */}
      <div className="flex gap-4 border-b border-line pb-0">
        <button
          className={`pb-3 border-b-2 font-medium text-sm transition-all ${
            activeTab === "shop"
              ? "border-brand text-ink"
              : "border-transparent text-mute hover:text-ink"
          }`}
          onClick={() => setActiveTab("shop")}
        >
          Shop
        </button>
        <button
          className={`pb-3 border-b-2 font-medium text-sm transition-all ${
            activeTab === "orders"
              ? "border-brand text-ink"
              : "border-transparent text-mute hover:text-ink"
          }`}
          onClick={() => setActiveTab("orders")}
        >
          Orders
        </button>
      </div>

      {/* Shop Tab */}
      {activeTab === "shop" && (
        <div className="flex flex-col gap-6">
          <div className="mb-3">
            <h1 className="m-0 text-2xl font-medium">Card readers</h1>
            <p className="m-0 mt-2 text-sm text-mute">
              Most practices need nothing at all. Start with the phone in your pocket.
            </p>
          </div>

          {/* Promo Banner */}
          <div className="flex gap-3 rounded-lg border border-ok bg-ok-soft p-4 items-start">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center text-xl">
              ☎️
            </div>
            <div className="flex-1">
              <h3 className="m-0 text-sm font-medium text-ok mb-1">
                Try Tap to Pay first. It is free.
              </h3>
              <p className="m-0 text-sm text-ok leading-relaxed mb-3">
                Your iPhone or Android phone already takes cards — no reader, no cable, nothing to charge or lose. Buy hardware only when you find something it cannot do.
              </p>
              <Button size="sm">Set up Tap to Pay</Button>
            </div>
          </div>

          {/* ★ FOUND LIVE, 28 Sep 2026 — Terminal Hardware Products/Orders has NO public REST API
              at all (confirmed: a Stripe API search for the resource returns zero operations) —
              this is a genuine platform limitation, not something buildable on "the Stripe API"
              the way payouts/disputes/balance are. Real readers (Terminal Readers/Locations) DO
              have a real API and are already used correctly below, in "Registered readers". */}
          <div className="rounded-lg border border-line bg-surface p-5 text-sm text-mute">
            Ordering new hardware isn't available through the Stripe API — only through Stripe's
            own dashboard.{" "}
            <a
              href="https://dashboard.stripe.com/terminal/hardware"
              target="_blank"
              rel="noreferrer"
              className="text-brand underline"
              data-testid="hardware-shop-dashboard-link"
            >
              Open the hardware shop on Stripe →
            </a>
          </div>
        </div>
      )}

      {/* Orders Tab */}
      {activeTab === "orders" && (
        <div className="flex flex-col gap-6">
          <div className="mb-3">
            <h1 className="m-0 text-2xl font-medium">Your orders</h1>
          </div>

          {/* ★ Same limitation as the Shop tab above — no Hardware Orders API exists. */}
          <div className="rounded-lg border border-line bg-surface p-5 text-sm text-mute">
            Order history isn't available through the Stripe API — check{" "}
            <a
              href="https://dashboard.stripe.com/terminal/hardware/orders"
              target="_blank"
              rel="noreferrer"
              className="text-brand underline"
              data-testid="hardware-orders-dashboard-link"
            >
              your orders on Stripe →
            </a>
          </div>

          {/* When it arrives steps */}
          <div className="flex flex-col gap-4 rounded-lg bg-surface p-5">
            <h2 className="m-0 text-base font-medium">When it arrives</h2>
            <div className="flex flex-col gap-4">
              <div className="flex gap-3">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand text-white text-xs font-semibold">
                  1
                </div>
                <div className="min-w-0 flex-1">
                  <p className="m-0 text-sm font-medium text-ink mb-1">
                    Take it out and turn it on
                  </p>
                  <p className="m-0 text-sm text-mute">
                    It is already paired to your account — Stripe loads the keys before posting it.
                  </p>
                </div>
              </div>

              <div className="flex gap-3">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand text-white text-xs font-semibold">
                  2
                </div>
                <div className="min-w-0 flex-1">
                  <p className="m-0 text-sm font-medium text-ink mb-1">
                    Give it a name and a location
                  </p>
                  <p className="m-0 text-sm text-mute">
                    "Front desk, Santa Cruz". Matters once you have more than one.
                  </p>
                </div>
              </div>

              <div className="flex gap-3">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand text-white text-xs font-semibold">
                  3
                </div>
                <div className="min-w-0 flex-1">
                  <p className="m-0 text-sm font-medium text-ink mb-1">
                    Charge it for a $1 test
                  </p>
                  <p className="m-0 text-sm text-mute">
                    Then refund yourself. Takes a minute and proves the whole chain works.
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Registered readers section */}
          <div className="flex flex-col gap-5 border-t border-line pt-5">
            <h2 className="m-0 text-base font-medium">Registered readers</h2>

            {phase === "loading" && (
              <div className="rounded-lg bg-surface p-5 text-center text-mute">
                <p className="m-0">Loading your readers...</p>
              </div>
            )}

            {phase === "error" && (
              <ErrorPanel
                error={{ message: error || "Could not load registered readers." }}
                variant="band"
              />
            )}

            {phase === "empty" && (
              <div className="rounded-lg bg-surface p-5 text-center text-mute">
                <p className="m-0">No readers registered yet.</p>
              </div>
            )}

            {phase === "ready" && (
              <div className="flex flex-col gap-3">
                {devices.map((device) => (
                  <DeviceRow
                    key={device.id}
                    device={device}
                    onDeactivate={() => handleDeactivate(device.id)}
                  />
                ))}
              </div>
            )}

            {/* Register a new reader form */}
            <div className="flex flex-col gap-4 rounded-lg bg-surface p-5">
              <h3 className="m-0 text-sm font-medium">Register a new reader</h3>

              {registerError && (
                <div className="rounded-md bg-bad-soft px-3 py-2 text-sm text-bad">
                  {registerError}
                </div>
              )}

              <div className="flex flex-col gap-1.5">
                <label htmlFor="registrationCode" className="text-sm font-medium text-ink-2">
                  Registration code
                </label>
                <input
                  id="registrationCode"
                  type="text"
                  value={registrationCode}
                  onChange={(e) => setRegistrationCode(e.target.value)}
                  placeholder="Enter the code from your reader"
                  disabled={registering}
                  className="rounded-md border border-line bg-white px-3 py-2 text-sm disabled:opacity-60"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label htmlFor="deviceName" className="text-sm font-medium text-ink-2">
                  Device name
                </label>
                <input
                  id="deviceName"
                  type="text"
                  value={deviceName}
                  onChange={(e) => setDeviceName(e.target.value)}
                  placeholder="e.g., Front desk, Santa Cruz"
                  disabled={registering}
                  className="rounded-md border border-line bg-white px-3 py-2 text-sm disabled:opacity-60"
                />
              </div>

              <Button
                onClick={handleRegister}
                disabled={registering || !registrationCode.trim() || !deviceName.trim()}
              >
                {registering ? "Registering..." : "Register"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
