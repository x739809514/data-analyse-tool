# 26 Local Table Display Audit

Date: 2026-04-28

## Problem

After converting Custom Worker data into real SQLite `custom_*` tables, Local mode table display was abnormal.

## Root Cause

Two issues were found:

1. `listTables()` included real `custom_*` tables, then Local mode also appended custom cache tables from sync metadata. This could duplicate or confuse table list output.
2. The Local custom rows route still called the removed helper `getLocalCustomCacheSourceTable()`, causing row fetch errors for `custom_*` tables.

## Fix

- Exclude `custom_%` from the base local `listTables()` query.
- Append custom tables only through `listLocalCustomCacheTables()`.
- Update Local custom schema/rows routes to use real table names directly.

## Verified

Started a fresh temporary server on port `3106` and checked:

```text
GET /api/db/tables
GET /api/db/tables/custom_comments/rows?page=1&limit=2
POST /api/db/query
```

Results:

- Local table list includes core tables plus `custom_comments`, `custom_sessions`, `custom_users`.
- `custom_comments` rows return successfully.
- SQL works against `custom_comments`.

## Syntax Checks

```bash
node --check server/game-logger-server.js
node --check server/public/app.js
```

