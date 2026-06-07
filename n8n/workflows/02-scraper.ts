// n8n workflow: Step 2 of the Benefits@Work scraper.
//
// Live workflow ID: NFJp7ok1KAJiATza
// Live URL:         https://n8n.qinclaes.dev/workflow/NFJp7ok1KAJiATza
// Authoritative copy for re-import: ./02-scraper.json
//
// Purpose:
//   - Run weekly (Sundays 04:00 UTC) and on manual trigger.
//   - Log into ibmcic.benefitsatwork.be using BENEFITS_EMAIL/BENEFITS_PASSWORD env vars.
//   - Fan out across 11 categories (IDs hardcoded in "Extract session cookie").
//   - Parse offer cards out of each category overview page (3 passes).
//   - Deduplicate by offerId.
//   - For each unique offer: fetch its detail page, extract merchant domains
//     (favouring data-href= on the CTA, falling back to <a href> in the body),
//     and upsert a row into the partners Data Table via the n8n REST API.
//   - On completion, call the AI-enrichment workflow to fill in domains_auto
//     for rows that came back empty.
//
// Auth model:
//   - The platform login uses env vars BENEFITS_EMAIL and BENEFITS_PASSWORD
//     (NOT a credential record — earlier versions tried httpBasicAuth, which
//     bled into the form body in unexpected ways).
//   - The Data Table API calls use env var N8N_API_KEY in the X-N8N-API-KEY header.
//
// Important hardcoded values to update if you re-import elsewhere:
//   - Tenant subdomain   "ibmcic.benefitsatwork.be"  (in login URL + GET /overview/:catId + offer fetch)
//   - n8n instance host  "n8n.qinclaes.dev"          (in Data Table API URLs)
//   - Data Table ID      "AszlR72OLpvemUAf"          (in upsert + AI-enrichment fetch)
//   - AI workflow target "hZ8RXCqu0NkYblga"          (in "Trigger AI enrichment")

import { workflow, trigger, node, expr } from '@n8n/workflow-sdk';

const manualTrigger = trigger({
  type: 'n8n-nodes-base.manualTrigger',
  version: 1,
  config: { name: 'Manual Run', position: [240, 208] },
  output: [{}]
});

const weeklyTrigger = trigger({
  type: 'n8n-nodes-base.scheduleTrigger',
  version: 1.3,
  config: {
    name: 'Weekly Schedule',
    position: [240, 400],
    parameters: {
      rule: {
        interval: [
          { field: 'weeks', weeksInterval: 1, triggerAtDay: [0], triggerAtHour: 4, triggerAtMinute: 0 }
        ]
      }
    }
  },
  output: [{}]
});

const loginRequest = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.2,
  config: {
    name: 'POST /login',
    position: [544, 304],
    parameters: {
      method: 'POST',
      url: 'https://ibmcic.benefitsatwork.be/login',
      sendHeaders: true,
      headerParameters: {
        parameters: [
          { name: 'User-Agent', value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36' },
          { name: 'Accept', value: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' },
          { name: 'Accept-Language', value: 'nl,en;q=0.9' },
          { name: 'Origin', value: 'https://ibmcic.benefitsatwork.be' },
          { name: 'Referer', value: 'https://ibmcic.benefitsatwork.be/login' }
        ]
      },
      sendBody: true,
      contentType: 'form-urlencoded',
      bodyParameters: {
        parameters: [
          { name: 'loginData[email]', value: expr('{{ $env.BENEFITS_EMAIL }}') },
          { name: 'loginData[password]', value: expr('{{ $env.BENEFITS_PASSWORD }}') },
          { name: 'cbg3-submit', value: 'Inloggen' }
        ]
      },
      options: {
        redirect: { redirect: { followRedirects: false } },
        response: { response: { fullResponse: true, neverError: true, responseFormat: 'text' } },
        timeout: 30000
      }
    }
  }
});

const extractCookie = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Extract session cookie',
    position: [848, 304],
    parameters: {
      // Throws on any non-302 / no-cookie response. Emits one item per category (11 total).
      jsCode: `const item = items[0].json;
const headers = item.headers || {};
const raw = headers['set-cookie'] || headers['Set-Cookie'] || [];
const arr = Array.isArray(raw) ? raw : [raw];
let cbg3fe = null;
for (const line of arr) {
  const m = /(?:^|;\\s*)CBG3FE=([^;]+)/.exec(String(line));
  if (m) { cbg3fe = m[1]; break; }
}
const status = item.statusCode;
const location = (headers.location || headers.Location || '').trim();
const success = status === 302 && (location === '/' || location.startsWith('/?'));
if (!success || !cbg3fe) {
  const body = String(item.body || '').slice(0, 600);
  const errMatch = /class="[^"]*cbg3-form--error[^"]*"[^>]*>([^<]+)/.exec(body);
  throw new Error('Login failed. status=' + status + ' location=' + location + ' error=' + (errMatch ? errMatch[1].trim() : 'none') + ' bodySnippet=' + body.replace(/<[^>]+>/g,' ').replace(/\\s+/g,' ').trim().slice(0,200));
}
const CATEGORIES = [
  { id: 23, name: 'Travel' }, { id: 36, name: 'Leisure' }, { id: 35, name: 'Fashion' },
  { id: 1740, name: 'Sports' }, { id: 2814, name: 'Vouchers' }, { id: 42, name: 'Tickets' },
  { id: 37, name: 'Home' }, { id: 4428, name: 'Food' }, { id: 38, name: 'Electronics' },
  { id: 2795, name: 'Mobility' }, { id: 41, name: 'Regional' }
];
return CATEGORIES.map(cat => ({ json: { cbg3fe, catId: cat.id, catName: cat.name } }));`
    }
  }
});

