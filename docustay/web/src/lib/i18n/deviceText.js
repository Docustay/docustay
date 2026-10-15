// D-042: "Chrome on macOS" written in the person's language. Lives outside index.svelte.js because the extractor reads this file (its sentences reach the catalogues).
import { t } from "./index.svelte.js";

export function deviceText(dev, fallback) { if (!dev) return fallback ?? t("Unknown device"); return t("{browser} on {os}", { browser: dev.browser ?? t("an unknown browser"), os: dev.os ?? t("an unknown OS") }); }
