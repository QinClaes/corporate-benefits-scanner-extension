# n8n/workflows

Each production workflow is exported in two formats:

- **`.json`** — direct re-import into n8n via *Workflows → Import from File*. This is the source of truth.
- **`.ts`** — readable archive in a homegrown SDK style. Useful for code review / diff. **Not directly importable** into n8n; the SDK referenced in the imports does not exist as an npm package — it's a documentation convention, kept for legibility.

| File | Original workflow ID | Status |
|---|---|---|
| `02-scraper.json` + `.ts` | `NFJp7ok1KAJiATza` | Production (active) |
| `03-ai-enrichment.json` + `.ts` | `hZ8RXCqu0NkYblga` | Production (active) |
| `04-publish-webhook.json` + `.ts` | `0s5zRkxl2B0wbtbp` | Production (active) |
| `01-login-and-dump-html.ts` | (early research draft, never deployed) | Archive |
| `01-login-and-dump-html-v2.ts` | `HN0vbOkF0Zt2Arco` | Archived on n8n |

The JSON exports were generated on **2026-06-03** by pulling the live workflow JSON via the n8n MCP and stripping local-only fields (workflow IDs, version IDs, timestamps, credential references). They will import as **inactive** so you can review and configure before turning them on.

For setup steps, env vars, the Data Table schema, and re-import order, see `../README.md`.
