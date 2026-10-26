// Umami events (BLUEPRINT §7.9). A declined visitor never loads the tracker, so window.umami is absent and every call is a no-op. No personal data in any property.
// PH1: the same event goes to PostHog when PostHog.svelte has started (after the cookie choice); otherwise window.docustayPosthog is absent.
export const track = (name, data) => { try { window.umami?.track(name, data); window.docustayPosthog?.(name, data); } catch { /* analytics never breaks a page */ } };
