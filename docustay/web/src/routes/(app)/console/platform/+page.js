import { redirect } from "@sveltejs/kit";
// Launch step 7: the Workspace screen is the Workspace area of Settings (same section names: team, security, domains, branding, connections, data, audit)
export const load = ({ url }) => { const tab = url.searchParams.get("tab"); throw redirect(307, `/settings?tab=${!tab || tab === "overview" ? "team" : encodeURIComponent(tab)}`); };
