import { useEffect, useState, useCallback } from "react";
import { request, ApiError } from "@/lib/api.js";
import { Button } from "@/lib/components/ui/button.jsx";
import { Alert, AlertDescription } from "@/lib/components/ui/alert.jsx";

const SHAPES = [
  { value: "crm", label: "CRM", detail: "People, engagements, invoicing and payments, documents, items and services" },
  { value: "run", label: "Run", detail: "Accounts, network, growth and reports" },
  { value: "both", label: "Both", detail: "Everything" },
];

const COACHING_TYPES = [
  { value: "coaching", label: "Coaching" },
  { value: "recovery_coaching", label: "Recovery coaching" },
  { value: "tutoring", label: "Tutoring" },
  { value: "personal_training", label: "Personal training" },
  { value: "consulting", label: "Consulting" },
  { value: "salon_and_spa", label: "Salon and spa" },
  { value: "nutrition", label: "Nutrition" },
  { value: "music_and_arts", label: "Music and arts" },
  { value: "doula_and_birth", label: "Doula and birth services" },
  { value: "pet_services", label: "Pet services" },
  { value: "photography", label: "Photography" },
  { value: "legal_and_accounting", label: "Legal and accounting" },
  { value: "inspection_and_trades", label: "Inspection and trades" },
  { value: "language_and_translation", label: "Language and translation" },
  { value: "driving_instruction", label: "Driving instruction" },
  { value: "event_planning", label: "Event planning" },
  { value: "other", label: "Something else" },
];

const TEAM_SIZES = [
  { value: "just_me", label: "Just me" },
  { value: "small", label: `2–5 coaches` },
  { value: "large", label: "More than 5" },
];

const MOVING_FROM = [
  { value: "no", label: "No, starting fresh" },
  { value: "carepatron", label: "Carepatron" },
  { value: "simplepractice", label: "SimplePractice" },
  { value: "square", label: "Square" },
  { value: "spreadsheet", label: "Spreadsheet" },
  { value: "other", label: "Other" },
];

const STARTER_SERVICE_PREVIEW = {
  coaching: ["Individual coaching session", "Goal-setting session"],
  recovery_coaching: ["Individual recovery session", "Family session"],
  tutoring: ["Tutoring session", "Progress review"],
  personal_training: ["Personal training session", "Fitness assessment"],
  consulting: ["Consulting session", "Strategy session"],
  salon_and_spa: ["Appointment", "Treatment session"],
  nutrition: ["Nutrition consultation", "Follow-up session"],
  music_and_arts: ["Lesson", "Practice session"],
  doula_and_birth: ["Prenatal visit", "Birth support session"],
  pet_services: ["Appointment", "Follow-up visit"],
  photography: ["Session booking", "Consultation"],
  legal_and_accounting: ["Consultation", "Review session"],
  inspection_and_trades: ["Inspection", "Follow-up visit"],
  language_and_translation: ["Lesson", "Practice session"],
  driving_instruction: ["Driving lesson", "Test prep session"],
  event_planning: ["Consultation", "Planning session"],
  other: ["Individual session", "Consultation"],
};

// F31/F63 — a selected card or chip must read as selected at a glance: a solid brand chip, and a 2px brand border over a visible tint (brand-soft alone is almost white).
const SELECTED_TINT = "color-mix(in srgb, var(--color-brand) 12%, var(--color-surface))";

