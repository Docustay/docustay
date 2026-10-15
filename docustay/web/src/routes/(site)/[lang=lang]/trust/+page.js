export const prerender = true;
import { SITE_LANGS } from "$lib/site/l10n.js";
export const entries = () => SITE_LANGS.filter((l) => l !== "en").map((lang) => ({ lang }));
