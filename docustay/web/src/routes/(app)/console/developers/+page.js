import { redirect } from "@sveltejs/kit";
// Launch step 7: the Developers console is the Developers area of Settings (same section names; its overview is "dev")
export const load = ({ url }) => { const tab = url.searchParams.get("tab"); throw redirect(307, `/settings?tab=${!tab || tab === "overview" ? "dev" : tab === "developer" ? "keys" : encodeURIComponent(tab)}`); };
