// service-worker.js
//
// Background service worker for the Benefits@Work Notifier extension.
//
// Responsibilities:
//   1. Watch tab updates / activations and detect when the active page
//      belongs to a known partner.
//   2. Maintain the action badge on partner pages.
//   3. Inject content.js on matched tabs and hand it the offer + subdomain.
//   4. Push subdomain changes to all open partner tabs so the toast link
//      stays current without a reload.
//   5. Track per-tab dismissals so a closed toast does not re-appear on
//      subsequent navigations within the same partner site.
//   6. Sync the partner list from the n8n webhook on a 24 h alarm and on
//      install/startup when the cache is stale.
//
// The toolbar icon comes from manifest.json (assets/icons/icon-{16,48,128}.png)
// and the badge background is set on first activation.

import { findOffer, composeOfferUrl } from "./lib/matcher.js";
import {
  getEffectivePartners,
  syncNow,
  loadSyncState,
  isStale,
  REFRESH_PERIOD_MINUTES
} from "./lib/sync.js";

// Platform palette
const BADGE_BG = "#dbb17f";

// In-memory cache of the partner list. Rebuilt on every SW wake by
// reading chrome.storage.local in evaluateTab(). The cache lifetime is the
// SW lifetime (~30 s of idle) — we always re-load if it's missing.
let partnersCache = null;
let partnersSource = "empty";

async function ensurePartnersLoaded() {
  if (partnersCache && partnersCache.length > 0) return;
  const { partners, source } = await getEffectivePartners();
  partnersCache = partners;
  partnersSource = source;
}

// Invalidate the cache when storage changes — keeps it in sync with manual
// refreshes from the popup or alarm-driven syncs.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if ("partners" in changes) {
    partnersCache = null;
    partnersSource = "empty";
  }
});

// One-time install: badge colour + alarm + initial sync.
chrome.runtime.onInstalled.addListener(async () => {
  chrome.action.setBadgeBackgroundColor({ color: BADGE_BG }).catch(() => {});
  // Create the periodic refresh alarm
  chrome.alarms.create("refresh-partners", {
    periodInMinutes: REFRESH_PERIOD_MINUTES,
    delayInMinutes: 1
  });
  // Kick off an initial sync so the cache is populated immediately
  syncNow().catch((e) =>
    console.warn("[benefits-notifier] initial sync failed:", e)
  );
});

// On every SW startup, sync if the cache is stale.
chrome.runtime.onStartup.addListener(async () => {
  try {
    const { syncedAt } = await loadSyncState();
    if (isStale(syncedAt)) {
      await syncNow();
    }
  } catch (e) {
    console.warn("[benefits-notifier] startup sync check failed:", e);
  }
});

// Refresh on alarm fire.
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "refresh-partners") {
    syncNow().catch((e) =>
      console.warn("[benefits-notifier] alarm sync failed:", e)
    );
  }
});

// -----------------------------------------------------------------------------
// Session-state helpers (per-tab dismissal + last-partner tracking)
// -----------------------------------------------------------------------------

async function getSessionState() {
  const { lastPartner = {}, dismissed = {} } = await chrome.storage.session.get([
    "lastPartner",
    "dismissed"
  ]);
  return { lastPartner, dismissed };
}

async function setSessionState(patch) {
  await chrome.storage.session.set(patch);
}

async function applyTransition(tabId, newPartnerId) {
  const { lastPartner, dismissed } = await getSessionState();
  const prev = lastPartner[tabId] ?? null;

  let dismissedChanged = false;
  let lastPartnerChanged = false;

  if (prev !== newPartnerId) {
    if (dismissed[tabId]) {
      const tabMap = dismissed[tabId];
      if (prev && tabMap[prev]) {
        delete tabMap[prev];
        dismissedChanged = true;
      }
      if (newPartnerId && tabMap[newPartnerId]) {
        delete tabMap[newPartnerId];
        dismissedChanged = true;
      }
      if (Object.keys(tabMap).length === 0) {
        delete dismissed[tabId];
      } else {
        dismissed[tabId] = tabMap;
      }
    }
    if (newPartnerId == null) {
      delete lastPartner[tabId];
    } else {
      lastPartner[tabId] = newPartnerId;
    }
    lastPartnerChanged = true;
  }

  if (dismissedChanged || lastPartnerChanged) {
    await setSessionState({ lastPartner, dismissed });
  }
  return { lastPartner, dismissed };
}

