// n8n workflow: AI domain enrichment.
//
// Live workflow ID: hZ8RXCqu0NkYblga
// Live URL:         https://n8n.qinclaes.dev/workflow/hZ8RXCqu0NkYblga
// Authoritative copy for re-import: ./03-ai-enrichment.json
//
// Purpose:
//   - Either run manually, or be invoked at the end of the scraper workflow.
//   - Read every row in the partners Data Table that has a real name (skip 'Unknown').
//   - For each row, ask Claude Haiku (via the IBM ICA OpenAI-compatible
//     gateway) to produce the FINAL list of consumer-facing domains, given
//     the partner's name, category, and any domains the scraper already found.
//   - The agent has explicit rules for affiliate-domain pruning, .com/.be/.nl/.fr
//     national TLD expansion, regional-only Belgian businesses, and gift cards.
//   - Output is parsed into {"domains":[...]} via a structured output parser.
//   - The cleaned list is upserted back into domains_auto on the same row.
//
// Auth model:
//   - The "Claude Haiku (ICA)" node uses an OpenAI-compatible credential
//     (configured on the credential record itself: base URL = ICA gateway,
//     API key = ICA token). Model name "claude-haiku-4-5" is set on the node.
//   - Data Table reads/writes use env var N8N_API_KEY in X-N8N-API-KEY.
//
// Hardcoded values to update on re-import:
//   - n8n instance host  "n8n.qinclaes.dev"  (in Data Table API URLs)
//   - Data Table ID      "AszlR72OLpvemUAf"  (in fetch + upsert nodes)

import { workflow, trigger, node } from '@n8n/workflow-sdk';

const manualTrigger = trigger({
  type: 'n8n-nodes-base.manualTrigger',
  version: 1,
  config: { name: 'Run AI enrichment', position: [240, 300] },
  output: [{}]
});

const subWorkflowTrigger = trigger({
  type: 'n8n-nodes-base.executeWorkflowTrigger',
  version: 1,
  config: { name: 'Called from another workflow', position: [240, 480] },
  output: [{}]
});

const fetchAllRows = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Fetch all rows',
    position: [540, 300],
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: `const TABLE_ID = 'AszlR72OLpvemUAf';
const API_KEY = $env.N8N_API_KEY || '';
const BASE = 'https://n8n.qinclaes.dev/api/v1/data-tables/' + TABLE_ID + '/rows';
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
const candidates = allRows.filter(r => r && r.name && r.name !== 'Unknown');
console.log('Total rows: ' + allRows.length + ', candidates: ' + candidates.length);
return candidates.map(r => ({ json: r }));`
    }
  }
});

const splitInBatches = node({
  type: 'n8n-nodes-base.splitInBatches',
  version: 3,
  config: {
    name: 'Per-row AI enrichment',
    position: [840, 300],
    parameters: { batchSize: 1 }
  }
});

const aiAgent = node({
  type: '@n8n/n8n-nodes-langchain.agent',
  version: 3.1,
  config: {
    name: 'AI domain agent',
    position: [1140, 300],
    parameters: {
      promptType: 'define',
      hasOutputParser: true,
      systemMessage: `You are a domain-resolution assistant for a Chrome extension that detects when users visit partner sites of a Belgian employee-benefits platform. Given a partner's name, category, and the list of domains currently on file (may be empty), produce the FINAL list of consumer-facing domains where Belgian users would actually shop for this brand.

Rules:
(1) Keep current domains that genuinely belong to this brand. Drop affiliate/tracking domains (e.g. go.nordvpn.net, simplebooking.it, wbiprod.storedvalue.com).
(2) Add national TLD variants (.com, .be, .nl, .fr) where the brand has them and Belgian users would plausibly browse them.
(3) For Belgian regional/local-only businesses (gyms, restaurants, single-shop boutiques) with no international presence, keep only the extracted domain (or empty if none).
(4) For known international brands, always include .com if it exists.
(5) For gift card offers, use the parent brand's main consumer domain.
(6) If you genuinely cannot identify the brand and the input domains list is empty, return [].
(7) Output ONLY the JSON object {"domains": [...]} with bare registrable domains: no protocol, no www., no path, lowercase. Maximum 5 domains.`,
      text: `=Partner name: {{ $json.name }}
Category: {{ $json.primary_category }}
Currently stored domains: {{ $json.domains_auto || '[]' }}

Return the final domain list as JSON: {"domains":[...]}.`
    }
  }
});

