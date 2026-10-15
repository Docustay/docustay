// ═══════════════════════════════════════════════════════════════════════════════════════════════
// CatalogueTabs — the three-tab wrapper (W9.1): Services · Packages · Plans.
// Props: { path, params, app, onNavigate, onRefetch }
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import ServicesList from "@/lib/screens/items/ServicesList.jsx";
import PackagesList from "@/lib/screens/catalogue/PackagesList.jsx";
import PlansList from "@/lib/screens/catalogue/PlansList.jsx";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/lib/components/ui/tabs.jsx";

export default function CatalogueTabs({ path = "/items/services", params = null, app = null, onNavigate = null, onRefetch = null }) {
  // Derive the active tab from the path
  const tabMap = {
    "/items/services": "services",
    "/items/packages": "packages",
    "/items/plans": "plans",
  };
  const activeTab = tabMap[path] ?? "services";

  // Handle tab change by navigating to the new path
  function handleTabChange(tab) {
    const pathMap = {
      services: "/items/services",
      packages: "/items/packages",
      plans: "/items/plans",
    };
    const newPath = pathMap[tab];
    if (newPath && onNavigate) {
      onNavigate(newPath);
    } else if (newPath) {
      window.location.assign(newPath);
    }
  }

  return (
    <div className="flex flex-col w-full h-full">
      <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
        <TabsList variant="line" className="border-b border-line">
          <TabsTrigger value="services" data-testid="catalogue-tab-services">
            Services
          </TabsTrigger>
          <TabsTrigger value="packages" data-testid="catalogue-tab-packages">
            Packages
          </TabsTrigger>
          <TabsTrigger value="plans" data-testid="catalogue-tab-plans">
            Plans
          </TabsTrigger>
        </TabsList>

        <TabsContent value="services" className="flex-1">
          <ServicesList path={path} params={params} app={app} onNavigate={onNavigate} onRefetch={onRefetch} />
        </TabsContent>

        <TabsContent value="packages" className="flex-1">
          <PackagesList path={path} params={params} app={app} onNavigate={onNavigate} onRefetch={onRefetch} />
        </TabsContent>

        <TabsContent value="plans" className="flex-1">
          <PlansList path={path} params={params} app={app} onNavigate={onNavigate} onRefetch={onRefetch} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
