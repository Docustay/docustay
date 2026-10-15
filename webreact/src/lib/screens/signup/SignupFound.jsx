import { Input } from "@/lib/components/ui/input.jsx";

export default function SignupFound({
  businessName,
  onBusinessNameChange,
  address,
  onAddressChange,
  phone,
  onPhoneChange,
  website,
  onWebsiteChange,
  hours,
  onHoursChange,
  reviews,
  onReviewsChange,
  earlyFinding,
  onEarlyFindingChange,
  onContinue,
}) {
  return (
    <div>
      {/* Headline */}
      <h1 className="text-4xl font-serif font-semibold mb-2 tracking-tight text-[var(--color-structure-900)]">
        Found you
      </h1>

      {/* Subheadline */}
      <p className="text-base text-[var(--color-structure-600)] mb-7 leading-relaxed">
        This all came from your Google listing. Change anything that's wrong — and if it's
        wrong here, it's wrong for everyone searching for you too.
      </p>

      {/* Found card */}
      <div className="mb-6 p-4 border border-[var(--color-border-card)] bg-[var(--color-structure-0)] rounded-[12px]">
        <div className="mb-4">
          <h2 className="font-semibold text-base text-[var(--color-structure-900)]">
            {businessName}
          </h2>
        </div>

        {/* Card fields: read-only display, editable inline */}
        <div className="space-y-3 text-sm">
          <div className="flex gap-3">
            <span className="w-24 flex-shrink-0 text-[var(--color-structure-600)]">Address</span>
            <span className="flex-1 text-[var(--color-structure-900)]">
              {address || "—"}
            </span>
          </div>
          <div className="flex gap-3">
            <span className="w-24 flex-shrink-0 text-[var(--color-structure-600)]">Phone</span>
            <span className="flex-1 text-[var(--color-structure-900)]">
              {phone || "—"}
            </span>
          </div>
          <div className="flex gap-3">
            <span className="w-24 flex-shrink-0 text-[var(--color-structure-600)]">Website</span>
            <span className="flex-1 text-[var(--color-structure-900)]">
              {website || "—"}
            </span>
          </div>
          <div className="flex gap-3">
            <span className="w-24 flex-shrink-0 text-[var(--color-structure-600)]">Hours</span>
            <span className="flex-1 text-[var(--color-structure-900)]">
              {hours || "—"}
            </span>
          </div>
          <div className="flex gap-3">
            <span className="w-24 flex-shrink-0 text-[var(--color-structure-600)]">Reviews</span>
            <span className="flex-1 text-[var(--color-structure-900)]">
              {reviews || "—"}
            </span>
          </div>
        </div>
      </div>

      {/* Early finding banner (notice) */}
      {earlyFinding && (
        <div className="mb-6 p-4 bg-[var(--color-warning-25)] border border-[var(--color-warning-border)] text-[var(--color-warning-800)] rounded-[10px]">
          <div className="font-semibold text-sm mb-1">
            {earlyFinding.title}
          </div>
          <div className="text-sm leading-relaxed">
            {earlyFinding.message}
          </div>
        </div>
      )}

      {/* Website field (optional) */}
      <div className="mb-8">
        <div className="flex flex-col gap-2">
          <label htmlFor="signup-website" className="text-sm font-medium text-[var(--color-structure-900)]">
            Your website
            <span className="text-xs text-[var(--color-structure-600)] font-normal"> optional</span>
          </label>
          <Input
            id="signup-website"
            type="text"
            placeholder="example.com"
            value={website}
            onChange={(e) => onWebsiteChange(e.target.value)}
            className="rounded-[10px]"
          />
          <p className="text-xs text-[var(--color-structure-600)]">
            We'll check how fast it loads and whether assistants can read it.
          </p>
        </div>
      </div>

      {/* Continue button */}
      <button
        onClick={onContinue}
        className="w-full px-4 py-2.75 rounded-lg font-medium text-white text-base bg-[var(--color-action-600)] hover:bg-[var(--color-action-700)] transition-colors"
      >
        Continue
      </button>
    </div>
  );
}
