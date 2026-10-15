// src/growth/places.mjs — TASK 17.36
// Google Places API integration for business lookup during signup.
//
// ★★★ TWO FAILURE MODES. This module is adopted when the Places key is missing or the API is
// unreachable. Both `searchBusinesses` and `businessDetail` return `{available:false, reason}` —
// never a throw and never an empty list. The client's job is to promote the "type it yourself"
// fallback (F01 §3.6, non-blocking dependency).

import { callOutside } from "../http/outside.mjs";

/**
 * Search for a business by name using Google Places API.
 * ★ When the API key is missing or the call fails, returns `{available:false, reason}` instead
 *   of throwing — the feature gracefully degrades.
 *
 * @param {string} query - the business name to search for
 * @param {Function} [fetchImpl] - optional fetch implementation for testing
 * @returns {Promise<{available: boolean, results?: Array<{placeId, name, address}>, reason?: string}>}
 */
export async function searchBusinesses({ query, fetchImpl } = {}) {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;

  // ★ Missing key → graceful degradation. The client will show "type it yourself".
  if (!apiKey) {
    return { available: false, reason: "business lookup is unavailable" };
  }

  // ★ Validate input before making the outside call.
  if (!query || typeof query !== "string" || query.trim().length === 0) {
    return { available: false, reason: "search query is required" };
  }

  const url = new URL("https://places.googleapis.com/v1/places:searchText");
  url.searchParams.set("key", apiKey);

  const response = await callOutside("google-places-search", url.toString(), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ textQuery: query }),
    fetchImpl,
  });

  // ★ Any failure from callOutside → available:false. It never throws.
  if (!response.ok) {
    return {
      available: false,
      reason: response.kind ? `lookup service ${response.kind.toLowerCase()}` : "lookup failed",
    };
  }

  const data = response.body;
  if (!data || !Array.isArray(data.places)) {
    return { available: false, reason: "lookup returned no results" };
  }

  // ★ Map only the fields the client needs; nothing invented.
  const results = data.places.map((place) => ({
    placeId: place.name, // e.g. "places/ChIJrTLr5LoKkIcRVfaey0S7gWY"
    name: place.displayName?.text ?? "",
    address: place.formattedAddress ?? "",
  }));

  return { available: true, results };
}

/**
 * Get detailed information about a business from its Google Places ID.
 * ★ When the API key is missing or the call fails, returns `{available:false, reason}`.
 *
 * @param {string} placeId - the Google Place ID (from search results)
 * @param {Function} [fetchImpl] - optional fetch implementation for testing
 * @returns {Promise<{available: boolean, listing?: {name, address, phone, website, hours, reviewCount, rating}, reason?: string}>}
 */
export async function businessDetail({ placeId, fetchImpl } = {}) {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;

  if (!apiKey) {
    return { available: false, reason: "business lookup is unavailable" };
  }

  if (!placeId || typeof placeId !== "string" || placeId.trim().length === 0) {
    return { available: false, reason: "place id is required" };
  }

  const url = new URL(`https://places.googleapis.com/v1/${placeId}`);
  url.searchParams.set("key", apiKey);
  url.searchParams.set("fields", [
    "displayName", "formattedAddress", "internationalPhoneNumber", "websiteUri",
    "regularOpeningHours", "reviews", "rating",
  ].join(","));

  const response = await callOutside("google-places-detail", url.toString(), {
    method: "GET",
    headers: { "accept": "application/json" },
    fetchImpl,
  });

  if (!response.ok) {
    return {
      available: false,
      reason: response.kind ? `lookup service ${response.kind.toLowerCase()}` : "lookup failed",
    };
  }

  const data = response.body;
  if (!data) {
    return { available: false, reason: "lookup returned no details" };
  }

  // ★ Extract only the fields needed by the form; nothing invented.
  const listing = {
    name: data.displayName?.text ?? "",
    address: data.formattedAddress ?? "",
    phone: data.internationalPhoneNumber ?? "",
    website: data.websiteUri ?? "",
    hours: (data.regularOpeningHours?.weekdayDescriptions ?? []).join(" | ") || "",
    reviewCount: data.reviews?.length ?? 0,
    rating: data.rating ?? null,
  };

  return { available: true, listing };
}
