// Task 16.27 — Google Tag Manager analytics integration.
//
// Exports gtmSnippets({containerId, practice}) that builds head, body, and JSON-LD snippets
// for GTM tracking. Container ID is escaped before interpolation to defend against injection.

import { APP_DOMAIN_VAR } from "../auth/tenantFromHost.mjs";

const appDomain = () => process.env[APP_DOMAIN_VAR] || "example.com";

/**
 * Escape a string for safe interpolation into JavaScript/HTML.
 * Escapes single and double quotes, backslash, and newlines.
 */
function escapeStringLiteral(str) {
  if (typeof str !== "string") return str;
  return str
    .replace(/\\/g, "\\\\")    // backslash first
    .replace(/'/g, "\\'")      // single quote
    .replace(/"/g, '\\"')      // double quote
    .replace(/\n/g, "\\n")     // newline
    .replace(/\r/g, "\\r");    // carriage return
}

/**
 * Build Google Tag Manager snippets: head JS, body noscript fallback, and JSON-LD.
 *
 * @param {Object} params
 * @param {string} params.containerId - GTM container ID (e.g., 'GTM-ABC123')
 * @param {Object} params.practice - practice row with {name, slug}
 * @returns {Object} {head, body, jsonLd} strings
 */
export function gtmSnippets({ containerId, practice }) {
  // Escape the container ID for safe interpolation
  const escapedContainerId = escapeStringLiteral(containerId);

  // ★ Google's standard GTM head snippet
  const head = `<script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
})(window,document,'script','dataLayer','${escapedContainerId}');</script>`;

  // ★ Google's standard GTM body noscript fallback
  const body = `<noscript><iframe src="https://www.googletagmanager.com/ns.html?id=${escapedContainerId}" height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>`;

  // ★ Schema.org LocalBusiness JSON-LD built from practice details and public booking URL
  const domain = practice.slug ? `${practice.slug}.${appDomain()}` : null;
  const url = domain ? `https://${domain}/book` : null;

  const jsonLdData = {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    name: practice.name || "Service Business",
    ...(url ? { url } : {}),
  };

  const jsonLd = `<script type="application/ld+json">${JSON.stringify(jsonLdData)}</script>`;

  return {
    head,
    body,
    jsonLd,
  };
}
