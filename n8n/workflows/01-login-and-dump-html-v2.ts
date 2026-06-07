// n8n workflow v2: Step 1 of the Benefits@Work scraper.
//
// What changed from v1:
//   - responseFormat is forced to 'text' on both HTTP nodes, so we get
//     a string body even when n8n's autodetect would otherwise return a
//     buffer or empty string.
//   - The GET to / now uses followRedirects: false, so we observe the
//     unredirected response. This makes it obvious if the platform
//     bounces us to /login (=> still anonymous) versus serving the
//     homepage (=> authenticated).
//   - Adds an "Inspect login response" node that dumps headers, status,
//     content-type, content-length, body type, body length, body snippet,
//     and a heuristic "did login work?" flag. If login looks like it
//     failed (200 with email field), we know to fix credentials/headers.
//   - "Inspect homepage response" similarly dumps everything we need to
//     diagnose what /<root> returned with our cookie.
//   - Fixes a regex bug in v1 that always returned [] for sampleLinks.
//
// Workflow ID: HN0vbOkF0Zt2Arco (now archived on the n8n instance — the
//   production scraper has moved to 02-scraper.ts; this file is kept for
//   historical reference of the debugging session).

import { workflow, trigger, node, expr } from '@n8n/workflow-sdk';

const startTrigger = trigger({
  type: 'n8n-nodes-base.manualTrigger',
  version: 1,
  config: { name: 'Run', position: [240, 300] },
  output: [{}]
});

const loginRequest = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.2,
  config: {
    name: 'POST /login',
    parameters: {
      method: 'POST',
      url: 'https://ibmcic.benefitsatwork.be/login',
      sendHeaders: true,
      headerParameters: {
        parameters: [
          { name: 'User-Agent', value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36' },
          { name: 'Accept', value: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' },
          { name: 'Accept-Language', value: 'en,nl;q=0.9,fr;q=0.8' },
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
    },
    position: [540, 300]
  }
});

// (Code-node JS bodies omitted from this archive — see the live workflow.)
// See live workflow: https://n8n.qinclaes.dev/workflow/HN0vbOkF0Zt2Arco

export default workflow('benefits-step1-login-dump-v2', 'Benefits@Work — Step 1 (v2)')
  .add(startTrigger)
  .to(loginRequest);
