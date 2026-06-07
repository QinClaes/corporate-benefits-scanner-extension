// content.js
//
// Injected programmatically by the service worker on partner pages.
// Renders a Honey-style bottom-right toast with a deep link to the matching
// Benefits@Work offer.
//
// IMPORTANT: this file is loaded via chrome.scripting.executeScript({ files }),
// which uses a CLASSIC script (no ES modules). Do not add import statements.
//
// Re-injection: the service worker re-runs this file on every tab navigation,
// so we guard against re-defining everything by checking a window-scoped
// sentinel. The exposed entrypoint is window.__benefitsNotifierShow(payload).

(() => {
  const SENTINEL = "__benefitsNotifierInstalled";
  if (window[SENTINEL]) {
    // Already installed in this page — the SW will call __benefitsNotifierShow
    // separately to (re-)render the toast with fresh data.
    return;
  }
  window[SENTINEL] = true;

  // ---------------------------------------------------------------------------
  // DOM IDs / classes — namespaced to avoid host-page collisions.
  // ---------------------------------------------------------------------------
  const ROOT_ID = "benefits-notifier-root";
  const STYLE_ID = "benefits-notifier-style";

  // Resolved at injection time. Safe inside extension contexts; returns the
  // chrome-extension://<id>/assets/logo.png URL that was declared as a
  // web_accessible_resource in manifest.json.
  const LOGO_URL = chrome.runtime.getURL("assets/logo.png");

  // Platform palette — matches the partner portal's CSS.
  //   #494e63 slate (header / nav)
  //   #29282d near-black (header gradient end)
  //   #dbb17f tan (primary CTA)
  //   #b79266 tan hover
  //   #ccd3dd light slate
  //   #29282d primary text
  const STYLES = `
    #${ROOT_ID} {
      all: initial;
      position: fixed;
      right: 20px;
      bottom: 20px;
      z-index: 2147483000;
      width: 340px;
      max-width: calc(100vw - 40px);
      font-family: -apple-system, "Segoe UI", system-ui, sans-serif;
      color: #29282d;
    }
    #${ROOT_ID} * {
      box-sizing: border-box;
    }
    #${ROOT_ID} .bw-card {
      background: #ffffff;
      border: 1px solid #ccd3dd;
      border-radius: 10px;
      box-shadow: 0 12px 28px rgba(41, 40, 45, 0.22), 0 4px 8px rgba(41, 40, 45, 0.10);
      overflow: hidden;
      animation: bw-slide-in 200ms ease-out;
    }
    @keyframes bw-slide-in {
      from { transform: translateY(12px); opacity: 0; }
      to   { transform: translateY(0);    opacity: 1; }
    }
    #${ROOT_ID} .bw-banner {
      background: linear-gradient(180deg, #494e63 0%, #29282d 100%);
      padding: 10px 12px;
      display: flex;
      align-items: center;
      gap: 10px;
    }
    #${ROOT_ID} .bw-logo {
      flex: 0 0 auto;
      height: 28px;
      width: auto;
      display: block;
      filter: brightness(0) invert(1);  /* logo asset is dark; force white */
    }
    #${ROOT_ID} .bw-banner-text {
      flex: 1 1 auto;
      min-width: 0;
      color: #ffffff;
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }
    #${ROOT_ID} .bw-close {
      flex: 0 0 auto;
      background: transparent;
      border: 0;
      width: 24px;
      height: 24px;
      border-radius: 6px;
      color: #ccd3dd;
      cursor: pointer;
      font-size: 14px;
      line-height: 1;
      padding: 0;
    }
    #${ROOT_ID} .bw-close:hover {
      background: rgba(255, 255, 255, 0.12);
      color: #ffffff;
    }
    #${ROOT_ID} .bw-body {
      padding: 14px 16px 16px 16px;
    }
    #${ROOT_ID} .bw-title {
      font-size: 14px;
      font-weight: 700;
      color: #29282d;
      margin: 0 0 4px 0;
      line-height: 1.3;
    }
    #${ROOT_ID} .bw-partner {
      font-size: 12px;
      color: #4d4d4d;
      margin: 0;
      line-height: 1.4;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    #${ROOT_ID} .bw-actions {
      margin-top: 12px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    #${ROOT_ID} .bw-cta {
      flex: 1 1 auto;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      padding: 10px 14px;
      background: #dbb17f;
      color: #29282d;
      border: 2px solid #dbb17f;
      border-radius: 6px;
      font-weight: 700;
      font-size: 13px;
      text-decoration: none;
      cursor: pointer;
      transition: background 120ms ease, border-color 120ms ease;
    }
    #${ROOT_ID} .bw-cta:hover {
      background: #b79266;
      border-color: #b79266;
    }
    #${ROOT_ID} .bw-cta[aria-disabled="true"] {
      background: #e6e6e6;
      border-color: #e6e6e6;
      color: #b3b3b3;
      cursor: not-allowed;
    }
    #${ROOT_ID} .bw-hint {
      margin-top: 10px;
      font-size: 11px;
      color: #4d4d4d;
      line-height: 1.4;
    }
  `;

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = STYLES;
    (document.head || document.documentElement).appendChild(style);
  }

  function removeToast(opts) {
    const userInitiated = !!(opts && opts.userInitiated);
    const root = document.getElementById(ROOT_ID);

    // Tell the service worker to remember this dismissal for the current
    // tab + partner, so subsequent navigations within the same partner
    // site don't re-show the toast. Only fired on real user clicks —
    // programmatic removals (e.g. payload swap) must not persist.
    if (userInitiated) {
      const last = window.__benefitsNotifierLastPayload;
      if (last && typeof last.id === "string") {
        try {
          chrome.runtime
            .sendMessage({ type: "dismiss-toast", partnerId: last.id })
            .catch(() => {
              /* SW unreachable — best effort only */
            });
        } catch {
          /* extension context invalidated — ignore */
        }
      }
    }

    if (root && root.parentNode) {
      root.parentNode.removeChild(root);
    }
  }

  /**
   * Render or update the toast. Idempotent — calling twice with different
   * payloads updates the existing card.
   *
   * payload = {
   *   id: string,                       // partner id — used for dismissal tracking
   *   name: string,                     // display name
   *   fullUrl: string|null,             // composed offer URL (null if no subdomain)
   *   subdomainSet: boolean             // convenience flag
   * }
   */
  function render(payload) {
    if (!payload || typeof payload.name !== "string") return;
    ensureStyle();

    let root = document.getElementById(ROOT_ID);
    if (!root) {
      root = document.createElement("div");
      root.id = ROOT_ID;

      const card = document.createElement("div");
      card.className = "bw-card";

      // ---- Banner: slate gradient with logo, label, and close button ----
      const banner = document.createElement("div");
      banner.className = "bw-banner";

      const logo = document.createElement("img");
      logo.className = "bw-logo";
      logo.src = LOGO_URL;
      logo.alt = "corporate benefits";

      const bannerText = document.createElement("span");
      bannerText.className = "bw-banner-text";
      bannerText.textContent = "Benefits@Work";

      const close = document.createElement("button");
      close.className = "bw-close";
      close.type = "button";
      close.setAttribute("aria-label", "Dismiss");
      close.textContent = "✕";
      close.addEventListener("click", () => removeToast({ userInitiated: true }));

      banner.appendChild(logo);
      banner.appendChild(bannerText);
      banner.appendChild(close);

      // ---- Body: title, partner name, CTA, hint ----
      const body = document.createElement("div");
      body.className = "bw-body";

      const title = document.createElement("p");
      title.className = "bw-title";
      title.textContent = "Deal available";

      const partner = document.createElement("p");
      partner.className = "bw-partner";

      const actions = document.createElement("div");
      actions.className = "bw-actions";

      const cta = document.createElement("a");
      cta.className = "bw-cta";
      cta.target = "_blank";
      cta.rel = "noopener noreferrer";
      cta.textContent = "View on Benefits@Work →";

      actions.appendChild(cta);

      const hint = document.createElement("div");
      hint.className = "bw-hint";

      body.appendChild(title);
      body.appendChild(partner);
      body.appendChild(actions);
      body.appendChild(hint);

      card.appendChild(banner);
      card.appendChild(body);
      root.appendChild(card);
      // Insert into <html> rather than <body> — survives sites that
      // re-render <body> via SPA navigation.
      (document.documentElement || document.body).appendChild(root);
    }

    // Update fields.
    const partnerEl = root.querySelector(".bw-partner");
    const ctaEl = root.querySelector(".bw-cta");
    const hintEl = root.querySelector(".bw-hint");

    if (partnerEl) partnerEl.textContent = payload.name;

    if (payload.subdomainSet && payload.fullUrl) {
      ctaEl.setAttribute("href", payload.fullUrl);
      ctaEl.removeAttribute("aria-disabled");
      ctaEl.style.pointerEvents = "";
      hintEl.textContent = "";
      hintEl.style.display = "none";
    } else {
      ctaEl.removeAttribute("href");
      ctaEl.setAttribute("aria-disabled", "true");
      ctaEl.style.pointerEvents = "none";
      hintEl.textContent =
        "Set your platform subdomain in the extension popup to enable the deal link.";
      hintEl.style.display = "";
    }

    // Track latest payload so subdomain-updated messages can rebuild the URL.
    window.__benefitsNotifierLastPayload = payload;
  }

  // Expose the entry point used by the service worker.
  window.__benefitsNotifierShow = render;

  // Listen for subdomain updates pushed by the SW so an already-rendered toast
  // refreshes its link without a page reload.
  chrome.runtime.onMessage.addListener((msg) => {
    if (!msg || msg.type !== "subdomain-updated") return;
    const last = window.__benefitsNotifierLastPayload;
    if (!last) return;
    const sub = (msg.subdomain || "").trim().toLowerCase();
    if (sub && /^[a-z0-9][a-z0-9-]*$/.test(sub) && last.fullUrl) {
      // Rebuild URL by swapping the host portion.
      try {
        const u = new URL(last.fullUrl);
        u.hostname = `${sub}.benefitsatwork.be`;
        render({ ...last, fullUrl: u.toString(), subdomainSet: true });
      } catch {
        /* ignore */
      }
    } else if (!sub) {
      render({ ...last, fullUrl: null, subdomainSet: false });
    }
  });
})();
