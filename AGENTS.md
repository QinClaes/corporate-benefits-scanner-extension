# AGENTS.md — Benefits@Work Notifier

Orientation file for AI assistants and human contributors. Keep it short, fact-dense, and updated when the architecture changes.

## What this project is

A Chrome / Firefox MV3 extension (vanilla JS, no build step) plus a self-hosted n8n backend.

When a user visits a partner site of `<TENANT>.benefitsatwork.be` (e.g. `ibmcic.benefitsatwork.be`), the extension shows a Honey-style toast in the bottom-right that deep-links to the matching offer page on the user's company portal. The list of partners + their merchant domains is scraped weekly from the platform by an n8n workflow, enriched with Claude Haiku for national-TLD variants, and served to the extension via a public webhook.

Canonical tenant in this repo: **`ibmcic`** (IBM CIC). The extension is tenant-agnostic — users set their subdomain in the popup.

The codebase is shared between Chrome and Firefox; only the manifest file differs (see "Repo map" below). Firefox target version is **121+** so we can keep ESM imports in the background script (`"type": "module"` is supported on `background.scripts` from FF 121).

## Repo map

```
benefits-notifier/
├── manifest.json              Chrome MV3 manifest. Background as `service_worker` (module). Version of record for the whole project — see "Don't break these contracts".
├── manifest.firefox.json      Firefox 121+ MV3 manifest. Same shape, but background uses `scripts: ["service-worker.js"]` with `"type": "module"`, plus the required `browser_specific_settings.gecko.id` (`benefits-notifier@qinclaes.dev`) and `strict_min_version: "121.0"`. To load: copy the repo to a scratch dir, rename this file → `manifest.json`, then `about:debugging` → "Load Temporary Add-on…".
├── service-worker.js          Background SW: tab evaluation, badge, content-script injection, alarm-driven sync.
├── content.js                 Toast renderer; idempotent; classic script (no imports).
├── lib/
│   ├── matcher.js             Hostname normalization + suffix-match + URL composition.
│   └── sync.js                chrome.storage caching of partner list; fetch from n8n webhook; bundled-seed fallback.
├── popup/
│   ├── popup.html             Subdomain field + "Sync now" + current-tab card + partner list.
│   ├── popup.css              Carbon-ish slate/tan palette sampled from ibmcic.benefitsatwork.be.
│   └── popup.js               ESM; reads/writes storage; talks to SW via runtime.sendMessage.
├── data/
│   └── offers.js              Bundled seed of 10 partners. Used only when the webhook has never succeeded.
├── assets/
│   ├── logo.png               Toast logo (web_accessible_resource).
│   └── icons/icon-{16,48,128}.png    Toolbar icons.
├── n8n/
│   ├── README.md              How the n8n side works + how to re-import on a fresh instance.
│   ├── .env.example           Required env vars.
│   ├── workflows/
│   │   ├── README.md          Index of the .json + .ts files in this directory.
│   │   ├── 01-login-and-dump-html.ts        Archive: research-only login + dump.
│   │   ├── 01-login-and-dump-html-v2.ts     Archive: debug-improved version (live ID HN0vbOkF0Zt2Arco, now archived on n8n).
│   │   ├── 02-scraper.json + .ts            PRODUCTION: weekly scraper + AI trigger.
│   │   ├── 03-ai-enrichment.json + .ts      PRODUCTION: Claude Haiku domain resolver.
│   │   └── 04-publish-webhook.json + .ts    PRODUCTION: public GET /webhook/benefits-partners.
│   └── research/              Self-gitignored. Local HTML dumps + offline parser harness.
├── README.md                  User-facing project docs.
├── RELEASING.md               Maintainer checklist for cutting a tagged release.
├── .github/
│   └── workflows/
│       └── release.yml        Tag push (`v*.*.*`) → build .zip + .xpi → GitHub Release.
└── AGENTS.md                  This file.
```

## Architecture in 5 lines

