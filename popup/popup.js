// popup/popup.js
//
// Loaded as a module so we can import shared helpers. Reads the synced
// partner list from chrome.storage.local (populated by service-worker.js
// via lib/sync.js) and falls back to the bundled seed if empty.

import {
  findOffer,
  composeOfferUrl,
  isValidSubdomain,
  normalizeHostname
} from "../lib/matcher.js";
import { loadSyncState } from "../lib/sync.js";
import { OFFERS as BUNDLED_OFFERS } from "../data/offers.js";

const els = {
  input: document.getElementById("subdomain-input"),
  saveBtn: document.getElementById("save-button"),
  preview: document.getElementById("subdomain-preview"),
  status: document.getElementById("subdomain-status"),
  syncCount: document.getElementById("sync-count"),
  syncTime: document.getElementById("sync-time"),
  syncBtn: document.getElementById("sync-button"),
  syncStatus: document.getElementById("sync-status"),
  currentTab: document.getElementById("current-tab"),
  partnerList: document.getElementById("partner-list")
};

let currentSubdomain = "";
let partners = []; // resolved partner list (synced or bundled)
let partnersSource = "empty"; // "synced" | "bundled" | "empty"

// ---------------------------------------------------------------------------
// Subdomain config
// ---------------------------------------------------------------------------

function setStatus(el, text, kind) {
  el.textContent = text || "";
  el.classList.remove("ok", "err");
  if (kind === "ok") el.classList.add("ok");
  if (kind === "err") el.classList.add("err");
}

function updatePreview(value) {
  const trimmed = (value || "").trim().toLowerCase();
  if (trimmed && isValidSubdomain(trimmed)) {
    els.preview.textContent = `https://${trimmed}.benefitsatwork.be`;
  } else {
    els.preview.textContent = "https://<subdomain>.benefitsatwork.be";
  }
}

async function loadSubdomain() {
  const { subdomain = "" } = await chrome.storage.local.get("subdomain");
  currentSubdomain = subdomain;
  els.input.value = subdomain;
  updatePreview(subdomain);
}

async function saveSubdomain() {
  const raw = els.input.value.trim().toLowerCase();
  if (!raw) {
    await chrome.storage.local.set({ subdomain: "" });
    currentSubdomain = "";
    setStatus(els.status, "Cleared.", "ok");
    renderCurrentTab();
    renderPartnerList();
    return;
  }
  if (!isValidSubdomain(raw)) {
    setStatus(
      els.status,
      "Invalid subdomain — use lowercase letters, digits and hyphens only.",
      "err"
    );
    return;
  }
  await chrome.storage.local.set({ subdomain: raw });
  currentSubdomain = raw;
  els.input.value = raw;
  setStatus(els.status, "Saved ✓", "ok");
  renderCurrentTab();
  renderPartnerList();
  setTimeout(() => setStatus(els.status, "", null), 2500);
}

els.input.addEventListener("input", (e) => {
  updatePreview(e.target.value);
  setStatus(els.status, "", null);
});
els.saveBtn.addEventListener("click", saveSubdomain);
els.input.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    saveSubdomain();
  }
});

// ---------------------------------------------------------------------------
// Sync
// ---------------------------------------------------------------------------

function formatRelativeTime(iso) {
  if (!iso) return "Never synced";
  try {
    const d = new Date(iso);
    const now = Date.now();
    const diff = now - d.getTime();
    const sec = Math.floor(diff / 1000);
    if (sec < 60) return `Synced ${sec}s ago`;
    const min = Math.floor(sec / 60);
    if (min < 60) return `Synced ${min}m ago`;
    const hr = Math.floor(min / 60);
    if (hr < 48) return `Synced ${hr}h ago`;
    const day = Math.floor(hr / 24);
    return `Synced ${day}d ago`;
  } catch {
    return "Never synced";
  }
}

async function loadPartnersList() {
  const state = await loadSyncState();
  if (state.partners && state.partners.length > 0) {
    partners = state.partners;
    partnersSource = "synced";
  } else {
    // Fallback to bundled seed
    partners = BUNDLED_OFFERS.map((o) => ({
      id: o.id,
      name: o.name,
      offerPath: o.offerPath,
      primaryCategory: "",
      logoUrl: null,
      domains: o.domains
    }));
    partnersSource = "bundled";
  }

  els.syncCount.textContent =
    partnersSource === "synced"
      ? `${partners.length} partners loaded`
      : `${partners.length} partners (bundled fallback)`;
  els.syncTime.textContent = formatRelativeTime(state.syncedAt);
  if (state.syncError) {
    setStatus(els.syncStatus, `Last error: ${state.syncError}`, "err");
  } else {
    setStatus(els.syncStatus, "", null);
  }
}

