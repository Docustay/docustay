import { SITE_LANGS } from "../lib/site/l10n-langs.js";
export const match = (p) => p !== "en" && SITE_LANGS.includes(p);
