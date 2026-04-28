# 03 Backend Implementation

Date: 2026-04-28

## Added Routes

- `GET /app`: serves the browser workspace.
- `GET /api/meta`: returns database, provider, and query limit metadata.
- `GET /api/db/tables`: returns user tables, row counts, and column schemas.
- `GET /api/db/schema`: returns compact schema for AI prompting.
- `GET /api/db/tables/:table/schema`: returns one table schema.
- `GET /api/db/tables/:table/rows`: returns paginated rows.
- `POST /api/db/query`: runs validated read-only SQL.
- `POST /api/ai/analyze`: plans SQL, executes it, and returns analysis plus ECharts JSON.

## AI Provider Design

Provider presets are centralized in `getProviderPresets()`.

Implemented transport types:

- OpenAI-compatible chat completions: OpenAI, DeepSeek, Minimax.
- Anthropic messages: Claude.
- Gemini generateContent: Gemini.

If no API key/model is configured, `/api/ai/analyze` uses a local fallback plan so the product flow can still be tested.

## Validation Notes

`prepareReadOnlySql()` rejects:

- Empty SQL.
- Semicolons inside the statement.
- SQL comments.
- Write/schema keywords.
- Anything that does not begin with `SELECT` or `WITH`.

It wraps unlimited queries in an outer `SELECT * FROM (...) LIMIT n`.

