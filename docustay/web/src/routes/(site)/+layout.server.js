// Umami (MIT, self-hosted): the page analytics for the public site. Both values come from the service's environment at build time (prerendered pages) and at run time; with either missing, no analytics code is on the page.
// A self-hosted Docustay install never sets them, so it never loads this.
export const load = () => {
  const url = (process.env.DOCUSTAY_UMAMI_URL ?? "").replace(/\/+$/, ""), id = process.env.DOCUSTAY_UMAMI_ID ?? "";
  // PH1: PostHog's public project token (phc_…) and host; missing either, no PostHog on the page. A self-hosted install never sets them.
  const phToken = process.env.DOCUSTAY_POSTHOG_TOKEN ?? "", phHost = (process.env.DOCUSTAY_POSTHOG_HOST || "https://us.i.posthog.com").replace(/\/+$/, "");
  return { umami: /^https:\/\//.test(url) && /^[0-9a-f-]{36}$/.test(id) ? { url, id } : null,
    posthog: /^phc_[A-Za-z0-9]+$/.test(phToken) && /^https:\/\//.test(phHost) ? { token: phToken, host: phHost } : null };
};
