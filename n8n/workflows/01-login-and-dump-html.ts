// n8n workflow: Step 1 of the Benefits@Work scraper.
//
// Purpose:
//   - Log into ibmcic.benefitsatwork.be via form-POST.
//   - Capture the CBG3FE session cookie from the login response.
//   - Use that cookie to fetch the logged-in homepage.
//   - Emit the HTML and a few diagnostics so we can inspect what the
//     logged-in surface looks like.
//
// What we DO NOT do here:
//   - Parse offers (next workflow).
//   - Write to a Data Table (next workflow).
//   - Iterate categories (next workflow).
//
// Prerequisites in n8n:
//   - Set environment variables on the n8n instance:
//       BENEFITS_EMAIL    = your platform email
//       BENEFITS_PASSWORD = your platform password
//     (Earlier drafts of this workflow used an httpBasicAuth credential as
//     a two-string holder, but the credential values bled into the form body
//     in unexpected ways — the live production workflows now use $env vars.)
//   - The platform expects form fields named loginData[email] and
//     loginData[password] (with square brackets), plus cbg3-submit=Inloggen.
//     See n8n/research/NOTES.md.

import { workflow, trigger, node, expr } from '@n8n/workflow-sdk';

const startTrigger = trigger({
  type: 'n8n-nodes-base.manualTrigger',
  version: 1,
  config: { name: 'Run', position: [240, 300] },
  output: [{}]
});

// Step 1: POST /login with form-encoded credentials.
// We do NOT follow redirects so we can capture the Set-Cookie on the 302.
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
          {
            name: 'User-Agent',
            value:
              'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'
          },
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
        redirect: {
          redirect: {
            followRedirects: false
          }
        },
        response: {
          response: {
            fullResponse: true,
            responseFormat: 'autodetect',
            neverError: true
          }
        },
        timeout: 30000
      }
    },
    position: [540, 300]
  },
  output: [
    {
      statusCode: 302,
      headers: { 'set-cookie': ['CBG3FE=abc; path=/; HttpOnly; Secure'] },
      body: ''
    }
  ]
});

// Step 2: Extract the CBG3FE cookie value from the set-cookie header.
const extractCookie = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Extract CBG3FE cookie',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode:
        'const item = items[0].json;\n' +
        'const headers = item.headers || {};\n' +
        'const raw = headers["set-cookie"] || headers["Set-Cookie"] || [];\n' +
        'const arr = Array.isArray(raw) ? raw : [raw];\n' +
        'let cbg3fe = null;\n' +
        'for (const line of arr) {\n' +
        '  const m = /(?:^|;\\s*|,\\s*)CBG3FE=([^;]+)/.exec(line);\n' +
        '  if (m) { cbg3fe = m[1]; break; }\n' +
        '}\n' +
        'const status = item.statusCode;\n' +
        'const location = headers.location || headers.Location || null;\n' +
        'if (!cbg3fe) {\n' +
        '  throw new Error("Login did not return a CBG3FE cookie. status=" + status + " location=" + location + " body-snippet=" + JSON.stringify(String(item.body || "").slice(0, 400)));\n' +
        '}\n' +
        'return [{ json: { cbg3fe, loginStatus: status, loginLocation: location } }];'
    },
    position: [840, 300]
  },
  output: [{ cbg3fe: 'sessioncookie123', loginStatus: 302, loginLocation: '/' }]
});

// Step 3: Fetch the logged-in homepage with the cookie.
const fetchHome = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.2,
  config: {
    name: 'GET / (logged in)',
    parameters: {
      method: 'GET',
      url: 'https://ibmcic.benefitsatwork.be/',
      sendHeaders: true,
      headerParameters: {
        parameters: [
          {
            name: 'User-Agent',
            value:
              'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'
          },
          { name: 'Accept', value: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' },
          { name: 'Accept-Language', value: 'en,nl;q=0.9,fr;q=0.8' },
          { name: 'Cookie', value: expr('CBG3FE={{ $json.cbg3fe }}') }
        ]
      },
      options: {
        redirect: {
          redirect: {
            followRedirects: true,
            maxRedirects: 5
          }
        },
        response: {
          response: {
            fullResponse: true,
            responseFormat: 'autodetect',
            neverError: true
          }
        },
        timeout: 30000
      }
    },
    position: [1140, 300]
  },
  output: [
    {
      statusCode: 200,
      body: '<!DOCTYPE html>...html content...</html>',
      headers: { 'content-type': 'text/html; charset=utf-8' }
    }
  ]
});

// Step 4: Trim the result down to a tidy summary so the run log isn't unreadable.
const summarise = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Summarise homepage',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode:
        'const home = items[0].json;\n' +
        'const html = String(home.body || "");\n' +
        'const status = home.statusCode;\n' +
        'const loggedIn = !html.includes("Welkom!") && !html.includes("Aanmelden") && !html.toLowerCase().includes(\'name="email"\');\n' +
        'const titleMatch = /<title[^>]*>([\\s\\S]*?)<\\/title>/i.exec(html);\n' +
        'const title = titleMatch ? titleMatch[1].trim() : null;\n' +
        'const linkRe = /<a[^>]+href="(\\/(?:listings|offer|categor|cat)\\/[^"#?]*)"/gi;\n' +
        'const links = [];\n' +
        'const seen = new Set();\n' +
        'let m;\n' +
        'while ((m = linkRe.exec(html)) !== null && links.length < 60) {\n' +
        '  if (seen.has(m[1])) continue;\n' +
        '  seen.add(m[1]);\n' +
        '  links.push(m[1]);\n' +
        '}\n' +
        'return [{\n' +
        '  json: {\n' +
        '    status,\n' +
        '    htmlLength: html.length,\n' +
        '    title,\n' +
        '    loggedInGuess: loggedIn,\n' +
        '    sampleLinks: links,\n' +
        '    htmlSnippet: html.slice(0, 4000),\n' +
        '    htmlFull: html\n' +
        '  }\n' +
        '}];'
    },
    position: [1440, 300]
  },
  output: [
    {
      status: 200,
      htmlLength: 120000,
      title: 'Benefits at Work',
      loggedInGuess: true,
      sampleLinks: ['/listings/category/travel', '/offer/12345/cat/10'],
      htmlSnippet: '<!DOCTYPE html>...',
      htmlFull: '<!DOCTYPE html>...'
    }
  ]
});

export default workflow('benefits-step1-login-dump', 'Benefits@Work — Step 1: Login + Dump Homepage')
  .add(startTrigger)
  .to(loginRequest)
  .to(extractCookie)
  .to(fetchHome)
  .to(summarise);
