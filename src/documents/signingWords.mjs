// The fixed wording of the two other signing emails — the signed copy and the access code — in es, fr, de (the invitation/reminder already has its own table in signLinkLanguages.mjs). Pure data, no imports.
// ★ MACHINE-WRITTEN: needs a native speaker's review before it is relied on (recorded in the follow-up report). English is NOT here — English keeps the editable template.
import { WORDS } from "./languages.mjs";
export const signingWords = (lang) => WORDS[lang] ?? null;