async function markDismissed(tabId, partnerId) {
  const { dismissed } = await getSessionState();
  const tabMap = dismissed[tabId] || {};
  tabMap[partnerId] = true;
  dismissed[tabId] = tabMap;
  await setSessionState({ dismissed });
}

async function clearTabState(tabId) {
  const { lastPartner, dismissed } = await getSessionState();
  let changed = false;
  if (tabId in lastPartner) {
    delete lastPartner[tabId];
    changed = true;
  }
  if (tabId in dismissed) {
    delete dismissed[tabId];
    changed = true;
  }
  if (changed) {
    await setSessionState({ lastPartner, dismissed });
  }
}

// -----------------------------------------------------------------------------
// Tab evaluation
// -----------------------------------------------------------------------------

async function evaluateTab(tabId, url) {
  if (typeof url !== "string" || !/^https?:/.test(url)) {
    await applyTransition(tabId, null);
    await safeClearBadge(tabId);
    return;
  }

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    await applyTransition(tabId, null);
    await safeClearBadge(tabId);
    return;
  }

  await ensurePartnersLoaded();
  const offer = findOffer(parsed.hostname, partnersCache || []);
  const newPartnerId = offer ? offer.id : null;

  const { dismissed } = await applyTransition(tabId, newPartnerId);

  if (!offer) {
    await safeClearBadge(tabId);
    return;
  }

  try {
    await chrome.action.setBadgeBackgroundColor({ color: BADGE_BG, tabId });
    await chrome.action.setBadgeText({ text: "✓", tabId });
  } catch {
    /* tab gone */
  }

  const tabDismissals = dismissed[tabId] || {};
  if (tabDismissals[offer.id]) return;

  const { subdomain = "" } = await chrome.storage.local.get("subdomain");
  const fullUrl = composeOfferUrl(subdomain, offer.offerPath);

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"]
    });
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (payload) => {
        if (typeof window.__benefitsNotifierShow === "function") {
          window.__benefitsNotifierShow(payload);
        }
      },
      args: [
        {
          id: offer.id,
          name: offer.name,
          fullUrl,
          subdomainSet: !!fullUrl
        }
      ]
    });
  } catch (err) {
    console.debug("[benefits-notifier] inject failed for", url, err?.message);
  }
}

async function safeClearBadge(tabId) {
  try {
    await chrome.action.setBadgeText({ text: "", tabId });
  } catch {
    /* tab gone */
  }
}

// -----------------------------------------------------------------------------
// Event wiring (synchronous registration)
// -----------------------------------------------------------------------------

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete") return;
  evaluateTab(tabId, tab?.url);
});

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    evaluateTab(tab.id, tab.url);
  } catch {
    /* tab gone */
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  clearTabState(tabId).catch(() => {});
});

chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== "local") return;

  // Subdomain change → tell every tab about the new value, re-evaluate
  if ("subdomain" in changes) {
    const newValue = changes.subdomain.newValue || "";
    let tabs;
    try {
      tabs = await chrome.tabs.query({});
    } catch {
      return;
    }
    for (const tab of tabs) {
      if (!tab.id || !tab.url) continue;
      chrome.tabs
        .sendMessage(tab.id, { type: "subdomain-updated", subdomain: newValue })
        .catch(() => {});
      evaluateTab(tab.id, tab.url);
    }
  }

  // Partners changed (after sync) → re-evaluate every tab so badges update
  if ("partners" in changes) {
    let tabs;
    try {
      tabs = await chrome.tabs.query({});
    } catch {
      return;
    }
    for (const tab of tabs) {
      if (!tab.id || !tab.url) continue;
      evaluateTab(tab.id, tab.url);
    }
  }
});

// Messages from popup and content scripts.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "sync-now") {
    (async () => {
      const result = await syncNow();
      sendResponse(result);
    })();
    return true;
  }

  if (msg?.type === "evaluate-tab" && typeof msg.tabId === "number") {
    chrome.tabs
      .get(msg.tabId)
      .then((tab) => evaluateTab(tab.id, tab.url))
      .catch(() => {});
    sendResponse({ ok: true });
    return;
  }

  if (msg?.type === "dismiss-toast" && typeof msg.partnerId === "string") {
    const tabId = sender?.tab?.id;
    if (typeof tabId !== "number") {
      sendResponse({ ok: false, error: "no tab" });
      return;
    }
    (async () => {
      try {
        await markDismissed(tabId, msg.partnerId);
        sendResponse({ ok: true });
      } catch (err) {
        sendResponse({ ok: false, error: String(err?.message || err) });
      }
    })();
    return true;
  }
});
