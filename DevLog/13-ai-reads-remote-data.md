# 13 AI Reads Remote Data

Date: 2026-04-28

## Problem

Remote HTTP data source analysis was limited to fixed fallback branches. That made it unable to answer more flexible questions such as proportions, pie charts, custom groupings, or multi-table comparisons.

## Change

When an AI provider and model are configured, remote Game Logger HTTP data source analysis now:

1. Fetches rows from remote endpoints:
   - `/users`
   - `/session`
   - `/coffee`
   - `/plant`
2. Sends schema, row summary, and fetched rows to the AI provider.
3. Asks AI to return JSON containing:
   - `title`
   - `analysis`
   - `operation`
   - `rows`
   - `columns`
   - optional `chart`
4. Renders the result table and optional chart in the app.

If no AI key/model is configured, the older local fallback remains available.

## Chart Behavior

Chart output is still intent-based:

- If the user asks for a chart, AI may return ECharts JSON.
- If the user does not ask for a chart, backend asks AI not to include chart output.

## Limits

The backend fetches up to `MAX_QUERY_ROWS` rows per remote table for AI analysis. If the remote data source has more rows than fetched, the prompt tells AI to mention that the analysis is based on the fetched subset.

## Verification

```bash
node --check server/game-logger-server.js
node --check server/public/app.js
```

