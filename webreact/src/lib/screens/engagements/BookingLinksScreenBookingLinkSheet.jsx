import SideSheet from "@/lib/forms/SideSheet.jsx";

export default function BookingLinksScreenBookingLinkSheet({
  error = null,
  options = {},
  sheet = null,
  saving = false,
  sheetError = null,
  toggle = () => {},
  save = () => {},
  onCancel = () => {},
}) {
  if (!sheet) return null;

  const isPage = sheet.mode === "page";

  const title =
    sheet.mode === "page"
      ? "What your practice page shows"
      : sheet.mode === "new"
        ? "New booking link"
        : "Edit booking link";

  const subtitle =
    sheet.mode === "page"
      ? "For someone who finds your practice without a link."
      : null;

  const handleNameChange = (e) => {
    const newValue = e.target.value;
    toggle("name", newValue);
  };

  const handleSlugChange = (e) => {
    const newValue = e.target.value;
    toggle("slug", newValue);
  };

  return (
    <SideSheet
      title={title}
      subtitle={subtitle}
      onCancel={onCancel}
      onSave={save}
      busy={saving}
      error={sheetError}
      testId="booking-link-sheet"
    >
      {!isPage && (
        <>
          <div className="flex gap-5 p-3 border-b border-hair">
            <label htmlFor="bl-name" className="w-30 flex-shrink-0 text-sm font-medium text-ink pt-2">
              Name
            </label>
            <div className="flex-1 min-w-0">
              <input
                id="bl-name"
                type="text"
                className="w-full h-[38px] px-3 border border-line rounded-sm font: inherit text-sm bg-surface text-ink"
                value={sheet.draft.name}
                onChange={handleNameChange}
                required
                maxLength="120"
                data-testid="booking-link-name"
              />
              <div className="text-xs text-mute mt-1.5">
                Only you see this. The page shows your practice name.
              </div>
            </div>
          </div>

          <div className="flex gap-5 p-3 border-b border-hair">
            <label htmlFor="bl-slug" className="w-30 flex-shrink-0 text-sm font-medium text-ink pt-2">
              Link
            </label>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-mute text-sm whitespace-nowrap">
                  /book/l/
                </span>
                <input
                  id="bl-slug"
                  type="text"
                  className="flex-1 h-[38px] px-3 border border-line rounded-sm font: inherit text-sm bg-surface text-ink"
                  value={sheet.draft.slug}
                  onChange={handleSlugChange}
                  required
                  data-testid="booking-link-slug"
                />
              </div>
              <div className="text-xs text-mute mt-1.5">
                Lowercase letters, numbers and single hyphens.
              </div>
            </div>
          </div>
        </>
      )}

      <div className="flex gap-5 p-3 border-b border-hair">
        <span className="w-30 flex-shrink-0 text-sm font-medium text-ink pt-2">
          Categories
        </span>
        <div className="flex-1 min-w-0">
          {options.categories && options.categories.length > 0 ? (
            <>
              {options.categories.map((c) => (
                <label
                  key={c.id}
                  className="flex items-center gap-2.5 min-h-9 text-sm text-ink"
                >
                  <input
                    type="checkbox"
                    checked={sheet.draft.categoryIds.includes(c.id)}
                    onChange={() => toggle("categoryIds", c.id)}
                  />
                  <span>{c.name}</span>
                  <span className="ml-auto text-xs text-mute">
                    {c.serviceCount} {c.serviceCount === 1 ? "service" : "services"}
                  </span>
                </label>
              ))}
            </>
          ) : (
            <div className="text-xs text-mute">
              No service categories yet — make them in Items › Categories.
            </div>
          )}
          <div className="text-xs text-mute mt-1.5">
            Leave all unticked to offer every public service.
          </div>
        </div>
      </div>

      {!isPage && (
        <>
          <div className="flex gap-5 p-3 border-b border-hair">
            <span className="w-30 flex-shrink-0 text-sm font-medium text-ink pt-2">
              Staff
            </span>
            <div className="flex-1 min-w-0">
              {options.staff && options.staff.length > 0 ? (
                <>
                  {options.staff.map((p) => (
                    <label
                      key={p.id}
                      className="flex items-center gap-2.5 min-h-9 text-sm text-ink"
                    >
                      <input
                        type="checkbox"
                        checked={sheet.draft.staffIds.includes(p.id)}
                        onChange={() => toggle("staffIds", p.id)}
                      />
                      <span>{p.displayName}</span>
                    </label>
                  ))}
                </>
              ) : null}
              <div className="text-xs text-mute mt-1.5">
                Leave all unticked to offer everyone who takes bookings.
              </div>
            </div>
          </div>

          <div className="flex gap-5 p-3 border-b border-hair">
            <span className="w-30 flex-shrink-0 text-sm font-medium text-ink pt-2">
              Where
            </span>
            <div className="flex-1 min-w-0">
              {options.locations && options.locations.length > 0 ? (
                <>
                  {options.locations.map((l) => (
                    <label
                      key={l.id}
                      className="flex items-center gap-2.5 min-h-9 text-sm text-ink"
                    >
                      <input
                        type="checkbox"
                        checked={sheet.draft.locationIds.includes(l.id)}
                        onChange={() => toggle("locationIds", l.id)}
                      />
                      <span>{l.name}</span>
                    </label>
                  ))}
                </>
              ) : null}
              <div className="text-xs text-mute mt-1.5">
                Leave all unticked for every location, and for virtual sessions.
              </div>
            </div>
          </div>

          <div className="flex gap-5 p-3 border-b border-hair">
            <span className="w-30 flex-shrink-0 text-sm font-medium text-ink pt-2">
              Status
            </span>
            <div className="flex-1 min-w-0">
              <label className="flex items-center gap-2.5 min-h-9 text-sm text-ink">
                <input
                  type="checkbox"
                  checked={sheet.draft.active}
                  onChange={(e) => toggle("active", e.target.checked)}
                  data-testid="booking-link-active"
                />
                <span>Live</span>
                <span className="text-xs text-mute">
                  Switch it off and the link shows "This page isn't available".
                </span>
              </label>
            </div>
          </div>
        </>
      )}
    </SideSheet>
  );
}
