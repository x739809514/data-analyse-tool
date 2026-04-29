# 30 - Local Custom Schema AI Fix

## Problem

AI analysis in Local mode could generate SQL against empty built-in tables, such as:

```sql
SELECT user_id, MAX(progress) AS max_progress
FROM sessions
GROUP BY user_id
```

This happened even when the real synced data lived in `custom_sessions` with a field named `progresses`.

## Root Cause

The Local table list API displayed `custom_*` synced tables, but the Local schema used by AI analysis only included built-in tables from `listTables()`.

So the AI context showed empty built-in tables like `sessions(progress)` and did not show the actual local synced tables like `custom_sessions(progresses)`.

## Changes

- Local schema now includes local `custom_*` synced SQLite tables.
- SQL data context is sorted by `rowCount` so populated tables are more prominent.
- AI instructions now explicitly prefer non-empty tables and exact SQLite identifiers.
- The multi-step AI agent now rejects SQL that queries a 0-row table when a similar non-empty table exists.
- Local no-API fallback now chooses the most relevant populated session-like table and supports `progresses`.

## Verification

- `node --check server/game-logger-server.js`
- `node --check server/public/app.js`
- Started backend on temporary port `3111`.
- Verified `GET /api/db/schema` includes `custom_sessions(progresses)`.
- Verified fallback analysis for progress uses:

```sql
SELECT user_id, MAX("progresses") AS max_progress, COUNT(*) AS session_count
FROM "custom_sessions"
GROUP BY user_id
ORDER BY max_progress DESC
```

## Notes

Schema validation alone cannot catch this case because `sessions(progress)` is a real table and field. The issue was table selection, not SQL validity. The new populated-table guard makes this recoverable for AI-generated SQL.