1. `chrome.tabs.onUpdated` (and friends) → `service-worker.js` looks up the hostname in `partnersCache`.
2. `partnersCache` is hydrated by `lib/sync.js` from the n8n webhook (cached in `chrome.storage.local`), with `data/offers.js` as a bundled fallback.
3. On match, the SW sets the badge `"✓"`, injects `content.js`, and calls `window.__benefitsNotifierShow(payload)`.
4. `content.js` renders a fixed-position toast linking to `https://<subdomain>.benefitsatwork.be<offerPath>`.
5. The popup lets the user set the subdomain and trigger a manual sync; both broadcast via `chrome.storage.onChanged` so the SW + open tabs react live.

A `chrome.alarms.create("refresh-partners", { periodInMinutes: REFRESH_PERIOD_MINUTES })` fires every 24 h and re-runs `syncNow()`.

## Two halves you can edit independently

- **The extension** — vanilla MV3, no build. Edit and reload via `chrome://extensions` → "Reload" on the Benefits@Work Notifier card. No npm install at the root.
- **The n8n backend** — see `n8n/README.md`. Workflows are versioned as both JSON (importable) and `.ts` (readable archive).
- **Releases** — push a `v*.*.*` tag to GitHub and `.github/workflows/release.yml` builds `benefits-notifier-chrome.zip` and `benefits-notifier-firefox.xpi` and attaches them to a GitHub Release. No build step is involved; the workflow only zips files and renames `manifest.firefox.json` → `manifest.json` for the Firefox artifact. See `RELEASING.md` for the maintainer checklist.

## Don't break these contracts

- **Webhook response shape** — consumed by `lib/sync.js:fetchPartners`:
  ```json
  { "version": 1, "fetchedAt": "...", "partnerCount": N,
    "partners": [{ "id": "...", "name": "...", "offerPath": "/...", "primaryCategory": "...", "logoUrl": "...|null", "domains": ["..."] }] }
  ```
  If you change this in `04-publish-webhook.*`, update `fetchPartners` to match.
- **Storage keys** — `subdomain`, `syncEndpoint`, `partners`, `syncedAt`, `syncError`, `syncCount`, plus session-only `lastPartner`. Documented in `README.md` §How it works.
- **Subdomain regex** — `/^[a-z0-9][a-z0-9-]*$/`. Used by both the popup validator (`isValidSubdomain`) and the URL composer (`composeOfferUrl`). Both must agree.
- **`composeOfferUrl(subdomain, offerPath)`** — requires `offerPath` to start with `/`. Returns `null` on any other input. Don't relax this without checking every caller.
- **Bundled seed (`data/offers.js`)** — read by `lib/sync.js:getEffectivePartners` only when no synced cache exists. If the seed schema changes, update the mapping in `getEffectivePartners`.
- **Idempotency in `content.js`** — the script self-guards via `window.__benefitsNotifierInstalled`. Multiple injections on the same tab are expected and must be safe.
- **Version is a single source of truth: `manifest.json` `"version"`.** `manifest.firefox.json` `"version"` MUST match (the release workflow fails the build otherwise). No other file embeds a version number — the README and AGENTS.md must NOT mention a specific version (`v0.2.1`, `v0.2.2`, etc.) anywhere except in illustrative examples inside `RELEASING.md`. Runtime code that wants to display the version (e.g. the popup subtitle in `popup/popup.html` / `popup/popup.js`) MUST read it via `chrome.runtime.getManifest().version` — never hardcode. If you find yourself writing `v0.X.Y` in user-facing prose or UI markup, stop and rephrase / refactor. Releases are surfaced via the `releases/latest/download/...` URLs in `README.md`, which always resolve to the most recent tag — that's the mechanism that keeps docs in sync.

## No-build promise

This repo runs as-is in Chrome and Firefox 121+. There is no transpiler, no bundler, no `npm install` at the root. The only tooling is `n8n/research/parse.mjs`, which uses jsdom and is run ad-hoc for offline parser testing — it's not part of any pipeline.

