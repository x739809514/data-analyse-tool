# 29 - SQL Schema Validator

## Goal

Reduce AI SQL mistakes where generated table names or field names do not match the actual synced SQLite schema.

## Changes

- Added a backend schema validation step before executing AI-generated SQL.
- The validator checks:
  - referenced `FROM` / `JOIN` table names
  - qualified column references like `sessions.progress`
  - simple bare column identifiers when no CTE is used
- Validation errors now include:
  - the unknown table/field
  - a closest-name suggestion when possible
  - the available schema whitelist
- The multi-step AI SQL agent receives validation failures as observations, so it can correct SQL and try again in the next step.
- CTE queries are handled more cautiously to avoid rejecting valid temporary CTE output fields.

## Reasoning

Prompt-only schema instructions are not reliable enough. Models can still hallucinate names or switch to common English names such as `session`, `progress`, `createdAt`, or `userId`.

The backend must be the source of truth. By validating generated SQL against the real schema before execution, the AI gets a precise correction signal instead of a vague SQLite failure or an empty result.

## Verification

- `node --check server/game-logger-server.js`
- `node --check server/public/app.js`
- Started backend on temporary port `3110`.
- Verified:
  - `GET /api/meta`
  - `GET /api/db/tables`
  - `POST /api/db/query`
  - `POST /api/ai/analyze` fallback path

## Notes

This does not make the model perfect. It makes mistakes recoverable. The AI can now see exactly which generated SQL identifiers are invalid and has the actual schema available for the next attempt.