const fetchOverviews = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'GET /overview/:catId',
    position: [1152, 304],
    parameters: {
      jsCode: `const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const results = [];
for (const it of items) {
  const { cbg3fe, catId, catName } = it.json;
  try {
    const res = await this.helpers.request({
      method: 'GET',
      uri: 'https://ibmcic.benefitsatwork.be/overview/' + catId,
      headers: {
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'nl,en;q=0.9',
        'Cookie': 'CBG3FE=' + cbg3fe
      },
      resolveWithFullResponse: true, followRedirect: false, simple: false, timeout: 60000
    });
    const html = String(res.body || '');
    results.push({ json: { cbg3fe, catId, catName, html, htmlLength: html.length, status: res.statusCode } });
  } catch (err) {
    results.push({ json: { cbg3fe, catId, catName, html: '', htmlLength: 0, error: String(err.message).slice(0, 300) } });
  }
}
return results;`
    }
  }
});

// Card-parsing JS body — see ./02-scraper.json for the source of truth.
// Three passes: (1) cbg3-list-item cards, (2) data-wt-teaser-tracking banners,
// (3) any remaining /offer/<id>/cat/<catId> links.
const parseCards = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Parse offer cards',
    position: [1440, 304],
    parameters: { jsCode: '/* see ./02-scraper.json — Parse offer cards node */' }
  }
});

const dedupe = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Deduplicate offers',
    position: [1744, 304],
    parameters: {
      jsCode: `const seen = new Set();
const unique = [];
for (const it of items) {
  const oid = it.json.offerId;
  if (!seen.has(oid)) { seen.add(oid); unique.push(it); }
}
console.log('Deduplicated: ' + items.length + ' -> ' + unique.length + ' unique offers');
return unique;`
    }
  }
});

const splitInBatches = node({
  type: 'n8n-nodes-base.splitInBatches',
  version: 3,
  config: {
    name: 'Process each offer',
    position: [2048, 304],
    parameters: { options: {} }
  }
});

// Per-offer worker — see ./02-scraper.json for the full JS body.
// Fetches the offer detail page, extracts merchant domains via data-href
// (CTA) and body <a href>, applies EXCLUDE / EXCL_PFX filters, then upserts
// the row into the partners Data Table via /api/v1/data-tables/<id>/rows/upsert.
const processOffer = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Process offer (fetch + extract + upsert)',
    position: [2352, 304],
    parameters: {
      mode: 'runOnceForAllItems',
      jsCode: '/* see ./02-scraper.json — Process offer (fetch + extract + upsert) node */'
    }
  }
});

const logSummary = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Log summary',
    position: [4144, 304],
    parameters: {
      jsCode: `const inserted = items.filter(i => i.json.action === 'inserted').length;
const updated = items.filter(i => i.json.action === 'updated').length;
const withDomains = items.filter(i => i.json.domains && i.json.domains.length > 0).length;
console.log('Scrape complete: ' + items.length + ' | inserted=' + inserted + ' updated=' + updated + ' with_domains=' + withDomains);
return [{ json: { total: items.length, inserted, updated, withDomains, runDate: new Date().toISOString() } }];`
    }
  }
});

const triggerAI = node({
  type: 'n8n-nodes-base.executeWorkflow',
  version: 1.2,
  config: {
    name: 'Trigger AI enrichment',
    position: [4444, 304],
    parameters: {
      source: 'database',
      // Replace with your local AI-enrichment workflow ID after re-import.
      workflowId: { value: 'hZ8RXCqu0NkYblga', mode: 'list', cachedResultName: 'Benefits@Work — AI domain enrichment' },
      mode: 'each',
      options: {}
    }
  }
});

export default workflow('benefits-scraper-weekly', 'Benefits@Work — Scraper (weekly)')
  .add(manualTrigger)
  .add(weeklyTrigger)
  .to(loginRequest)
  .to(extractCookie)
  .to(fetchOverviews)
  .to(parseCards)
  .to(dedupe)
  .to(splitInBatches)
  .to(processOffer)       // splitInBatches output 1 -> processOffer -> back to splitInBatches
  .to(logSummary)         // splitInBatches output 0 -> logSummary
  .to(triggerAI);
