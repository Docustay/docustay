import { Button } from "@/lib/components/ui/button.jsx";
import StatusBadge from "@/lib/components/kit/StatusBadge.jsx";

export default function DeviceRow({ device = {}, onDeactivate = null }) {
  function getStatusBadge() {
    if (device.deactivated_at) {
      return { label: "Deactivated", tone: "neutral" };
    }
    if (device.state === "active") {
      return { label: "Active", tone: "ok" };
    }
    return { label: device.state || "Unknown", tone: "neutral" };
  }

  function getDeviceIcon() {
    if (device.model && device.model.includes("M2")) {
      return "📱";
    }
    if (device.model && device.model.includes("WisePOS")) {
      return "🖥️";
    }
    if (device.model && device.model.includes("S700")) {
      return "💳";
    }
    return "📄";
  }

  const status = getStatusBadge();

  return (
    <div
      className="flex items-center gap-3 rounded-lg border border-line bg-surface px-4 py-3"
      data-testid="money-device-row"
    >
      <div className="flex h-8 w-8 shrink-0 items-center justify-center text-2xl">
        {getDeviceIcon()}
      </div>

      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-ink">
          {device.name || "Unnamed Device"}
        </div>
        {device.model && (
          <div className="mt-1 text-xs text-mute">
            {device.model}
          </div>
        )}
        {device.serial && (
          <div className="mt-0.5 text-xs text-mute">
            Serial: {device.serial}
          </div>
        )}
      </div>

      <div className="shrink-0">
        <StatusBadge
          label={status.label}
          tone={status.tone}
          testId="device-status-badge"
        />
      </div>

      {!device.deactivated_at && (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => onDeactivate?.()}
        >
          Deactivate
        </Button>
      )}
    </div>
  );
}