export default function SignupQuestions({ mode = null, onDone = null, onSubmit = null }) {
  const [phase, setPhase] = useState("loading");
  const [loadError, setLoadError] = useState(null);
  const [forbiddenReason, setForbiddenReason] = useState(null);

  // Post-sign-in mode state
  const [shape, setShape] = useState(null);
  const [coachingType, setCoachingType] = useState(null);
  const [teamSize, setTeamSize] = useState(null);
  const [movingFrom, setMovingFrom] = useState(null);
  const [sampleClientsRequested, setSampleClientsRequested] = useState(true);

  // Signup mode state
  const [serviceType, setServiceType] = useState(null);
  const [teamSizeSignup, setTeamSizeSignup] = useState(null);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  // Minted once per mount, not once per click
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  // Derived
  const canSubmit = shape !== null && coachingType !== null && teamSize !== null && movingFrom !== null && !submitting;
  const signupCanSubmit = serviceType !== null && !submitting;
  const movingFromLabel = MOVING_FROM.find((m) => m.value === movingFrom)?.label ?? null;

  useEffect(() => {
    if (mode === "signup") {
      setPhase("questions");
      return;
    }

    // Post-sign-in mode: check state
    (async () => {
      try {
        const state = await request("/api/signup/questions/state");
        if (state.intakeAnswered) {
          onDone?.({ ok: true, alreadyAnswered: true });
          return;
        }
        setPhase("questions");
      } catch (err) {
        if (err instanceof ApiError && err.status === 403) {
          setForbiddenReason(err.message);
        } else {
          setLoadError(err instanceof ApiError ? err.message : "Something went wrong. Try again.");
        }
        setPhase("questions");
      }
    })();
  }, [mode, onDone]);

  const handleSubmitSignup = useCallback(async () => {
    if (!signupCanSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      onSubmit?.({
        serviceType,
        teamSize: teamSizeSignup,
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Try again.");
    } finally {
      setSubmitting(false);
    }
  }, [signupCanSubmit, serviceType, teamSizeSignup, onSubmit]);

  const handleSubmit = useCallback(async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    setForbiddenReason(null);
    try {
      const result = await request("/api/signup/questions", {
        method: "POST",
        body: { shape, coachingType, teamSize, movingFrom, sampleClientsRequested },
        idempotencyKey,
      });
      onDone?.(result);
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setForbiddenReason(err.message);
      } else if (err instanceof ApiError && err.status === 409) {
        onDone?.({ ok: true, alreadyAnswered: true });
      } else {
        setError(err instanceof ApiError ? err.message : "Something went wrong. Try again.");
      }
    } finally {
      setSubmitting(false);
    }
  }, [canSubmit, shape, coachingType, teamSize, movingFrom, sampleClientsRequested, idempotencyKey, onDone]);

  // Render forbidden
  if (forbiddenReason) {
    return (
      <div className="flex justify-center min-h-full px-6 py-14 box-border" style={{ backgroundColor: "var(--color-paper)" }}>
        <div className="flex flex-col gap-6 w-full max-w-xl">
          <Alert variant="destructive">
            <AlertDescription role="alert" data-testid="signup-questions-forbidden">
              {forbiddenReason}
            </AlertDescription>
          </Alert>
        </div>
      </div>
    );
  }

  // Render loading
  if (phase === "loading") {
    return (
      <div className="flex justify-center min-h-full px-6 py-14 box-border" style={{ backgroundColor: "var(--color-paper)" }}>
        <div className="flex flex-col gap-6 w-full max-w-xl">
          <p role="status" data-testid="signup-questions-loading" className="text-ui text-ink">
            Loading…
          </p>
        </div>
      </div>
    );
  }

  // Signup mode
  if (mode === "signup") {
    return (
      <div className="flex justify-center min-h-full px-6 py-14 box-border" style={{ backgroundColor: "var(--color-paper)" }}>
        <div className="flex flex-col gap-6 w-full max-w-xl">
          {/* Progress bar */}
          <div
            role="progressbar"
            aria-valuenow="3"
            aria-valuemin="1"
            aria-valuemax="5"
            className="flex gap-1.5"
            style={{ height: "3px" }}
          >
            <div className="flex-1 rounded-full" style={{ backgroundColor: "var(--color-brand)" }}></div>
            <div className="flex-1 rounded-full" style={{ backgroundColor: "var(--color-brand)" }}></div>
            <div className="flex-1 rounded-full" style={{ backgroundColor: "var(--color-brand)" }}></div>
            <div className="flex-1 rounded-full" style={{ backgroundColor: "var(--color-structure-150)" }}></div>
            <div className="flex-1 rounded-full" style={{ backgroundColor: "var(--color-structure-150)" }}></div>
          </div>

          {/* Headline */}
          <h1 className="m-0 text-page-title font-medium -tracking-[0.015em] text-ink">
            What do you sell?
          </h1>
          <p className="m-0 text-body text-ink-2 leading-relaxed">
            This decides what we set up for you. You can change any of it later, and most people do.
          </p>

          {/* Service Type Selection */}
          <section className="flex flex-col gap-2.5" role="radiogroup" aria-label="What do you sell?">
            {["individual", "group", "both"].map((type) => {
              const labels = {
                individual: "Time with a person",
                group: "Classes and groups",
                both: "Both",
              };
              const details = {
                individual: "Coaching, therapy, training, tutoring, consulting. Booked by the hour or the session.",
                group: "Several people at once, with places to fill.",
                both: "Some one-to-one, some groups.",
              };
              return (
                <button
                  key={type}
                  type="button"
                  role="radio"
                  aria-checked={serviceType === type}
                  aria-label={labels[type]}
                  onClick={() => setServiceType(type)}
                  data-testid={`signup-service-${type}`}
                  className="flex gap-3.25 p-3.75 border rounded-lg text-left font-inherit cursor-pointer transition-all"
                  style={{
                    borderWidth: "2px",
                    borderColor: serviceType === type ? "var(--color-brand)" : "var(--color-edge-secondary)",
                    backgroundColor: serviceType === type ? SELECTED_TINT : "var(--color-surface)",
                  }}
                >
                  <span
                    className="flex-shrink-0 mt-0.5 rounded-full flex-none border-2"
                    style={{
                      width: "18px",
                      height: "18px",
                      borderColor: serviceType === type ? "var(--color-brand)" : "var(--color-toggle-off)",
                      backgroundColor: serviceType === type ? "var(--color-brand)" : "transparent",
                    }}
                  ></span>
                  <span className="flex flex-col gap-1">
                    <span className="text-ui font-medium text-ink">
                      {labels[type]}
                    </span>
                    <span className="text-meta text-mute leading-[1.55]">
                      {details[type]}
                    </span>
                  </span>
                </button>
              );
            })}
          </section>

          {/* Team Size Selection */}
          <section className="flex flex-col gap-2">
            <label className="flex flex-col gap-2 font-inherit">
              <span className="text-ui font-semibold text-ink">
                How many of you{" "}
                <span className="text-caption font-normal text-mute">optional</span>
              </span>
              <select
                value={teamSizeSignup ?? ""}
                onChange={(e) => setTeamSizeSignup(e.target.value || null)}
                data-testid="signup-team-size"
                className="flex-1 px-3 py-2.5 border rounded-control font-inherit text-ui bg-surface text-ink cursor-pointer focus:outline-2 focus:outline-offset-2"
                style={{
                  borderColor: "var(--color-edge-secondary)",
                  outlineColor: "var(--color-brand)",
                }}
              >
                <option value="">Select team size</option>
                <option value="just_me">Just me</option>
                <option value="small">One place</option>
                <option value="large">Several locations</option>
              </select>
              <div className="text-meta text-mute">
                Add people and locations later — nothing here is locked.
              </div>
            </label>
          </section>

          {/* Error message */}
          {error && (
            <Alert variant="destructive">
              <AlertDescription role="alert" data-testid="signup-questions-error">
                {error}
              </AlertDescription>
            </Alert>
          )}

          {/* Submit button */}
          <Button
            type="button"
            onClick={handleSubmitSignup}
            disabled={!signupCanSubmit}
            className="w-full border-brand bg-brand text-surface hover:bg-brand/90"
            data-testid="signup-questions-submit-signup"
          >
            {submitting ? "Loading…" : "Continue"}
          </Button>
        </div>
      </div>
    );
  }

  // Post-sign-in mode
  return (
    <div className="flex justify-center min-h-full px-6 py-14 box-border" style={{ backgroundColor: "var(--color-paper)" }}>
      <div className="flex flex-col gap-6 w-full max-w-xl">
        <span className="text-caption text-mute">
          4 quick questions · you can change everything later
        </span>

        {loadError && (
          <Alert variant="destructive">
            <AlertDescription role="alert" data-testid="signup-questions-load-error">
              {loadError}
            </AlertDescription>
          </Alert>
        )}

        {/* Shape section */}
        <section className="flex flex-col gap-2.5">
          <h2 className="m-0 text-ui font-semibold text-ink">
            What do you need Workbench for?
          </h2>
          <div className="flex flex-col gap-2.5">
            {SHAPES.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setShape(opt.value)}
                data-testid={`signup-shape-${opt.value}`}
                aria-pressed={shape === opt.value}
                className="flex flex-col gap-1 items-start text-left p-3.5 border rounded-lg font-inherit cursor-pointer"
                style={{
                  borderWidth: "2px",
                  borderColor: shape === opt.value ? "var(--color-brand)" : "var(--color-edge-secondary)",
                  backgroundColor: shape === opt.value ? SELECTED_TINT : "var(--color-surface)",
                }}
              >
                <span className="text-ui font-semibold text-ink">
                  {opt.label}
                </span>
                <span className="text-caption text-mute">
                  {opt.detail}
                </span>
              </button>
            ))}
          </div>
        </section>

        {/* Coaching type section */}
        <section className="flex flex-col gap-2.5">
          <h2 className="m-0 text-ui font-semibold text-ink">
            What kind of business?
          </h2>
          <div className="flex flex-wrap gap-2">
            {COACHING_TYPES.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setCoachingType(opt.value)}
                data-testid={`signup-questions-coaching-${opt.value}`}
                aria-pressed={coachingType === opt.value}
                className="px-4 py-2.5 rounded-pill text-ui font-inherit cursor-pointer border transition-all"
                style={{
                  backgroundColor: coachingType === opt.value ? "var(--color-brand)" : "var(--color-surface)",
                  borderColor: coachingType === opt.value ? "var(--color-brand)" : "var(--color-edge-secondary)",
                  color: coachingType === opt.value ? "var(--color-surface)" : "var(--color-ink)",
                  fontWeight: coachingType === opt.value ? "600" : "400",
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </section>

        {/* Team size section */}
        <section className="flex flex-col gap-2.5">
          <h2 className="m-0 text-ui font-semibold text-ink">
            Just you, or a team?
          </h2>
          <div className="flex flex-wrap gap-2">
            {TEAM_SIZES.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setTeamSize(opt.value)}
                data-testid={`signup-questions-team-${opt.value}`}
                aria-pressed={teamSize === opt.value}
                className="px-4 py-2.5 rounded-pill text-ui font-inherit cursor-pointer border transition-all"
                style={{
                  backgroundColor: teamSize === opt.value ? "var(--color-brand)" : "var(--color-surface)",
                  borderColor: teamSize === opt.value ? "var(--color-brand)" : "var(--color-edge-secondary)",
                  color: teamSize === opt.value ? "var(--color-surface)" : "var(--color-ink)",
                  fontWeight: teamSize === opt.value ? "600" : "400",
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </section>

        {/* Moving from section */}
        <section className="flex flex-col gap-2.5">
          <h2 className="m-0 text-ui font-semibold text-ink">
            Moving from another system?
          </h2>
          <div className="flex flex-wrap gap-2">
            {MOVING_FROM.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setMovingFrom(opt.value)}
                data-testid={`signup-questions-moving-${opt.value}`}
                aria-pressed={movingFrom === opt.value}
                className="px-4 py-2.5 rounded-pill text-ui font-inherit cursor-pointer border transition-all"
                style={{
                  backgroundColor: movingFrom === opt.value ? "var(--color-brand)" : "var(--color-surface)",
                  borderColor: movingFrom === opt.value ? "var(--color-brand)" : "var(--color-edge-secondary)",
                  color: movingFrom === opt.value ? "var(--color-surface)" : "var(--color-ink)",
                  fontWeight: movingFrom === opt.value ? "600" : "400",
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </section>

        {/* Summary */}
        <div
          className="p-4 border rounded-lg bg-surface text-ui leading-relaxed text-ink"
          data-testid="signup-questions-summary"
          style={{
            borderColor: "var(--color-structure-200)",
          }}
        >
          <strong>We'll set up:</strong>{" "}
          {coachingType ? (
            <>
              {STARTER_SERVICE_PREVIEW[coachingType][0]}, {STARTER_SERVICE_PREVIEW[coachingType][1]} and a free intake call (you set prices)
            </>
          ) : (
            <>
              three starter services for your business once you pick one above (you set prices)
            </>
          )}
          {" · "}coaching agreement and parent consent templates{" · "}
          {movingFrom && movingFrom !== "no" ? (
            <>
              an import step for your {movingFromLabel} clients
            </>
          ) : (
            <>
              an import step whenever you need one
            </>
          )}
          {" · "}invite your coaches.
        </div>

        {/* Sample clients checkbox */}
        <label className="flex gap-2.5 items-center text-ui text-ink font-inherit cursor-pointer">
          <input
            type="checkbox"
            checked={sampleClientsRequested}
            onChange={(e) => setSampleClientsRequested(e.target.checked)}
            data-testid="signup-questions-samples"
            className="w-4.5 h-4.5 cursor-pointer"
            style={{
              accentColor: "var(--color-brand)",
            }}
          />
          Add sample clients so I can explore first (remove them in one click)
        </label>

        {/* Error message */}
        {error && (
          <Alert variant="destructive">
            <AlertDescription role="alert" data-testid="signup-questions-error">
              {error}
            </AlertDescription>
          </Alert>
        )}

        {/* Submit button */}
        <Button
          type="button"
          onClick={handleSubmit}
          disabled={!canSubmit}
          data-testid="signup-questions-submit"
          className="border-brand bg-brand text-surface hover:bg-brand/90"
        >
          {submitting ? "Setting up your practice…" : "Take me to my practice"}
        </Button>
      </div>
    </div>
  );
}
