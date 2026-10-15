import { useState } from "react";
import { Button } from "@/lib/components/ui/button.jsx";
import { Input } from "@/lib/components/ui/input.jsx";
import { Label } from "@/lib/components/ui/label.jsx";

const MOVING_FROM_OPTIONS = [
  { value: "mindbody", label: "Mindbody", detail: "Clients, sessions, packages and payment history. No mapping needed." },
  { value: "vagaro", label: "Vagaro, Boulevard, Practice Better or SimplePractice", detail: "Same — we know their exports." },
  { value: "acuity", label: "Acuity, Calendly or Square", detail: "Bookings and clients come over. Money stays where it is." },
  { value: "spreadsheet", label: "A spreadsheet, or nothing", detail: "Perfectly normal. Plenty of people start here." },
];

export default function SignupExistingVerify({
  step = 4,
  onStepChange = null,
  account = { orgName: "", slug: "", email: "", password: "", confirmPassword: "", policyAccepted: false },
  onAccountChange = null,
  submitting = false,
  onCreateWorkspace = null,
}) {
  const [movingFrom, setMovingFrom] = useState(null);

  function onContinueStep4() {
    if (movingFrom !== null) {
      onStepChange?.(5, movingFrom);
    }
  }

  const setField = (key) => (e) => onAccountChange?.((a) => ({ ...a, [key]: e.target.value }));
  const setPolicyAccepted = (e) => onAccountChange?.((a) => ({ ...a, policyAccepted: e.target.checked }));

  if (step === 4) {
    return (
      <div className="flex flex-col gap-[26px]">
        {/* Progress bar */}
        <div className="flex gap-[6px] h-[3px]">
          <div className="w-[80%] h-[3px] bg-[var(--color-action-600)] rounded-full transition-all duration-300"></div>
          <div className="flex-1 h-[3px] bg-[var(--color-structure-150)] rounded-full"></div>
        </div>

        {/* Headline and lede */}
        <div>
          <h1 className="m-0 text-[30px] font-medium font-fraunces leading-tight text-[var(--ink)] tracking-[-0.015em]">
            What are you using now?
          </h1>
          <p className="m-0 mt-4 text-[15.5px] text-[var(--ink-muted)] leading-[1.65]">
            If it's one of these, we already know what its export looks like and can bring everything over
            without you matching up a single column. We'll do it for you if you'd rather.
          </p>
        </div>

        {/* Options */}
        <div className="flex flex-col gap-[10px]">
          {MOVING_FROM_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              className={`flex gap-[13px] p-[15px] border rounded-[12px] text-left cursor-pointer transition-all duration-150 border-[var(--color-edge-secondary)] bg-[var(--surface)] hover:border-[var(--color-edge-hover)] ${
                movingFrom === opt.value
                  ? "border-[var(--color-action-600)] bg-[var(--color-action-50)]"
                  : ""
              }`}
              data-testid={`signup-moving-from-${opt.value}`}
              onClick={() => setMovingFrom(opt.value)}
            >
              <span
                className={`flex-shrink-0 w-[18px] h-[18px] rounded-full border mt-[2px] transition-all ${
                  movingFrom === opt.value
                    ? "border-[5px] border-[var(--color-action-600)]"
                    : "border-[1.5px] border-[var(--color-edge-secondary)]"
                }`}
              />
              <span className="flex flex-col gap-1">
                <span className={`text-[14.5px] font-medium text-[var(--ink)] ${
                  movingFrom === opt.value ? "text-[var(--color-action-600)]" : ""
                }`}>
                  {opt.label}
                </span>
                <span className="text-[13px] text-[var(--ink-muted)] leading-[1.55]">
                  {opt.detail}
                </span>
              </span>
            </button>
          ))}
        </div>

        {/* Continue button */}
        <Button
          type="button"
          onClick={onContinueStep4}
          disabled={movingFrom === null}
          data-testid="signup-continue-to-verify"
        >
          Continue
        </Button>
      </div>
    );
  }

  if (step === 5) {
    const canSubmit =
      account.orgName.trim() !== "" &&
      account.slug.trim() !== "" &&
      account.email.trim() !== "" &&
      account.password.length >= 6 &&
      account.password === account.confirmPassword &&
      account.policyAccepted &&
      !submitting;

    return (
      <div className="flex flex-col gap-[26px]">
        {/* Progress bar */}
        <div className="flex gap-[6px] h-[3px]">
          <div className="w-full h-[3px] bg-[var(--color-action-600)] rounded-full transition-all duration-300"></div>
        </div>

        {/* Headline and lede */}
        <div>
          <h1 className="m-0 text-[30px] font-medium font-fraunces leading-tight text-[var(--ink)] tracking-[-0.015em]">
            Set up your account
          </h1>
          <p className="m-0 mt-4 text-[15.5px] text-[var(--ink-muted)] leading-[1.65]">
            This is what your clients will see, and how you'll sign in.
          </p>
        </div>

        <div className="flex flex-col gap-[16px]">
          <div>
            <Label htmlFor="signup-org-name" className="mb-1.5 block">Organisation name</Label>
            <Input
              id="signup-org-name"
              data-testid="signup-org-name"
              value={account.orgName}
              onChange={setField("orgName")}
              autoComplete="organization"
              required
            />
          </div>

          <div>
            <Label htmlFor="signup-slug" className="mb-1.5 block">Workspace address</Label>
            <div className="flex items-center gap-1.5">
              <Input
                id="signup-slug"
                data-testid="signup-slug"
                value={account.slug}
                onChange={(e) => onAccountChange?.((a) => ({ ...a, slug: e.target.value.toLowerCase() }))}
                required
              />
              <span className="text-[13px] text-[var(--ink-muted)] whitespace-nowrap">.example.com</span>
            </div>
          </div>

          <div>
            <Label htmlFor="signup-email" className="mb-1.5 block">Email</Label>
            <Input
              id="signup-email"
              data-testid="signup-email"
              type="email"
              value={account.email}
              onChange={setField("email")}
              autoComplete="email"
              required
            />
          </div>

          <div>
            <Label htmlFor="signup-password" className="mb-1.5 block">Password</Label>
            <Input
              id="signup-password"
              data-testid="signup-password"
              type="password"
              value={account.password}
              onChange={setField("password")}
              autoComplete="new-password"
              required
            />
          </div>

          <div>
            <Label htmlFor="signup-confirm-password" className="mb-1.5 block">Confirm password</Label>
            <Input
              id="signup-confirm-password"
              data-testid="signup-confirm-password"
              type="password"
              value={account.confirmPassword}
              onChange={setField("confirmPassword")}
              autoComplete="new-password"
              required
            />
          </div>
        </div>

        {/* Required policy-acceptance checkbox — the links open the actual documents. */}
        <label className="flex items-start gap-2.5 text-[13.5px] text-[var(--ink-muted)] leading-[1.5] cursor-pointer">
          <input
            type="checkbox"
            data-testid="signup-policy-accepted"
            checked={account.policyAccepted}
            onChange={setPolicyAccepted}
            className="mt-[2px] h-[16px] w-[16px] flex-shrink-0 accent-[var(--color-action-600)]"
            required
          />
          <span>
            I agree to the{" "}
            <a href="https://app.example.com/legal/terms" target="_blank" rel="noopener noreferrer" className="underline text-[var(--color-action-600)]">Terms of Service</a>,{" "}
            <a href="https://app.example.com/legal/privacy" target="_blank" rel="noopener noreferrer" className="underline text-[var(--color-action-600)]">Privacy Policy</a>, and{" "}
            <a href="https://app.example.com/legal/dpa" target="_blank" rel="noopener noreferrer" className="underline text-[var(--color-action-600)]">Data Processing Addendum</a>.
          </span>
        </label>

        {/* Submit button */}
        <Button
          type="button"
          onClick={onCreateWorkspace}
          disabled={!canSubmit}
          data-testid="signup-create-workspace"
        >
          {submitting ? "Creating…" : "Create workspace"}
        </Button>
      </div>
    );
  }

  return null;
}
