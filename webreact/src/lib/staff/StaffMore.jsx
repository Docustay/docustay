// ═══════════════════════════════════════════════════════════════════════════════════════════════
// 18.23 — MORE (Staff menu)
// Ported from webui/src/lib/staff/StaffMore.svelte
//
// ★★★ THE STAFF APP'S "MORE" MENU. Shows:
//     · "Open the full CRM" (→ /home)
//     · "Sign-in and devices" (→ /settings/sign-in)
//     · "Push notifications" toggle
//     · "Sign out" (logout)
// ═══════════════════════════════════════════════════════════════════════════════════════════════

import PushToggle from "@/lib/phone/PushToggle.jsx";

const menuRowClasses =
  "flex items-center p-4 border-0 bg-transparent cursor-pointer text-left border-b border-line hover:bg-[var(--color-structure-75)] active:bg-[var(--color-structure-75)] min-h-12 last:border-b-0";

const menuPushToggleClasses =
  "px-4 py-3 border-0 bg-transparent border-b border-line hover:bg-[var(--color-structure-75)] active:bg-[var(--color-structure-75)] last:border-b-0 pointer-events-auto";

export default function StaffMore({ app, onNavigate }) {
  return (
    <div className="flex flex-col gap-0">
      {/* Open the full CRM */}
      <button className={menuRowClasses} onClick={() => onNavigate("/home")}>
        <div className="text-base font-medium text-inherit">Open the full CRM</div>
      </button>

      {/* Sign-in and devices */}
      <button className={menuRowClasses} onClick={() => onNavigate("/settings/sign-in")}>
        <div className="text-base font-medium text-inherit">Sign-in and devices</div>
      </button>

      {/* Push notifications */}
      <div className={menuPushToggleClasses}>
        <PushToggle app={app} />
      </div>

      {/* Sign out */}
      <button
        className={`${menuRowClasses} text-bad hover:bg-bad-soft active:bg-bad-soft`}
        onClick={() => app.signOut()}
      >
        <div className="text-base font-medium text-inherit">Sign out</div>
      </button>
    </div>
  );
}
