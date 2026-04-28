# 01 Requirements And Plan

Date: 2026-04-28

## Goal

Build a small but usable game data analysis workspace on top of the existing Express + SQLite server.

The first version should let a user:

- Browse database tables and rows.
- Inspect table schema.
- Run safe read-only SQL.
- Ask an AI assistant to analyze game data.
- Let the assistant generate SQL, execute it safely, summarize the result, and return chart JSON.
- Render the chart inside the app.

## MVP Scope

Use the current Node.js service as the backend and serve a vanilla browser app from it. This keeps deployment simple for Cloudflare Worker-style HTTP endpoints or an Ali ECS server.

Supported in this pass:

- Local SQLite database through `better-sqlite3`.
- Table list API.
- Table schema API.
- Paginated table rows API.
- Read-only SQL API with statement validation.
- OpenAI-compatible AI provider.
- Provider presets for OpenAI, DeepSeek, Minimax, Claude, and Gemini.
- Browser workspace at `/app`.

Deferred:

- Direct MySQL/PostgreSQL connections.
- Remote HTTP source adapter.
- Stored encrypted provider credentials.
- User accounts and roles.
- Long-running background imports into DuckDB or local cache.

## Execution Order

1. Add DevLog and README.
2. Add database explorer and safe SQL API.
3. Add AI gateway and analysis orchestration.
4. Add frontend workspace.
5. Validate with syntax checks and available local tests.

