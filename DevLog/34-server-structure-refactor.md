# 34 Server Structure Refactor

Date: 2026-04-30

## Context

`server/game-logger-server.js` had grown into a single file containing runtime configuration, database schema creation, Express routes, source synchronization, SQL validation, AI provider metadata, and log HTML rendering. This made the entrypoint harder to scan and increased the risk of unrelated edits affecting route behavior.

## Changes

- Added `server/src/config.js` for runtime configuration, data-directory setup, AI provider presets, and provider API key lookup.
- Added `server/src/schema.js` for SQLite table and index initialization.
- Added `server/src/logViews.js` for the legacy player-log HTML views.
- Added `server/src/utils.js` for shared parsing, escaping, quoting, and clamping helpers.
- Updated `server/game-logger-server.js` to import those extracted modules and keep the route orchestration in the main entrypoint.

## Compatibility Notes

- API routes, database table definitions, and default environment variable names are unchanged.
- The default SQLite database path still resolves to `server/data/game-logger.db`.
- The browser app remains served from `/app` and static assets remain under `/assets`.

## Verification

- Ran `node --check` on:
  - `server/game-logger-server.js`
  - `server/src/config.js`
  - `server/src/schema.js`
  - `server/src/logViews.js`
  - `server/src/utils.js`
- Started the server with `PORT=3099 node game-logger-server.js`.
- Verified `GET /health` returned `Game Logger Node.js + SQLite - OK`.
