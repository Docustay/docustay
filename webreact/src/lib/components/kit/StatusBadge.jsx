// StatusBadge — colour carries state only (kit2 .tag): ok · warn · bad · act · neutral. Ported from
// webui/src/lib/components/kit/StatusBadge.svelte.
import { Badge } from "@/lib/components/ui/badge.jsx";

const TONE = { ok: "bg-ok-soft text-ok", warn: "bg-warn-soft text-warn", bad: "bg-bad-soft text-bad", act: "bg-brand-soft text-brand", neutral: "bg-mute-bg text-mute" };

export default function StatusBadge({ label, tone = "neutral", testId = "status-badge" }) {
  return <Badge className={`h-(--size-chip) rounded-chip border-0 px-2.25 text-caption font-medium ${TONE[tone] ?? TONE.neutral}`} data-testid={testId} data-tone={tone}>{label}</Badge>;
}
