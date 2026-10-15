// ═══════════════════════════════════════════════════════════════════════════════════════════════
// PlatformScreen — ported from webui/src/lib/screens/platform/PlatformScreen.svelte (105 lines).
// Props: app, path (the current route), onNavigate.
// This is a router component that handles all `/platform/*` paths, routing to the appropriate screen
// based on the path. Each mounted screen fetches its own data.
// Archetype: none (part — composes kit components).
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useMemo } from "react";
import ScreenState from "@/lib/empty/ScreenState.jsx";
import PlatOverview from "./PlatOverview.jsx";
import PlatPractices from "./PlatPractices.jsx";
import PlatPracticeRecord from "./PlatPracticeRecord.jsx";
import PlatGrantAccess from "./PlatGrantAccess.jsx";
import PlatViewingAs from "./PlatViewingAs.jsx";
import ProvisioningScreen from "../ProvisioningScreen.jsx";
import PlatUsage from "./PlatUsage.jsx";
import PlatAutomations from "./PlatAutomations.jsx";
import PlatBranding from "./PlatBranding.jsx";
import PlatFlags from "../PlatFlags.jsx";
import PlatHealth from "../PlatHealth.jsx";
import PlatJobs from "./PlatJobs.jsx";
import PlatTiers from "./PlatTiers.jsx";

/**
 * Match the path against known patterns and determine which component to mount.
 */
function getComponent(path) {
  if (path === "/platform" || path === "/platform/overview") {
    return { component: PlatOverview, name: "PlatOverview" };
  }
  if (path === "/platform/tenants") {
    return { component: PlatPractices, name: "PlatPractices" };
  }
  if (path === "/platform/usage") {
    return { component: PlatUsage, name: "PlatUsage" };
  }
  if (path === "/platform/automations") {
    return { component: PlatAutomations, name: "PlatAutomations" };
  }
  if (path === "/platform/branding") {
    return { component: PlatBranding, name: "PlatBranding" };
  }
  if (path === "/platform/flags") {
    return { component: PlatFlags, name: "PlatFlags" };
  }
  if (path === "/platform/jobs") {
    return { component: PlatJobs, name: "PlatJobs" };
  }
  if (path === "/platform/health") {
    return { component: PlatHealth, name: "PlatHealth" };
  }
  if (path === "/platform/tiers") {
    return { component: PlatTiers, name: "PlatTiers" };
  }
  if (path === "/platform/provisioning") {
    return { component: ProvisioningScreen, name: "ProvisioningScreen" };
  }
  // Check for dynamic routes: /platform/tenants/<uuid> and /platform/tenants/<uuid>/look
  const practiceMatch = path.match(/^\/platform\/tenants\/([a-f0-9\-]+)$/);
  if (practiceMatch) {
    return { component: PlatPracticeRecord, tenantId: practiceMatch[1], name: "PlatPracticeRecord" };
  }
  const lookMatch = path.match(/^\/platform\/tenants\/([a-f0-9\-]+)\/look$/);
  if (lookMatch) {
    return { component: PlatViewingAs, tenantId: lookMatch[1], name: "PlatViewingAs" };
  }
  return null;
}

export default function PlatformScreen({ app, path, onNavigate }) {
  const screen = useMemo(() => getComponent(path), [path]);

  // Error case: no screen found for this path
  if (!screen) {
    return <ScreenState phase="error" error={new Error("There is no platform screen here.")} />;
  }

  const Comp = screen.component;
  const { name, tenantId } = screen;

  // Mount the appropriate component with its required props
  if (name === "PlatOverview") {
    return <Comp app={app} onNavigate={onNavigate} />;
  }
  if (name === "PlatPractices") {
    return <Comp app={app} onNavigate={onNavigate} />;
  }
  if (name === "PlatPracticeRecord") {
    return <Comp app={app} tenantId={tenantId} onNavigate={onNavigate} />;
  }
  if (name === "PlatViewingAs") {
    return <Comp app={app} tenantId={tenantId} onNavigate={onNavigate} />;
  }
  if (name === "ProvisioningScreen") {
    return <Comp app={app} onNavigate={onNavigate} />;
  }
  if (name === "PlatUsage") {
    return <Comp app={app} onNavigate={onNavigate} />;
  }
  if (name === "PlatAutomations") {
    return <Comp app={app} onNavigate={onNavigate} />;
  }
  if (name === "PlatBranding") {
    return <Comp app={app} onNavigate={onNavigate} />;
  }
  if (name === "PlatFlags") {
    return <Comp app={app} />;
  }
  if (name === "PlatJobs") {
    return <Comp app={app} onNavigate={onNavigate} />;
  }
  if (name === "PlatHealth") {
    return <Comp app={app} />;
  }
  if (name === "PlatTiers") {
    return <Comp app={app} onNavigate={onNavigate} />;
  }

  // Error case: screen name not recognized (should not reach here, but guard against it)
  return <ScreenState phase="error" error={new Error("Unknown platform screen")} />;
}
