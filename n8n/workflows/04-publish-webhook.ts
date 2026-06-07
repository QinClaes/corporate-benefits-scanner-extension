// n8n workflow: Public publish webhook.
//
// Live workflow ID: 0s5zRkxl2B0wbtbp
// Live URL:         https://n8n.example.com/workflow/0s5zRkxl2B0wbtbp
// Public endpoint:  https://n8n.example.com/webhook/benefits-partners
// Authoritative copy for re-import: ./04-publish-webhook.json
//
// Purpose:
//   - Serve the partner list as JSON, consumed by the Chrome extension's
//     lib/sync.js on a 24h alarm + on first install + on user "Sync now".
//   - Reads the partners Data Table, filters to status === 'active', drops
//     partners with empty domains arrays, sorts alphabetically by name,
//     wraps in { version, fetchedAt, partnerCount, partners } and responds.
//
// Response contract (consumed by lib/sync.js:fetchPartners):
//   {
//     "version": 1,
//     "fetchedAt": "<ISO 8601>",
//     "partnerCount": <int>,
//     "partners": [
//       {
//         "id": "<offer_id as string>",
//         "name": "<string>",
//         "offerPath": "/offer/.../cat/...",
//         "primaryCategory": "<string>",
//         "logoUrl": "<string|null>",
//         "domains": ["registrable.tld", ...]
//       }
//     ]
//   }
// If you change this shape, update lib/sync.js:fetchPartners to match.
//
// Auth model:
//   - The webhook itself has no authentication (public). CORS is wide-open
//     (Access-Control-Allow-Origin: *) so the popup can hit it from any origin.
//   - Data Table reads use env var N8N_API_KEY.
//
// Hardcoded values to update on re-import:
//   - n8n instance host  "n8n.example.com"  (in Data Table API URL)
//   - Data Table ID      "AszlR72OLpvemUAf"  (in "Read partners table" node)
//   - Webhook path       "benefits-partners" (matches lib/sync.js DEFAULT_SYNC_ENDPOINT)

import { workflow, trigger, node, expr } from '@n8n/workflow-sdk';

const webhookTrigger = trigger({
  type: 'n8n-nodes-base.webhook',
  version: 2.1,
  config: {
    name: 'GET /benefits-partners',
    position: [240, 300],
    parameters: {
      httpMethod: 'GET',
      path: 'benefits-partners',
      responseMode: 'responseNode',
      options: {}
    },
    webhookId: '6c0cc228-4aa7-4ebf-a611-3f0c6d713561'
  },
  output: [{}]
});

const readPartners = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Read partners table',
    position: [540, 300],
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: `const TABLE_ID = 'AszlR72OLpvemUAf';
const API_KEY = $env.N8N_API_KEY || '';
const BASE = 'https://n8n.example.com/api/v1/data-tables/' + TABLE_ID + '/rows';
let allRows = [];
let cursor = null;
let safety = 0;
while (safety < 50) {
  const url = BASE + (cursor ? ('?cursor=' + encodeURIComponent(cursor)) : '');
  const res = await this.helpers.request({
    method: 'GET', uri: url,
    headers: { 'X-N8N-API-KEY': API_KEY, 'Accept': 'application/json' },
    json: true, simple: false, resolveWithFullResponse: false, timeout: 15000
  });
  const rows = (res && res.data) || [];
  allRows = allRows.concat(rows);
  cursor = (res && res.nextCursor) || null;
  if (!cursor) break;
  safety++;
}
return [{ json: { rows: allRows, count: allRows.length } }];`
    }
  }
});

const buildResponse = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Build JSON response',
    position: [840, 300],
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: `const rows = items[0].json.rows || [];
const partners = rows
  .filter(r => r && r.status === 'active')
  .map(r => {
    let domains = [];
    try {
      const auto = r.domains_auto ? JSON.parse(r.domains_auto) : [];
      domains = Array.isArray(auto) ? auto : [];
    } catch { domains = []; }
    return {
      id: String(r.offer_id),
      name: r.name || '',
      offerPath: r.offer_path || '',
      primaryCategory: r.primary_category || '',
      logoUrl: r.logo_url || null,
      domains
    };
  })
  .filter(p => p.domains.length > 0)
  .sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
return [{ json: { version: 1, fetchedAt: new Date().toISOString(), partnerCount: partners.length, partners } }];`
    }
  }
});

const respond = node({
  type: 'n8n-nodes-base.respondToWebhook',
  version: 1.1,
  config: {
    name: 'Respond with partners JSON',
    position: [1140, 300],
    parameters: {
      respondWith: 'json',
      responseBody: expr('{{ JSON.stringify($json) }}'),
      options: {
        responseHeaders: {
          entries: [
            // 6h browser cache. The extension also caches in chrome.storage.local
            // and re-syncs on a 24h chrome.alarm.
            { name: 'Cache-Control', value: 'public, max-age=21600' },
            { name: 'Content-Type', value: 'application/json; charset=utf-8' },
            { name: 'Access-Control-Allow-Origin', value: '*' }
          ]
        }
      }
    }
  }
});

export default workflow('benefits-publish-webhook', 'Benefits@Work — Publish Webhook')
  .add(webhookTrigger)
  .to(readPartners)
  .to(buildResponse)
  .to(respond);
