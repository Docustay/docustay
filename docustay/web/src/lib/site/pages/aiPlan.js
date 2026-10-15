// The AI plan wording: the two numbers come from plans.js, which scripts/claims-gate.mjs checks against the server (claims ai-credits-free and ai-credits-pro).
import { AI_CREDITS } from "../plans.js";
export const AI_PLAN = { freeCredits: AI_CREDITS.free, proCredits: AI_CREDITS.pro };