async function triggerSync() {
  els.syncBtn.disabled = true;
  els.syncBtn.textContent = "Syncing…";
  setStatus(els.syncStatus, "", null);
  try {
    const result = await chrome.runtime.sendMessage({ type: "sync-now" });
    if (result?.ok) {
      setStatus(
        els.syncStatus,
        `Synced ${result.count} partners`,
        "ok"
      );
    } else {
      setStatus(
        els.syncStatus,
        `Sync failed: ${result?.error || "unknown error"}`,
        "err"
      );
    }
  } catch (err) {
    setStatus(
      els.syncStatus,
      `Sync failed: ${err?.message || String(err)}`,
      "err"
    );
  } finally {
    els.syncBtn.disabled = false;
    els.syncBtn.textContent = "Sync now";
    await loadPartnersList();
    renderCurrentTab();
    renderPartnerList();
  }
}

els.syncBtn.addEventListener("click", triggerSync);

// ---------------------------------------------------------------------------
// Current tab status
// ---------------------------------------------------------------------------

function appendEmpty(text) {
  const p = document.createElement("p");
  p.className = "current-empty";
  p.textContent = text;
  els.currentTab.appendChild(p);
}

async function renderCurrentTab() {
  els.currentTab.innerHTML = "";

  let tab;
  try {
    [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  } catch {
    tab = null;
  }

  if (!tab || !tab.url || !/^https?:/.test(tab.url)) {
    appendEmpty("No web page in the current tab.");
    return;
  }

  let parsed;
  try {
    parsed = new URL(tab.url);
  } catch {
    appendEmpty("Couldn't read the current tab URL.");
    return;
  }

  const offer = findOffer(parsed.hostname, partners);
  if (!offer) {
    appendEmpty(`Not a known partner: ${normalizeHostname(parsed.hostname)}`);
    return;
  }

  const wrap = document.createElement("div");
  wrap.className = "current-match";

  const name = document.createElement("div");
  name.className = "partner-name";
  name.textContent = `✅ ${offer.name} — partner detected`;

  const host = document.createElement("div");
  host.className = "partner-host";
  host.textContent = parsed.hostname;

  const cta = document.createElement("a");
  cta.className = "cta";
  cta.target = "_blank";
  cta.rel = "noopener noreferrer";
  cta.textContent = "View deal →";

  const url = composeOfferUrl(currentSubdomain, offer.offerPath);
  if (url) {
    cta.href = url;
  } else {
    cta.setAttribute("aria-disabled", "true");
    cta.title = "Set your subdomain above first";
  }

  wrap.appendChild(name);
  wrap.appendChild(host);
  wrap.appendChild(cta);
  els.currentTab.appendChild(wrap);
}

// ---------------------------------------------------------------------------
// Partner list
// ---------------------------------------------------------------------------

function renderPartnerList() {
  els.partnerList.innerHTML = "";

  const sorted = [...partners].sort((a, b) =>
    a.name.localeCompare(b.name, "en", { sensitivity: "base" })
  );

  for (const offer of sorted) {
    const li = document.createElement("li");

    const name = document.createElement("span");
    name.className = "partner-name";
    name.textContent = offer.name;

    const link = document.createElement("a");
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = "View →";
    const url = composeOfferUrl(currentSubdomain, offer.offerPath);
    if (url && offer.offerPath) {
      link.href = url;
    } else {
      link.setAttribute("aria-disabled", "true");
      link.title = currentSubdomain
        ? "No offer path available"
        : "Set your subdomain above first";
    }

    li.appendChild(name);
    li.appendChild(link);
    els.partnerList.appendChild(li);
  }

  // Update header count
  const heading = els.partnerList.previousElementSibling;
  if (heading && heading.classList.contains("section-title")) {
    heading.textContent = `All partners (${partners.length})`;
  }
}

// ---------------------------------------------------------------------------
// Storage subscription — keep popup in sync if the SW updates partners or
// subdomain while popup is open.
// ---------------------------------------------------------------------------

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if ("subdomain" in changes) {
    currentSubdomain = changes.subdomain.newValue || "";
    if (els.input.value.trim().toLowerCase() !== currentSubdomain) {
      els.input.value = currentSubdomain;
      updatePreview(currentSubdomain);
    }
    renderCurrentTab();
    renderPartnerList();
  }
  if (
    "partners" in changes ||
    "syncedAt" in changes ||
    "syncError" in changes
  ) {
    loadPartnersList().then(() => {
      renderCurrentTab();
      renderPartnerList();
    });
  }
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

(async function boot() {
  await loadSubdomain();
  await loadPartnersList();
  renderCurrentTab();
  renderPartnerList();
})();
