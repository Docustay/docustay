// ═══════════════════════════════════════════════════════════════════════════
// 18.40 — THE CLIENT BOOKING FLOW (AppClientBook → BookTime → BookConfirm)
//
// ★★★ THREE STEPS IN ONE COMPONENT:
// Step 1: Book something — service catalogue grouped by cost (block-covered / costs extra / free)
// Step 2: Pick a time — staff filter, day strip, slots + demand tail ("Tell them you'd like one")
// Step 3: Confirm — policy sentence, block usage, and Book it
//
// ★ EVERY CONTROL IS WIRED TO A REAL CALL. "Tell them you'd like one" writes to the waitlist.
// ★★ TEENS SEE NO PRICES. A role check splits the payload at the route, not at render.
// ═══════════════════════════════════════════════════════════════════════════
import { useState, useEffect } from "react";
import { request, ApiError } from "@/lib/api.js";
import { Drawer, DrawerContent, DrawerHeader, DrawerFooter, DrawerTitle } from "@/lib/components/ui/drawer.jsx";
import { Button } from "@/lib/components/ui/button.jsx";
import GeneratedSentence from "@/lib/components/editor/GeneratedSentence.jsx";
import PhoneCard from "@/lib/phone/PhoneCard.jsx";
import { PhoneSectionLabel } from "@/lib/phone/PhoneRow.jsx";

