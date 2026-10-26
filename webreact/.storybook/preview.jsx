// Every story renders inside the real theme and a real AppState (fixture-filled), as the app does.
//   parameters.app = { as: "owner" | "admin" | "member" | null, ...AppState fields }  (default owner)
import "../src/styles/theme.css";
import { MemoryRouter } from "react-router";
import { AppStateContext } from "../src/lib/app/useAppState.js";
import { appFixture } from "../src/lib/app/fixtures/appFixture.js";
import { Toaster } from "../src/lib/components/ui/sonner.jsx";
import { TooltipProvider } from "../src/lib/components/ui/tooltip.jsx";

export default {
  parameters: {
    layout: "fullscreen",
    viewport: { options: {
      desktop: { name: "1440", styles: { width: "1440px", height: "1000px" } },
      laptop: { name: "1280", styles: { width: "1280px", height: "900px" } },
      phone: { name: "375", styles: { width: "375px", height: "812px" } },
    } },
  },
  decorators: [
    (Story, ctx) => {
      const app = appFixture(ctx.parameters.app ?? {});
      return (
        <AppStateContext.Provider value={app}>
          <TooltipProvider>
            <MemoryRouter initialEntries={[ctx.parameters.path ?? "/home"]}>
              <Story />
            </MemoryRouter>
            <Toaster />
          </TooltipProvider>
        </AppStateContext.Provider>
      );
    },
  ],
};
