# 27 Smarter AI SQL Agent

Date: 2026-04-28

## Problem

The AI felt weak because the previous flow only asked for one SQL plan with schema. It did not provide samples or field distributions, and SQL failures were not repaired automatically.

## Changes

### Data Context

AI SQL planning now receives:

- table schemas
- table row counts
- sample rows
- per-column distinct counts
- top example values

This gives the model enough context to infer field meaning, value ranges, and useful groupings.

### SQL Repair Loop

For configured AI providers:

1. Generate SQL plan.
2. Execute SQL.
3. If SQL fails, send error + prior SQL back to AI for repair.
4. If the first query returns 0 rows, ask AI for a broader or better query once.
5. Retry up to 3 total attempts.

### Source Safety

For synced remote/custom sources, backend enforces:

```sql
source_url = '<active source URL>'
```

This prevents accidental cross-source analysis.

### Chart Validation

Charts are now validated before returning to frontend. Invalid chart JSON falls back to generated ECharts config when chart output was requested.

### Gemini

Gemini 3 models now receive:

```json
{
  "thinkingConfig": {
    "thinkingLevel": "high"
  }
}
```

## Validation

```bash
node --check server/game-logger-server.js
node --check server/public/app.js
```

Smoke-tested:

- AI fallback endpoint.
- SQL query against `custom_comments`.

