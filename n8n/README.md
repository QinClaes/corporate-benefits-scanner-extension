# n8n backend

Self-hosted n8n instance powering the partner list for the Benefits@Work Notifier Chrome extension.

- **Live instance**: configured at deploy time; see `lib/sync.js:DEFAULT_SYNC_ENDPOINT` in the extension for the host the published artifact actually hits.
- **Public endpoint** (consumed by the extension): `GET /webhook/benefits-partners` on the live n8n instance. Workflow exports use `n8n.example.com` as a placeholder host.
- **n8n version family**: 1.x (Code node v2, Webhook node v2.1, scheduleTrigger v1.3, langchain.agent v3.1)

This directory contains:

| Path | What it is |
|---|---|
| `README.md` (this file) | Setup, contracts, gotchas. |
| `.env.example` | Env vars n8n needs at runtime. No values committed. |
| `workflows/` | Each production workflow as `.json` (importable) and `.ts` (readable archive). |
| `research/` | One-off scrape from the cookie-based research session. **Self-gitignored** (only `.gitignore` is tracked). Contains HTML dumps, an offline parser harness (`parse.mjs`), and `NOTES.md` documenting the platform's auth + DOM. |

## Workflows

| File | Live ID | Active? | Trigger | Purpose |
|---|---|---|---|---|
| `workflows/02-scraper.json` + `.ts` | `NFJp7ok1KAJiATza` | yes | Manual + Sundays 04:00 UTC | Login → fan out across 11 categories → parse offer cards → for each offer fetch detail page + extract domains → upsert to `partners` Data Table → trigger AI enrichment. |
| `workflows/03-ai-enrichment.json` + `.ts` | `hZ8RXCqu0NkYblga` | yes | Manual + sub-workflow | For each partner row, ask Claude Haiku for the final consumer-facing domain list (national-TLD expansion, affiliate pruning, gift-card normalization). Writes back to `domains_auto`. |
| `workflows/04-publish-webhook.json` + `.ts` | `0s5zRkxl2B0wbtbp` | yes | `GET /webhook/benefits-partners` (public, no auth) | Reads the `partners` Data Table, filters to `status='active'` rows with non-empty domains, returns the JSON contract consumed by `lib/sync.js`. |
| `workflows/01-login-and-dump-html.ts` | (research) | n/a | Manual | Archived first-draft of the login step. Dumps homepage HTML for inspection. |
| `workflows/01-login-and-dump-html-v2.ts` | `HN0vbOkF0Zt2Arco` (now archived on n8n) | no | Manual | Archived debug-improved version of v1. Some Code-node bodies were never exported. |

## Required credentials

| Credential name (suggested) | Type | Used by | Notes |
|---|---|---|---|
| _LLM Gateway_ (free choice) | `openAiApi` | `Claude Haiku` node in 03-ai-enrichment | Configure on the credential record: base URL = your OpenAI-compatible LLM gateway, API key = your provider's token. The model name (`claude-haiku-4-5`) is set on the node, not the credential. |

That's the only credential record needed. The platform login does **not** use a credential; it reads `$env.BENEFITS_EMAIL` / `$env.BENEFITS_PASSWORD` directly. The Data Table API uses `$env.N8N_API_KEY`.

## Required env vars

See `.env.example` for the full list. Set them on the n8n instance (e.g. via Docker `-e`, n8n's settings UI, or your hosting provider's env-var system) before running the workflows.

| Variable | Used in | Description |
|---|---|---|
| `BENEFITS_EMAIL` | 02-scraper, 01-archives | Platform login email (e.g. `me@example.com`). |
| `BENEFITS_PASSWORD` | 02-scraper, 01-archives | Platform login password. |
| `BENEFITS_PLATFORM_HOST` | 02-scraper | Full Benefits@Work URL of your tenant, e.g. `https://yourcompany.benefitsatwork.be`. Used for login + offer fetches. |
| `N8N_API_KEY` | 02-scraper, 03-ai-enrichment, 04-publish-webhook | n8n API token used to call `/api/v1/data-tables/<id>/rows` from inside Code nodes. Generate one at Settings → n8n API. |

## Required Data Table