The release workflow in `.github/workflows/release.yml` does not break this promise: it only zips the existing source files and renames `manifest.firefox.json` → `manifest.json` for the Firefox artifact. No transpilation or bundling.

For Firefox, copy the repo to a scratch directory, rename `manifest.firefox.json` → `manifest.json`, then point `about:debugging` → "Load Temporary Add-on…" at it. The shared source files (`service-worker.js`, `content.js`, `lib/*`, `popup/*`, `data/*`, `assets/*`) are unchanged between targets.

## Sensitive values policy

Already exposed in this repo (and therefore safe to reference in new docs):
- `qinclaes.dev` — author's n8n host.
- `ibmcic` — canonical tenant subdomain.
- n8n workflow IDs `NFJp7ok1KAJiATza`, `hZ8RXCqu0NkYblga`, `0s5zRkxl2B0wbtbp`, `HN0vbOkF0Zt2Arco`.
- n8n Data Table ID `AszlR72OLpvemUAf`.
- IBM ICA gateway model name `claude-haiku-4-5`.

Never commit:
- Real platform email or password (use `BENEFITS_EMAIL` / `BENEFITS_PASSWORD` env vars in n8n).
- Real `CBG3FE` cookie values from a session.
- Real `N8N_API_KEY`, IBM ICA tokens, OpenAI keys, or any other API token.
- HTML dumps with personal data — `n8n/research/` is self-gitignored for this reason; keep it that way.

## Common-task recipes

- **Test the toast on a partner site (no n8n needed)**:
  1. Load unpacked from `chrome://extensions`.
  2. Open the popup → set subdomain to e.g. `ibmcic` → Save.
  3. The bundled seed (`data/offers.js`) covers adidas, garmin, expedia, kinepolis, dyson, sixt, philips, torfs, iciparisxl, hema. Visit any one of them (e.g. `https://www.adidas.com/`).
  4. Toast should appear bottom-right; badge should show `✓`.

- **Add a new offer manually for testing** — append to `data/offers.js` (id, name, offerPath, domains[]). Reload the extension. The seed only kicks in when the synced cache is empty; if it isn't, click "Sync now" then test, or open DevTools on the SW and `chrome.storage.local.clear()` and reload.

- **Force a sync** — popup → "Sync now". Or message the SW: `chrome.runtime.sendMessage({ type: "sync-now" })`. Or wait 24 h.

- **Change the webhook endpoint** — set `syncEndpoint` in storage (`chrome.storage.local.set({ syncEndpoint: "https://other..." })`) and click "Sync now". The default is `lib/sync.js:DEFAULT_SYNC_ENDPOINT`.

- **Regenerate research dumps** — see `n8n/research/NOTES.md`. Requires a fresh `CBG3FE` cookie from a logged-in browser session. Output is gitignored.

- **Edit / re-import an n8n workflow** — see `n8n/README.md`. JSON files are importable directly via the n8n UI ("Workflows → Import from File"). `.ts` files are readable archives only.

- **Cut a release** — see `RELEASING.md`. Three steps: bump `version` in **both** `manifest.json` and `manifest.firefox.json` (must match), commit on `main`, then `git tag v0.2.2 && git push origin main --tags`. The `.github/workflows/release.yml` workflow validates version parity and uploads `benefits-notifier-chrome.zip` + `benefits-notifier-firefox.xpi` to a GitHub Release.

## Known issues / drift

- `n8n/workflows/01-login-and-dump-html*.ts` are early-development archives. The production scraper is `02-scraper.*`. The v1/v2 archives have been updated to use the same env-var auth pattern as production but they still target the diagnostic flow (login + dump homepage), not the full crawl.
- `n8n/research/offers_all.json` is a snapshot from the cookie-based research session and is decoupled from the live Data Table; do not treat it as authoritative.
- The Data Table ID `AszlR72OLpvemUAf` is hardcoded inside three workflows' Code nodes. Anyone re-importing on a fresh n8n instance must update it (or refactor those nodes to read it from `$env`).
