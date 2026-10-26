// src/documents/chromeInputs.mjs — the practice-level inputs every rendering of a document needs (QUEUE §23.2.6/§23.2.8): the island's settings, the practice's brand through the BRAND PORT,
// the logo as bytes, and the practice's timezone. One function, so the signed PDF, the template preview PDF and the "Preview a signed copy" screen all start from the same facts.
import { getDocumentSettings, getDocumentSetting } from "./settings.mjs";
import { mergeTemplateOverride } from "./settingsSchema.mjs";
import { ports } from "./ports.mjs";
import { fetchLogoBytes } from "./logo.mjs";

/**
 * ★ Part 29 (D5) — the product's own line ("Sent with Docustay") for this organisation: the host supplies it for a Docustay workspace; the workspace may hide it ONLY while its plan includes that (the host answers);
 * `null` = none. `undefined` = the host has no such line (a the platform organisation keeps its own wording). Also the product's name, for the seal on a signed PDF.
 */
export async function footerBrandFor(tx, { tenantId, brand = null }) {
  const P = await ports();
  const b = brand ?? await P.brand.get(tx, { tenantId });
  if (b.footerBrand === undefined) return { productName: b.productName ?? "Docustay", footer: undefined };
  const hide = (await getDocumentSetting(tx, "brand.hide_footer")) === true && (await P.entitlements?.isEntitled?.(tx, { tenantId, item: "hide_footer" })) !== false;
  return { productName: b.productName ?? "Docustay", footer: hide ? null : b.footerBrand };
}

export async function chromeInputsFor(tx, { tenantId, templateId = null, withLogoBytes = true }) {
  let settings = await getDocumentSettings(tx);
  // ★ QUEUE §23.2.8 — a template may override how ITS signed copies look (optional; the practice's settings fill everything it does not name)
  if (templateId) {
    const { rows } = await tx.query(`SELECT signed_copy FROM keystone.document_template WHERE id = $1`, [templateId]);
    settings = mergeTemplateOverride(settings, rows[0]?.signed_copy ?? null);
  }
  const brand = await (await ports()).brand.get(tx, { tenantId });
  const logoBytes = withLogoBytes && settings["signed_copy.letterhead"] ? await fetchLogoBytes(brand.logoUrl) : null;
  const fb = await footerBrandFor(tx, { tenantId, brand });
  return { settings, brand: { practiceName: brand.practiceName, logoUrl: brand.logoUrl, productName: fb.productName, poweredBy: fb.footer ?? null }, logoBytes, zone: brand.timezone || "UTC", publicBase: brand.publicBase ?? null };
}
