// HOTFIX 11 Oct 2026: when the workspace requires two-step sign-in (an owner turned on "Require two-step sign-in for every team member") and this person has not set it up, the API answers
// `two_step_required`. The app shows ONE set-up page in place of the screen (TwoStepGate.svelte) — never a redirect, so nothing can loop. api.js raises the flag; the gate lowers it once set up.
export const twoStepGate = $state({ needed: false, message: "" });