Name: `partners`.
Live ID used in the workflow exports: `AszlR72OLpvemUAf` (hardcoded inside the workflows' Code nodes).

| Column | Type | Notes |
|---|---|---|
| `offer_id` | int | Unique key. Filtered against in upsert. |
| `name` | string | Brand name. |
| `offer_path` | string | `/offer/<offerId>/cat/<catId>` — no host prefix. |
| `cat_id` | int | Numeric category ID from the platform. |
| `primary_category` | string | Human-readable (Travel, Leisure, …). |
| `logo_url` | string | Optional. From `cdn.mitarbeiterangebote.de`. |
| `domains_auto` | string (JSON-stringified array) | Final domain list. Set by the scraper, refined by AI enrichment. |
| `domains_manual` | string (JSON-stringified array) | Reserved for manual overrides. Currently unused by the publish webhook (which reads only `domains_auto`). |
| `status` | string | `'active'` for rows the publish webhook should serve. |
| `last_seen_at` | ISO 8601 string | Updated each scrape. |
| `domain_resolved_at` | ISO 8601 string | Updated by both scraper and AI enrichment when domains change. |
| `notes` | string | Optional free-text. |

If you create the table from scratch, mirror these column names exactly — the workflows reference them by name.

## Webhook response contract

The Chrome extension (`lib/sync.js:fetchPartners`) expects:

```json
{
  "version": 1,
  "fetchedAt": "2026-06-03T12:00:00.000Z",
  "partnerCount": 42,
  "partners": [
    {
      "id": "10001",
      "name": "Adidas",
      "offerPath": "/offer/10001/cat/35",
      "primaryCategory": "Fashion",
      "logoUrl": "https://cdn.mitarbeiterangebote.de/...",
      "domains": ["adidas.com", "adidas.be"]
    }
  ]
}
```

Notes:
- `id` is a string (the Data Table stores it as int; `04-publish-webhook` casts via `String(...)`).
- `logoUrl` may be `null`.
- Partners with empty `domains` arrays are filtered out before responding.
- Sorted alphabetically by `name`.
- CORS is wide open (`Access-Control-Allow-Origin: *`) so the popup can fetch from any origin.
- Browser cache: `Cache-Control: public, max-age=21600` (6 h). The extension also caches independently in `chrome.storage.local` and re-syncs on a 24 h alarm.

If you change this shape, update `lib/sync.js:fetchPartners` validation to match.

## Re-importing on a fresh n8n instance

1. **Provision env vars**: `BENEFITS_EMAIL`, `BENEFITS_PASSWORD`, `BENEFITS_PLATFORM_HOST`, `N8N_API_KEY`.
2. **Create the `partners` Data Table** with the columns above. Copy its ID from the URL (`/data-tables/<ID>`).
3. **Create the OpenAI-compatible credential** for your LLM provider (any OpenAI-compatible chat-completions gateway will work).
4. **Import workflows in this order** (UI: Workflows → Import from File):
   1. `04-publish-webhook.json` — no other workflow depends on it; safe to import first.
   2. `03-ai-enrichment.json` — note its new workflow ID once imported.
   3. `02-scraper.json` — open the "Trigger AI enrichment" node and replace the cached workflow ID `hZ8RXCqu0NkYblga` with the ID from step 4.2.
5. **Replace the hardcoded Data Table ID** `AszlR72OLpvemUAf` in:
   - `02-scraper.json` → "Process offer (fetch + extract + upsert)" node, `TABLE_ID` constant.
   - `03-ai-enrichment.json` → "Fetch all rows" + "Upsert AI domains" nodes.
   - `04-publish-webhook.json` → "Read partners table" node.
6. **Replace the placeholder n8n base URL** `https://n8n.example.com` with your instance's URL in the same Code nodes (it's the prefix to `/api/v1/data-tables/...`).
7. **Activate** the publish-webhook workflow first (so the URL is live), then the AI-enrichment workflow (so the scraper can call it), then the scraper workflow.
8. **Trigger the scraper manually** once and watch the Executions tab. Expect ~700 offers and a single execution to take several minutes (it processes one offer at a time via splitInBatches).
9. **Update the Chrome extension** to point at your webhook: edit `lib/sync.js:DEFAULT_SYNC_ENDPOINT` (or set `syncEndpoint` in `chrome.storage.local` at runtime), and add your host to `manifest.json:host_permissions`.

## Updating partner data

| Action | How |
|---|---|
| Re-scrape now | Open `02-scraper` → click "Execute Workflow". |
| Re-run AI enrichment only | Open `03-ai-enrichment` → click "Execute Workflow" on the `Run AI enrichment` trigger. |
| Manually fix one partner's domains | Edit the row in the `partners` Data Table UI; set `domains_auto` to a JSON-stringified array. The publish webhook will pick it up on the next request. |
| Add a tenant other than the default | Set `$env.BENEFITS_PLATFORM_HOST` on your n8n instance to your tenant's full URL (e.g. `https://yourcompany.benefitsatwork.be`). The scraper reads it on every run. |

## Gotchas

- The platform expects the form field names `loginData[email]` and `loginData[password]` (with square brackets), plus `cbg3-submit=Inloggen`. See `research/NOTES.md`. An earlier version of the workflow used `email`/`password` and silently failed.
- The n8n Code-node sandbox does not expose the `URL` constructor. The scraper uses a manual regex (`/^https?:\/\/([^\/?#:]+)/`) for hostname extraction.
- AI enrichment uses `lmChatOpenAi` (not the dedicated Anthropic node) because any OpenAI-compatible chat-completions gateway can serve the model. Model name is set on the node as an expression: `={{ "claude-haiku-4-5" }}`.
- The publish webhook returns CORS `*`. If you ever put it behind auth, the extension will need updating (it currently sends only `Accept: application/json`).
