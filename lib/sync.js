// lib/sync.js
//
// Partner-list synchronisation against the n8n publish webhook.
//
// Storage layout (chrome.storage.local):
//   - syncEndpoint: string  — the webhook URL (default below; user can change later)
//   - partners:     Array<{id,name,offerPath,primaryCategory,logoUrl,domains}>
//   - syncedAt:     ISO datetime of the last successful fetch
//   - syncError:    string | null — last fetch error message
//   - syncCount:    number — partners returned by the last sync

export const DEFAULT_SYNC_ENDPOINT =
  "https://n8n.qinclaes.dev/webhook/benefits-partners";

// 24 hours in minutes (chrome.alarms uses minutes)
export const REFRESH_PERIOD_MINUTES = 24 * 60;
// Re-fetch on startup if the cache is older than this (48 h)
export const STALE_AFTER_MS = 48 * 60 * 60 * 1000;

/**
 * Read the current sync state from chrome.storage.local.
 */
export async function loadSyncState() {
  const {
    syncEndpoint = DEFAULT_SYNC_ENDPOINT,
    partners = [],
    syncedAt = null,
    syncError = null,
    syncCount = 0
  } = await chrome.storage.local.get([
    "syncEndpoint",
    "partners",
    "syncedAt",
    "syncError",
    "syncCount"
  ]);
  return { syncEndpoint, partners, syncedAt, syncError, syncCount };
}

/**
 * Save the configured sync endpoint URL.
 */
export async function saveSyncEndpoint(url) {
  await chrome.storage.local.set({ syncEndpoint: url });
}

/**
 * Returns true if the cached partner list is older than STALE_AFTER_MS.
 */
export function isStale(syncedAt) {
  if (!syncedAt) return true;
  const age = Date.now() - new Date(syncedAt).getTime();
  return age > STALE_AFTER_MS;
}

/**
 * Fetch the latest partner list from the configured endpoint.
 * Returns the parsed payload or throws on network / parse / validation errors.
 *
 * Expected shape:
 *   { version: number, fetchedAt: string, partnerCount: number,
 *     partners: [{ id, name, offerPath, primaryCategory, logoUrl, domains: [...] }] }
 */
export async function fetchPartners(endpoint) {
  if (!endpoint) throw new Error("No sync endpoint configured");
  const res = await fetch(endpoint, {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "no-store"
  });
  if (!res.ok) {
    throw new Error(`Sync HTTP ${res.status}: ${res.statusText}`);
  }
  let payload;
  try {
    payload = await res.json();
  } catch (e) {
    throw new Error("Sync response was not valid JSON");
  }
  if (!payload || !Array.isArray(payload.partners)) {
    throw new Error("Sync response missing partners array");
  }
  // Light shape validation
  const partners = payload.partners
    .filter(
      (p) =>
        p &&
        typeof p.id === "string" &&
        typeof p.name === "string" &&
        Array.isArray(p.domains) &&
        p.domains.length > 0
    )
    .map((p) => ({
      id: p.id,
      name: p.name,
      offerPath: typeof p.offerPath === "string" ? p.offerPath : "",
      primaryCategory:
        typeof p.primaryCategory === "string" ? p.primaryCategory : "",
      logoUrl: typeof p.logoUrl === "string" ? p.logoUrl : null,
      domains: p.domains
        .filter((d) => typeof d === "string" && d.includes("."))
        .map((d) => d.toLowerCase().replace(/^www\./, "").trim())
        .filter(Boolean)
    }))
    .filter((p) => p.domains.length > 0);
  return partners;
}

/**
 * High-level sync: fetch + persist + return result.
 * Sets `partners`, `syncedAt`, clears `syncError` on success;
 * sets `syncError` on failure but leaves the previous cache intact.
 */
export async function syncNow() {
  const { syncEndpoint } = await loadSyncState();
  try {
    const partners = await fetchPartners(syncEndpoint);
    const now = new Date().toISOString();
    await chrome.storage.local.set({
      partners,
      syncedAt: now,
      syncCount: partners.length,
      syncError: null
    });
    return { ok: true, count: partners.length, syncedAt: now };
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    await chrome.storage.local.set({ syncError: msg });
    return { ok: false, error: msg };
  }
}

/**
 * Get the cached partner list, falling back to the bundled seed offers
 * (data/offers.js) if the cache is empty.
 *
 * NB: callers in the service worker should keep this lazy — call once on every
 * SW wake and cache in module-scope locals.
 */
export async function getEffectivePartners() {
  const { partners } = await loadSyncState();
  if (partners && partners.length > 0) {
    return { partners, source: "synced" };
  }
  // Fallback to bundled seed
  try {
    const { OFFERS } = await import("../data/offers.js");
    const fallback = OFFERS.map((o) => ({
      id: o.id,
      name: o.name,
      offerPath: o.offerPath,
      primaryCategory: "",
      logoUrl: null,
      domains: o.domains
    }));
    return { partners: fallback, source: "bundled" };
  } catch {
    return { partners: [], source: "empty" };
  }
}