const llmNode = node({
  type: '@n8n/n8n-nodes-langchain.lmChatOpenAi',
  version: 1.3,
  config: {
    name: 'Claude Haiku (ICA)',
    position: [1140, 500],
    parameters: {
      // Wrapped in {{ … }} because the node's UI evaluates the model field as an expression.
      model: '={{ "claude-haiku-4-5" }}',
      temperature: 0,
      maxTokens: 200
    }
    // credentials: openAiApi credential pointing at the IBM ICA gateway, configured at import time.
  }
});

const outputParser = node({
  type: '@n8n/n8n-nodes-langchain.outputParserStructured',
  version: 1.3,
  config: {
    name: 'Parser',
    position: [1340, 500],
    parameters: {
      schemaType: 'fromJson',
      jsonSchemaExample: '{ "domains": ["rcn.nl", "rcn.be"] }'
    }
  }
});

const upsertAIDomains = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Upsert AI domains',
    position: [1640, 300],
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: `const ai = items[0].json;
const aiDomains = Array.isArray(ai.domains) ? ai.domains : (Array.isArray(ai.output?.domains) ? ai.output.domains : []);
const cleaned = aiDomains.map(s => {
  let d = String(s||'').trim().toLowerCase();
  d = d.replace(/^https?:\\/\\//, '').replace(/^www\\./, '').split('/')[0].split(':')[0];
  return d;
}).filter(d => /^[a-z0-9][a-z0-9.-]*\\.[a-z]{2,}$/.test(d)).slice(0, 5);

const offer = $('Per-row AI enrichment').item.json;
const TABLE_ID = 'AszlR72OLpvemUAf';
const N8N_KEY = $env.N8N_API_KEY || '';
const TBL = 'https://n8n.qinclaes.dev/api/v1/data-tables/' + TABLE_ID;
const now = new Date().toISOString();
try {
  await this.helpers.request({
    method: 'POST', uri: TBL + '/rows/upsert',
    headers: { 'X-N8N-API-KEY': N8N_KEY, 'Content-Type': 'application/json' },
    body: {
      filter: { filters: [{ columnName: 'offer_id', value: offer.offer_id, condition: 'eq' }] },
      data: { domains_auto: JSON.stringify(cleaned), domain_resolved_at: now }
    },
    json: true, simple: false, timeout: 15000
  });
} catch (err) {
  return [{ json: { offer_id: offer.offer_id, name: offer.name, error: String(err.message||err).slice(0,200), aiDomains, cleaned } }];
}
return [{ json: { offer_id: offer.offer_id, name: offer.name, action: 'enriched', domains: cleaned } }];`
    }
  }
});

const logSummary = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Log enrichment summary',
    position: [1940, 300],
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: `const enriched = items.filter(i => i.json.action === 'enriched').length;
const withDomains = items.filter(i => Array.isArray(i.json.domains) && i.json.domains.length > 0).length;
const errors = items.filter(i => i.json.error).length;
console.log('Enrichment done: total=' + items.length + ' enriched=' + enriched + ' withDomains=' + withDomains + ' errors=' + errors);
return [{ json: { total: items.length, enriched, withDomains, errors, runDate: new Date().toISOString() } }];`
    }
  }
});

export default workflow('benefits-ai-enrichment', 'Benefits@Work — AI domain enrichment')
  .add(manualTrigger)
  .add(subWorkflowTrigger)
  .to(fetchAllRows)
  .to(splitInBatches)
  // splitInBatches output 1 -> aiAgent (-> Claude Haiku as ai_languageModel, Parser as ai_outputParser)
  //                          -> upsertAIDomains -> back into splitInBatches
  // splitInBatches output 0 -> logSummary
  .to(aiAgent)
  .to(llmNode)
  .to(outputParser)
  .to(upsertAIDomains)
  .to(logSummary);
