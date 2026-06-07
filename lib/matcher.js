// lib/matcher.js
//
// Hostname normalisation and suffix-based partner matching.
//
// Why suffix matching: a partner like adidas.com should also match www.adidas.com,
// shop.adidas.com, etc. without false-positives like notadidas.com.

/**
 * Lowercase, strip a leading "www." prefix.
 */
export function normalizeHostname(hostname) {
  if (!hostname) return "";
  return hostname.toLowerCase().replace(/^www\./, "");
}

/**
 * Returns the first offer whose `domains` list contains a match for the given hostname.
 * A match is either:
 *   - exact equality (after normalisation), or
 *   - the stored domain is a strict suffix of the normalised hostname, preceded by ".".
 *
 * @param {string} hostname     raw hostname (e.g. "www.shop.adidas.com")
 * @param {Array<{domains: string[]}>} offers
 * @returns {object|null}       the matching offer, or null
 */
export function findOffer(hostname, offers) {
  const h = normalizeHostname(hostname);
  if (!h) return null;
  for (const offer of offers) {
    for (const d of offer.domains) {
      const dNorm = d.toLowerCase();
      if (h === dNorm || h.endsWith("." + dNorm)) {
        return offer;
      }
    }
  }
  return null;
}

/**
 * Compose the full benefits URL for an offer, given the user-configured subdomain.
 * Returns null if the subdomain is missing or invalid.
 */
export function composeOfferUrl(subdomain, offerPath) {
  const sd = (subdomain || "").trim().toLowerCase();
  if (!sd || !/^[a-z0-9][a-z0-9-]*$/.test(sd)) return null;
  if (!offerPath || !offerPath.startsWith("/")) return null;
  return `https://${sd}.benefitsatwork.be${offerPath}`;
}

/**
 * Lightweight subdomain validator used by the popup before saving.
 */
export function isValidSubdomain(value) {
  const v = (value || "").trim().toLowerCase();
  return /^[a-z0-9][a-z0-9-]*$/.test(v);
}