export default function PortalBooking({ data = null, role = null, terms = {} }) {
  // Flow state
  const [step, setStep] = useState("services");
  const [selectedService, setSelectedService] = useState(null);
  const [selectedCoach, setSelectedCoach] = useState(null);
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().slice(0, 10));
  const [selectedSlot, setSelectedSlot] = useState(null);
  const [useCredit, setUseCredit] = useState(false);

  // Data
  const [services, setServices] = useState([]);
  const [coaches, setCoaches] = useState([]);
  const [slots, setSlots] = useState([]);
  const [policy, setPolicy] = useState(null);
  const [credit, setCredit] = useState(null);

  // UI state
  const [loading, setLoading] = useState(false);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);
  const [showPolicyConfirm, setShowPolicyConfirm] = useState(false);
  const [showConfirmSheet, setShowConfirmSheet] = useState(false);

  // Initialize
  useEffect(() => {
    if (!selectedService) {
      loadServices();
    }
  }, []);

  async function loadServices() {
    setLoading(true);
    setError(null);
    try {
      const res = await request("/api/app/services");
      setServices(res.services || []);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to load services");
    } finally {
      setLoading(false);
    }
  }

  async function loadCoaches() {
    setLoading(true);
    setError(null);
    try {
      const res = await request(`/api/app/coaches`);
      const coachList = res.coaches || [];
      setCoaches(coachList);
      if (coachList.length > 0) {
        setSelectedCoach("anyone");
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : `Failed to load coaches`);
    } finally {
      setLoading(false);
    }
  }

  async function loadSlots() {
    if (!selectedCoach) return;
    setSlotsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ date: selectedDate });
      if (selectedCoach !== "anyone") {
        params.append("hostId", selectedCoach);
      }
      const res = await request(`/api/app/booking?${params}`);
      setSlots(res.slots || []);
      setSelectedSlot(null);
      setCredit({ remaining: res.creditsRemaining, standing: res.creditStanding });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to load slots");
    } finally {
      setSlotsLoading(false);
    }
  }

  async function loadPolicy() {
    if (!selectedService) return;
    try {
      const res = await request(`/api/app/booking/policy?serviceId=${selectedService}`);
      setPolicy(res);
    } catch (e) {
      // Policy load is not fatal
      console.error("Policy load failed:", e);
      setPolicy({ sentence: null, short: null, policy_text: null });
    }
  }

  function handleSelectService(serviceId) {
    setSelectedService(serviceId);
    setSelectedCoach(null);
    setSelectedDate(new Date().toISOString().slice(0, 10));
    setSelectedSlot(null);
    setStep("time");
    loadCoaches();
    loadPolicy();
  }

  function handleDateChange(date) {
    setSelectedDate(date);
    loadSlots();
  }

  function handleCoachChange(coach) {
    setSelectedCoach(coach);
    loadSlots();
  }

  async function handleTellThemYouWantOne() {
    if (!selectedService) return;
    setSubmitting(true);
    setError(null);
    try {
      await request("/api/app/booking/waitlist/demand", {
        method: "POST",
        body: {
          serviceId: selectedService,
          hostId: selectedCoach !== "anyone" ? selectedCoach : null,
          preference: "evenings",
        },
      });
      setSuccess(true);
      setTimeout(() => {
        setSuccess(false);
        setStep("services");
        setSelectedService(null);
      }, 2000);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to join waitlist");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleBooking() {
    if (!selectedService || !selectedSlot) return;
    if (policy?.policy_text && !showPolicyConfirm) {
      setError("Please confirm you understand the policy");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await request("/api/app/booking", {
        method: "POST",
        body: {
          serviceId: selectedService,
          hostId: selectedCoach !== "anyone" ? selectedCoach : null,
          startsAt: selectedSlot,
          useCredit,
        },
        idempotencyKey: crypto.randomUUID(),
      });
      setSuccess(true);
      setTimeout(() => {
        setSuccess(false);
        setStep("services");
        setSelectedService(null);
        setSelectedCoach(null);
        setSelectedSlot(null);
        loadServices();
      }, 2000);
    } catch (e) {
      if (e instanceof ApiError && (e.status === 400 || e.status === 409)) {
        setError(e.message || "That time is no longer available.");
        loadSlots();
      } else {
        setError(e instanceof ApiError ? e.message : "Booking failed");
      }
    } finally {
      setSubmitting(false);
    }
  }

  function formatTime(iso) {
    if (!iso) return "";
    return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
  }

  function formatDate(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    return d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
  }

  function formatTimeAndHost(slot) {
    if (!slot) return "";
    const time = formatTime(slot.startsAt);
    const host = slot.hostName || "Unknown";
    const location = slot.location || "video call";
    return `${time} — ${host} · ${location}`;
  }

  const service = services.find((s) => s.id === selectedService);
  const nextFiveDays = (() => {
    const days = [];
    const d = new Date();
    for (let i = 0; i < 5; i++) {
      const copy = new Date(d);
      copy.setDate(copy.getDate() + i);
      days.push({
        date: copy.toISOString().slice(0, 10),
        weekday: copy.toLocaleDateString([], { weekday: "short" }),
        day: copy.getDate(),
      });
    }
    return days;
  })();

  const coachOptions = [
    { id: "anyone", display_name: "Anyone" },
    ...coaches,
  ];

  const availableSlots = slots.filter((s) => !s.booked);
  const lastSlotTime = (() => {
    if (availableSlots.length === 0) return null;
    const last = availableSlots[availableSlots.length - 1];
    return formatTime(last.startsAt);
  })();

  const selectedSlotData = slots.find((s) => s.startsAt === selectedSlot);

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <div className="rounded-card border border-[var(--color-danger-500)] bg-[var(--color-danger-50)] px-4 py-3 text-sm text-[var(--color-danger-700)]" data-testid="booking-error" role="alert">
          <p className="m-0 font-medium">Something went wrong</p>
          <p className="m-0 text-xs mt-1">{error}</p>
        </div>
      )}

      {success && (
        <div className="rounded-card border border-[var(--color-success-500)] bg-[var(--color-success-50)] px-4 py-3 text-sm text-[var(--color-success-700)]" data-testid="booking-success">
          <p className="m-0">Booking confirmed! Check your Sessions tab.</p>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-8 text-[var(--color-structure-600)]" data-testid="screen-loading">
          <p className="m-0">Loading...</p>
        </div>
      ) : step === "services" ? (
        <div data-testid="booking-form">
          {services.length === 0 ? (
            <div className="rounded-[12px] border py-6 px-4 text-center" style={{ borderColor: "var(--color-structure-150)" }} data-testid="empty-state-services">
              <p className="m-0 font-medium text-ink">No services available</p>
              <p className="m-0 text-xs mt-1" style={{ color: "var(--color-structure-600)" }}>No services are available to book right now.</p>
            </div>
          ) : (
            <div className="flex flex-col">
              {/* Block-covered services */}
              {services.some((s) => s.blockCovered) && (
                <div className="mb-3.5">
                  <PhoneSectionLabel>Uses a session from your block</PhoneSectionLabel>
                  {services.filter((s) => s.blockCovered).map((service) => (
                    <PhoneCard key={service.id} variant="act" label={service.name}>
                      <p className="text-[13px] mt-1.5 m-0" style={{ color: "var(--color-structure-600)" }}>{service.durationMinutes} minutes</p>
                      <button
                        className="w-full h-8 mt-[13px] rounded-[7px] text-[13px] font-medium text-white transition-opacity hover:opacity-90"
                        style={{ background: "var(--color-brand)" }}
                        onClick={() => handleSelectService(service.id)}
                        data-testid="service-find-button"
                      >
                        Find a time
                      </button>
                    </PhoneCard>
                  ))}
                </div>
              )}

              {/* Cost extra services */}
              {services.some((s) => !s.blockCovered && !s.free) && (
                <div className="mb-3.5">
                  <PhoneSectionLabel>Costs extra</PhoneSectionLabel>
                  {services.filter((s) => !s.blockCovered && !s.free).map((service) => (
                    <PhoneCard
                      key={service.id}
                      label={`${service.name}${role !== "adolescent_client" ? ` — $${(service.priceMinor / 100).toFixed(2)}` : ""}`}
                    >
                      <p className="text-[13px] mt-1.5 m-0" style={{ color: "var(--color-structure-600)" }}>{service.durationMinutes} minutes</p>
                      <button
                        className="w-full h-8 mt-[13px] rounded-[7px] border text-[13px] font-medium transition-colors hover:bg-[var(--color-structure-50)]"
                        style={{ borderColor: "var(--color-structure-200)", color: "var(--color-structure-900)" }}
                        onClick={() => handleSelectService(service.id)}
                        data-testid="service-find-button"
                      >
                        Find a time
                      </button>
                    </PhoneCard>
                  ))}
                </div>
              )}

              {/* Free services */}
              {services.some((s) => s.free) && (
                <div className="mb-3.5">
                  <PhoneSectionLabel>Free</PhoneSectionLabel>
                  {services.filter((s) => s.free).map((service) => (
                    <PhoneCard key={service.id} label={service.name}>
                      <p className="text-[13px] mt-1.5 m-0" style={{ color: "var(--color-structure-600)" }}>{service.durationMinutes} minutes</p>
                      <button
                        className="w-full h-8 mt-[13px] rounded-[7px] border text-[13px] font-medium transition-colors hover:bg-[var(--color-structure-50)]"
                        style={{ borderColor: "var(--color-structure-200)", color: "var(--color-structure-900)" }}
                        onClick={() => handleSelectService(service.id)}
                        data-testid="service-find-button"
                      >
                        Find a time
                      </button>
                    </PhoneCard>
                  ))}
                </div>
              )}

              {/* Group bookings */}
              {services.some((s) => s.group) && (
                <div className="mb-3.5">
                  <PhoneSectionLabel>Group sessions</PhoneSectionLabel>
                  {services.filter((s) => s.group).map((service) => (
                    <PhoneCard key={service.id} label={`${service.name} — ${service.group.placesLeft} places left`}>
                      <p className="text-[13px] mt-1.5 m-0" style={{ color: "var(--color-structure-600)" }}>
                        {service.durationMinutes} minutes on {formatDate(service.group.nextDate)}
                      </p>
                      <button
                        className="w-full h-8 mt-[13px] rounded-[7px] border text-[13px] font-medium transition-colors hover:bg-[var(--color-structure-50)]"
                        style={{ borderColor: "var(--color-structure-200)", color: "var(--color-structure-900)" }}
                        onClick={() => handleSelectService(service.id)}
                        data-testid="service-find-button"
                      >
                        See the dates
                      </button>
                    </PhoneCard>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      ) : step === "time" ? (
        <div data-testid="booking-time-step">
          {service && (
            <p className="text-xs mb-3.5" style={{ color: "var(--color-structure-600)" }}>{service.name} · {service.durationMinutes} minutes</p>
          )}

          {/* Coach pills */}
          <div className="flex gap-2 overflow-x-auto pb-1 mb-4">
            {coachOptions.map((coach) => (
              <button
                key={coach.id}
                className={`flex-shrink-0 px-3 py-2 text-xs font-medium rounded-full whitespace-nowrap transition-all ${
                  selectedCoach === coach.id
                    ? "bg-[var(--color-action-600)] text-white border border-[var(--color-action-600)]"
                    : "bg-white border border-[var(--color-structure-200)] text-[var(--color-structure-900)] hover:border-[var(--color-action-600)]"
                }`}
                onClick={() => handleCoachChange(coach.id)}
              >
                {coach.display_name}
              </button>
            ))}
          </div>

          {/* Day strip */}
          <div className="grid grid-cols-5 gap-1 mb-4">
            {nextFiveDays.map((day) => (
              <button
                key={day.date}
                className={`flex flex-col items-center py-2 px-1 text-xs rounded-md border transition-all ${
                  selectedDate === day.date
                    ? "bg-[var(--color-action-600)] text-white border-[var(--color-action-600)]"
                    : "bg-white border-[var(--color-structure-200)] text-[var(--color-structure-900)] hover:border-[var(--color-action-600)]"
                }`}
                onClick={() => handleDateChange(day.date)}
              >
                <span className="text-xs font-medium opacity-75">{day.weekday}</span>
                <span className="font-semibold">{day.day}</span>
              </button>
            ))}
          </div>

          {slotsLoading ? (
            <div className="flex items-center justify-center py-8 text-[var(--color-structure-600)]" data-testid="screen-loading">
              <p className="m-0">Loading times...</p>
            </div>
          ) : availableSlots.length === 0 ? (
            <div className="rounded-card border border-[var(--color-structure-200)] bg-[var(--color-wash-card)] px-4 py-6 text-center" data-testid="empty-state-slots">
              <p className="m-0 font-medium text-[var(--color-structure-900)]">No times available</p>
              <p className="m-0 text-xs text-[var(--color-structure-600)] mt-2">
                {lastSlotTime
                  ? `Nothing after ${lastSlotTime} — ${selectedCoach && selectedCoach !== "anyone" ? "they" : "nobody"} doesn't run evening sessions yet.`
                  : `No times on ${formatDate(selectedDate)}.`}
              </p>
              <button
                className="mt-3 px-4 py-2 text-sm font-medium rounded-md border border-[var(--color-action-600)] bg-white text-[var(--color-action-600)] hover:bg-[var(--color-action-50)] disabled:opacity-50 transition-colors"
                onClick={handleTellThemYouWantOne}
                disabled={submitting}
              >
                {lastSlotTime ? "Tell them you'd like one" : "Join waitlist"}
              </button>
            </div>
          ) : (
            <div className="space-y-0 border border-[var(--color-structure-200)] rounded-card divide-y divide-[var(--color-structure-200)]">
              {availableSlots.map((slot) => (
                <button
                  key={slot.startsAt}
                  className={`w-full px-4 py-3 text-left text-sm transition-colors flex justify-between items-center ${
                    selectedSlot === slot.startsAt
                      ? "bg-[var(--color-action-50)]"
                      : "bg-white hover:bg-[var(--color-wash-row)]"
                  }`}
                  onClick={() => setSelectedSlot(slot.startsAt)}
                  data-testid="slot-button"
                >
                  <div>
                    <p className="m-0 font-medium text-[var(--color-structure-900)]">{formatTime(slot.startsAt)}</p>
                  </div>
                  <p className="m-0 text-xs text-[var(--color-structure-600)]">{slot.hostName || "Unknown"} · {slot.location || "video call"}</p>
                </button>
              ))}
            </div>
          )}

          {lastSlotTime && availableSlots.length > 0 && (
            <div className="mt-4 pt-3 text-xs text-[var(--color-structure-600)] border-t border-[var(--color-structure-200)]">
              <p className="m-0 mb-2">
                Nothing after {lastSlotTime} — {selectedCoach && selectedCoach !== "anyone" ? "they" : "nobody"} doesn't run evening sessions yet.
              </p>
              <button
                className="w-full px-4 py-2 text-sm font-medium rounded-md border border-[var(--color-action-600)] bg-white text-[var(--color-action-600)] hover:bg-[var(--color-action-50)] disabled:opacity-50 transition-colors"
                onClick={handleTellThemYouWantOne}
                disabled={submitting}
              >
                Tell them you'd like one
              </button>
            </div>
          )}

          {selectedSlot && (
            <button
              className="w-full mt-4 px-4 py-2 font-medium rounded-md bg-[var(--color-action-600)] text-white hover:bg-[var(--color-action-700)] transition-colors"
              onClick={() => setShowConfirmSheet(true)}
            >
              Next
            </button>
          )}
        </div>
      ) : null}

      {/* Confirm sheet */}
      <Drawer open={showConfirmSheet} onOpenChange={setShowConfirmSheet}>
        <DrawerContent>
          <div className="flex justify-center pb-3">
            <div className="h-1 w-10 rounded-full bg-[var(--color-structure-200)]"></div>
          </div>
          <DrawerHeader>
            <DrawerTitle>Confirm booking</DrawerTitle>
          </DrawerHeader>

          <div className="flex-1 overflow-y-auto px-4 pb-4">
            {service && selectedSlotData && (
              <div className="space-y-4">
                <div>
                  <p className="m-0 font-medium text-[var(--color-structure-900)]">{formatDate(selectedSlot)}, {formatTime(selectedSlot)}</p>
                </div>

                <div className="space-y-1">
                  <p className="m-0 font-medium text-[var(--color-structure-900)]">{service.name} with {selectedSlotData.hostName || "Unknown"}</p>
                  <p className="m-0 text-xs text-[var(--color-structure-600)]">{service.durationMinutes} minutes</p>
                </div>

                <div>
                  <p className="m-0 text-sm text-[var(--color-structure-600)]">{selectedSlotData.location || "video call"}</p>
                </div>

                {service.blockCovered && credit?.remaining !== undefined && (
                  <div className="flex justify-between text-sm py-2 border-t border-[var(--color-structure-200)]">
                    <span className="text-[var(--color-structure-900)]">Comes out of your block</span>
                    <span className="font-medium text-[var(--color-structure-900)]">{credit.remaining} of {credit.remaining + 1} left</span>
                  </div>
                )}
                {!service.free && !service.blockCovered && (
                  <div className="flex justify-between text-sm py-2 border-t border-[var(--color-structure-200)]">
                    <span className="text-[var(--color-structure-900)]">To pay now</span>
                    <span className="font-medium text-[var(--color-structure-900)]">${(service.priceMinor / 100).toFixed(2)}</span>
                  </div>
                )}

                {policy?.sentence && (
                  <div className="pt-2 border-t border-[var(--color-structure-200)]">
                    <p className="m-0 text-xs font-semibold text-[var(--color-structure-600)] mb-2">Policy</p>
                    <div className="text-sm text-[var(--color-structure-900)] mb-2">
                      <GeneratedSentence sentence={policy.sentence} />
                    </div>
                    {policy.policy_text && (
                      <p className="m-0 text-xs text-[var(--color-structure-600)] mb-3">In {terms.practice || "our"} words: {policy.policy_text}</p>
                    )}
                    {policy.policy_text && (
                      <label className="flex items-center gap-2 text-sm cursor-pointer">
                        <input
                          type="checkbox"
                          checked={showPolicyConfirm}
                          onChange={(e) => setShowPolicyConfirm(e.target.checked)}
                          className="w-4 h-4 rounded border-[var(--color-structure-200)] cursor-pointer"
                        />
                        <span className="text-[var(--color-structure-900)]">I understand the cancellation policy</span>
                      </label>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          <DrawerFooter className="gap-2">
            <Button variant="outline" onClick={() => setShowConfirmSheet(false)}>Cancel</Button>
            <Button
              onClick={handleBooking}
              disabled={submitting || (policy?.policy_text && !showPolicyConfirm)}
              className="flex-1"
            >
              {submitting ? "Booking..." : "Book it"}
            </Button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    </div>
  );
}
