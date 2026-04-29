# 28 Multi Step SQL Agent

Date: 2026-04-29

## Problem

The previous AI flow was still weak because it asked the model to produce one SQL query and then summarize one result. Even with schema, samples, and retry, the model could not explore data like an analyst.

## Change

Configured AI providers now use a multi-step SQL agent loop.

The model can repeatedly request one safe SQL query at a time:

```json
{
  "done": false,
  "reason": "Need distribution of difficulty values",
  "sql": "SELECT difficulty, COUNT(*) AS count FROM custom_comments WHERE source_url = '...' GROUP BY difficulty"
}
```

The backend:

1. Validates the SQL is read-only.
2. Enforces `source_url` filtering for synced remote/custom sources.
3. Executes the query.
4. Returns rows, columns, row count, and errors as observations.
5. Lets the AI request another query.

The loop runs for up to 5 steps, then asks for a final answer if the model has not already provided one.

## Final Output

The final result includes:

- title
- analysis
- operation history
- result rows
- result columns
- optional validated ECharts chart

## Safety

The AI still cannot directly access the database. It can only request SQL through the backend's read-only validator.

## Validation

```bash
node --check server/game-logger-server.js
node --check server/public/app.js
```

Smoke-tested:

- AI fallback path.
- SQL against `custom_comments`.

