// WHICH MODEL A CALL USES — ONE FUNCTION (AI-COST-AND-USAGE-SPEC §3, D-015). Every call site asks here; none names a model. Pure.
// Hosted workspaces (no key of their own, not a self-host) may use only the approved models; own-key and self-host workspaces use whatever they set. Cheap internal jobs (review, summary,
// checks, plays, the vision pre-check) run on Haiku 5.5, with Haiku 4.5 as the fallback when the newer name is not served yet.
import { DEFAULT_MODEL, THINK_MODEL, INTERNAL_MODEL, INTERNAL_FALLBACK, DEFAULT_EFFORT, isHostedModel, isPriced } from "./prices.mjs";

/** Features that are small internal jobs, not the person's own request. */
const INTERNAL_FEATURES = Object.freeze(["review", "summary", "check", "play", "vision_check"]);
const FEATURES = Object.freeze(["draft", "edit", "chat", "file_read", "detect", "think_harder", ...INTERNAL_FEATURES]);

/**
 * @param {{feature:string, cfgModel?:string, own?:boolean, selfHost?:boolean, thinkHarder?:boolean, env?:Record<string,string|undefined>}} a
 * @returns {{model:string, effort:string|null, fallback:string|null}}
 */
export function modelFor({ feature, cfgModel = "", own = false, selfHost = false, thinkHarder = false, env = process.env } = {}) {
  if (INTERNAL_FEATURES.includes(feature)) return { model: env.KEYSTONE_AI_INTERNAL_MODEL || INTERNAL_MODEL, effort: null, fallback: INTERNAL_FALLBACK };
  if (thinkHarder) return { model: THINK_MODEL, effort: DEFAULT_EFFORT, fallback: null };
  const free = own || selfHost;                               // a workspace with its own key (or a self-host) may name any model its provider offers
  const set = String(cfgModel ?? "").trim();
  const model = free ? (set || env.KEYSTONE_AI_DEFAULT_MODEL || DEFAULT_MODEL) : (isHostedModel(set) ? set : DEFAULT_MODEL);
  return { model, effort: isPriced(model) && model.startsWith("claude-") && /-5-/.test(model) ? DEFAULT_EFFORT : null, fallback: null };
}

/** The model to retry with when the first name is refused as unknown (only the internal Haiku has one). */
const fallbackAfterUnknownModel = (decision) => (decision?.fallback ? { ...decision, model: decision.fallback, fallback: null } : null);
