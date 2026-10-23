import legal from "$lib/legal.json";
import { error } from "@sveltejs/kit";
export const prerender = true;
const KEY = { terms: "terms", "privacy-policy": "privacy", cookies: "cookies", dpa: "dpa", notices: "notices", refunds: "refunds", renewal: "renewal" };
export const entries = () => Object.keys(KEY).map((doc) => ({ doc }));
export function load({ params }) { const k = KEY[params.doc]; const d = k && legal[k]; if (!d) error(404, "Not found"); return { doc: d, key: params.doc }; }
