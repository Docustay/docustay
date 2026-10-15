import PhoneTabBar from "./PhoneTabBar.jsx";

// ★ the maintainer, 29 Sep 2026 (portal design critique) — "no header — no practice logo, no page title."
//   One shared header for every phone screen: the practice's own initial as a small round mark
//   (no logo-upload setting exists yet — see app.mjs's own note) plus the page's title, so the
//   fix lands once here instead of fifteen times in each screen.
function PhoneHeader({ title, practiceName, action }) {
  const initial = (practiceName ?? "?").trim().charAt(0).toUpperCase() || "?";
  return (
    <div className="flex items-center gap-2.5 px-[18px] pt-2 pb-2.5 flex-shrink-0" data-testid="phone-header">
      <span
        className="w-8 h-8 rounded-full bg-brand text-primary-foreground flex items-center justify-center text-sm font-semibold flex-shrink-0"
        aria-hidden="true"
      >
        {initial}
      </span>
      <div className="min-w-0 flex-1">
        <p className="m-0 text-[17px] font-medium leading-tight truncate" data-testid="phone-header-title">{title}</p>
        {practiceName && (
          <p className="m-0 text-[12.5px] text-mute leading-tight truncate" data-testid="phone-header-practice">{practiceName}</p>
        )}
      </div>
      {/* ★ the maintainer, 29 Sep 2026 — the frames put one circular action (Schedule's "+", Home's settings
          mark) in this same row, next to the title, rather than as a second header a screen draws
          itself. Optional so most screens (which have none) render exactly as before. */}
      {action && (
        <button
          type="button"
          className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 border-0 cursor-pointer"
          style={{ background: "var(--color-structure-150)", color: "var(--color-ink)" }}
          onClick={action.onClick}
          aria-label={action.label}
          data-testid="phone-header-action"
        >
          {action.icon}
        </button>
      )}
    </div>
  );
}

export default function PhoneShell({ tabs, active, onNavigate, title = null, practiceName = null, action = null, children }) {
  return (
    <div className="flex flex-col h-full bg-surface overflow-hidden">
      {title && <PhoneHeader title={title} practiceName={practiceName} action={action} />}
      <div className="flex-1 overflow-y-auto px-[18px] pt-[2px] pb-[22px]">
        {children}
      </div>
      <PhoneTabBar tabs={tabs} active={active} onNavigate={onNavigate} />
    </div>
  );
}
