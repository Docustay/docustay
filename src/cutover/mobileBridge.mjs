// P11.2 — R0, THE MOBILE BRIDGE. It ships FIRST, and the reason is one sentence.
//
// ★★★ §11.1: "★ YOU CANNOT ADD A GATE TO A VERSION ALREADY ON A PHONE. Skip R0 and the only
// lever over a stale install is **BREAKING ITS API** — which is going dark."
//
// ★★ AND §11 OPENS WITH: "★★ NOTHING GOES DARK." So R0 is not a convenience feature, it is the
// thing that makes every later retirement survivable. A phone running last year's build has no
// idea the backend moved; the only way to tell it is a mechanism that was already there.
//
// ★ TWO PARTS:
//   1. a FORCED-UPDATE GATE — full-screen, non-dismissable, ★ WITH A SUPPORT PHONE NUMBER
//   2. BACKEND-URL INDIRECTION read from `app-config.json` — so the backend can move without
//      a new build, which is what buys the parallel period.

/**
 * ★★ The remote config a phone fetches on launch. It is READ, never compiled in — a compiled
 * URL is a URL that requires an App Store review to change, and review is 24–48h on a good day
 * and "★ plan 7 days and two rejections" on a real one.
 */
export const CONFIG_PATH = 'app-config.json';

export class ConfigInvalid extends Error {
  constructor(message) { super(message); this.name = 'ConfigInvalid'; }
}

/**
 * ★★★ VALIDATE THE REMOTE CONFIG BEFORE OBEYING IT.
 * ★ This file is the one thing that can brick every install at once. A typo'd `minimumBuild`
 * locks out every user; a missing `backendUrl` points the app at nothing. So it is validated
 * strictly and, on failure, THE APP KEEPS ITS LAST GOOD CONFIG rather than trusting the new one.
 * ★★ Fail-closed here means "keep working", not "refuse to start" — the failure mode to avoid is
 * a blank screen, not a stale URL.
 */
export function validateConfig(raw) {
  if (!raw || typeof raw !== 'object') throw new ConfigInvalid('config is not an object');
  const { backendUrl, minimumBuild, supportPhone } = raw;

  if (typeof backendUrl !== 'string' || !/^https:\/\//.test(backendUrl)) {
    throw new ConfigInvalid('backendUrl must be an https URL');
  }
  if (!Number.isInteger(minimumBuild) || minimumBuild < 1) {
    throw new ConfigInvalid('minimumBuild must be a positive integer');
  }
  // ★★★ THE SUPPORT PHONE NUMBER IS MANDATORY. §11.1: the prompt must be "a full-screen
  // non-dismissable prompt **WITH A SUPPORT PHONE NUMBER**, never a blank screen or a silent
  // 401." ★ A non-dismissable screen with no way to reach a human is a locked door, and the
  // people on the other side of it are in recovery.
  if (typeof supportPhone !== 'string' || supportPhone.trim().length < 7) {
    throw new ConfigInvalid('supportPhone is REQUIRED — a non-dismissable prompt with no way to reach a human is a locked door');
  }
  return { backendUrl, minimumBuild, supportPhone: supportPhone.trim() };
}

/**
 * ★★ Resolve the config a phone should act on. An invalid remote config is IGNORED in favour of
 * the last known good one — and the failure is reported, not swallowed.
 */
export function resolveConfig(remote, lastGood = null) {
  try {
    return { config: validateConfig(remote), source: 'remote', error: null };
  } catch (e) {
    if (lastGood) return { config: lastGood, source: 'last_good', error: e.message };
    // ★ No remote, no cached — the app cannot proceed, and says why rather than showing nothing.
    return { config: null, source: 'none', error: e.message };
  }
}

export const GATE_STATES = Object.freeze(['ok', 'update_required', 'cannot_start']);

/**
 * ★★★ THE GATE DECISION, on the phone, at launch.
 * ★ `update_required` is a FULL-SCREEN, NON-DISMISSABLE prompt carrying the support number.
 * ★★ It is NOT a silent 401 and NOT a blank screen — those are the two things §11.1 names, and
 * both are indistinguishable to a user from "the app is broken".
 */
export function evaluateGate({ installedBuild, config }) {
  if (!config) {
    return { state: 'cannot_start', dismissable: false, supportPhone: null,
             reason: 'no valid configuration is available' };
  }
  if (!Number.isInteger(installedBuild)) {
    return { state: 'cannot_start', dismissable: false, supportPhone: config.supportPhone,
             reason: 'the installed build number is unreadable' };
  }
  if (installedBuild < config.minimumBuild) {
    return {
      state: 'update_required',
      dismissable: false,                 // ★ never dismissable — that is the whole point
      supportPhone: config.supportPhone,  // ★ always present — validateConfig guarantees it
      backendUrl: config.backendUrl,
      reason: `build ${installedBuild} is below the minimum ${config.minimumBuild}`,
    };
  }
  return { state: 'ok', dismissable: true, backendUrl: config.backendUrl };
}

/**
 * ★★ ROLLOUT. §11.1: "gate on **'approved AND at 100%'**, never 'submitted'. Play 5→20→50→100%;
 * iOS phased, with the pause watched."
 * ★ "Submitted" is not a state the world can see. A rollout gated on submission proceeds while
 * the build is still in review — and then the backend moves under an app nobody has.
 */
export const PLAY_ROLLOUT_STAGES = Object.freeze([5, 20, 50, 100]);

export function rolloutComplete({ storeState, rolloutPercent }) {
  return storeState === 'approved' && rolloutPercent === 100;
}

/**
 * ★★★ §11.1's honest paragraph, encoded — and it is worth keeping because it refuses to design
 * for scale that does not exist:
 *   "★ Users who never update — the honest answer: at **38 device rows across at most 7 external
 *    people THERE IS NO ANONYMOUS LONG TAIL. the maintainer or Grant can phone every one.** State that rather
 *    than designing for absent scale. ★ The mechanism still gets built for the next tenant."
 *
 * ★★ AND: "the old backend stays up THE WHOLE PARALLEL PERIOD so the gate DIRECTS rather than
 * STRANDS." A gate with the old backend already dead is just a locked door with a phone number.
 */
export const STALE_INSTALL_REALITY = Object.freeze({
  deviceRows: 38,
  externalPeople: 7,
  anonymousLongTail: false,
  remedy: 'phone them',
  oldBackendStaysUpForParallelPeriod: true,
});

/**
 * ★★ §11.1: "The ~6-month-stale build PREDATES R0 and **has no gate**: enumerate it from
 * `users/{uid}/devices` **BEFORE** retiring that collection."
 * ★ This returns the QUERY to run, not the result — P11.6 is a read against the legacy system,
 * and this module does not reach into it.
 */
export const STALE_BUILD_ENUMERATION = Object.freeze({
  source: 'users/{uid}/devices',
  mustRunBefore: 'any retirement of the devices collection',
  why: 'that build predates R0 and therefore has no forced-update gate at all',
});
