// Empty-state icon names → lucide-react components. Ported from webui/src/lib/empty/icons.js: same 38 names,
// same lucide glyphs, same rule — a missing name returns null and the empty state still renders.
import {
  Users, UserRoundCheck, UserPlus, User, ShieldCheck, Shield, Building2, Search, Megaphone, ChartArea, MapPin,
  Activity, KeyRound, FileChartColumn, Share2, Calendar, CalendarPlus, Clock, Settings, Tag, Package, Repeat,
  FileText, FileBadge, LayoutTemplate, TextCursorInput, FileCheck, CreditCard, List, SquareCheck, ChartColumn,
  Database, Webhook, Code, Server, Wrench,
} from "lucide-react";

const ICONS = Object.freeze({
  IconUsers: Users, IconUsersGroup: Users, IconUserHeart: UserRoundCheck, IconUserPlus: UserPlus, IconUser: User,
  IconShieldLock: ShieldCheck, IconShield: Shield, IconBuilding: Building2, IconSearch: Search,
  IconSpeakerphone: Megaphone, IconChartArea: ChartArea, IconMapPin: MapPin, IconActivity: Activity, IconKey: KeyRound,
  IconFileAnalytics: FileChartColumn, IconAffiliate: Share2, IconCalendar: Calendar, IconCalendarPlus: CalendarPlus,
  IconClock: Clock, IconSettings: Settings, IconTag: Tag, IconPackage: Package, IconRepeat: Repeat,
  IconFileText: FileText, IconFileCertificate: FileBadge, IconTemplate: LayoutTemplate, IconForms: TextCursorInput,
  IconFileCheck: FileCheck, IconFileInvoice: FileText, IconCreditCard: CreditCard, IconList: List,
  IconCheckbox: SquareCheck, IconChartBar: ChartColumn, IconDatabase: Database, IconWebhook: Webhook, IconCode: Code,
  IconServer: Server, IconTool: Wrench,
});

export function iconFor(name) {
  if (!name) return null;
  const C = ICONS[name];
  if (!C) console.warn(`[empty-state] no icon named "${name}" — rendering without one.`);
  return C ?? null;
}

/** Which icon names in these list descriptors does this map not know? `[]` = all resolve. */
export function missingIcons(views) {
  const want = new Set(Object.values(views ?? {}).map((v) => v?.emptyState?.icon).filter(Boolean));
  return [...want].filter((n) => !ICONS[n]).sort();
}

/** Lucide stroke weight for every icon in the product. MOCKUPS.md §GLOBAL: "stroke 1.75". */
export const ICON_STROKE = 1.75;
