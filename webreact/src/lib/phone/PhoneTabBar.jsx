// PhoneTabBar — a tab navigation bar for phone-optimized screens
// Ported from webui/src/lib/phone/PhoneTabBar.svelte

export default function PhoneTabBar({ tabs, active, onNavigate }) {
  return (
    <div className="flex border-t border-hair pt-[8px] pl-[6px] pr-[6px] pb-[calc(24px+env(safe-area-inset-bottom))] bg-surface flex-shrink-0">
      {tabs.map((tab) => (
        <a
          key={tab.key}
          data-testid={`nav-${tab.key}`}
          href={tab.href}
          className={`flex-1 text-center text-[10px] no-underline flex flex-col items-center justify-center p-0 gap-0 ${
            active === tab.key ? "text-brand font-semibold" : "text-mute"
          }`}
          aria-current={active === tab.key ? "page" : undefined}
          onClick={(e) => {
            e.preventDefault();
            onNavigate?.(tab.key);
          }}
        >
          <tab.icon className="block mx-auto mb-[2px]" size={19} strokeWidth={1.75} aria-hidden="true" />
          {tab.label}
        </a>
      ))}
    </div>
  );
}
