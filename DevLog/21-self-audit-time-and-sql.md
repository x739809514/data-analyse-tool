# 21 Self Audit Time And SQL

Date: 2026-04-28

## Scope

Reviewed backend and frontend consistency around:

- Time display.
- Remote sync mirror schema.
- SQL execution after remote sync.
- AI SQL prompt behavior.
- Table listing behavior.

## Findings And Fixes

### Synced Remote SQL

Problem: synced remote data lives in local SQLite, but SQL Run was still disabled for HTTP data sources.

Fix:

- SQL Run is enabled when the current remote source has been synced.
- The editor auto-fills queries like:

```sql
SELECT * FROM "remote_sessions"
WHERE source_url = '...'
LIMIT 50
```

- Backend allows SQL for synced remote sources.
- Backend rejects synced remote SQL unless it filters by the active `source_url`.

### Time Display

Problem: time values could be stored or displayed inconsistently.

Fix:

- Remote mirror sync normalizes time fields to `YYYY-MM-DD HH:mm:ss`.
- Frontend formats numeric time columns into `YYYY-MM-DD HH:mm:ss` for display.
- Synced remote schema reports time columns as `TEXT datetime YYYY-MM-DD HH:mm:ss`.
- AI prompt tells models to use `strftime('%s', end_time) - strftime('%s', start_time)` for duration calculations.

### Internal Tables

Problem: local SQLite mode exposed internal `remote_*` tables alongside core tables.

Fix:

- Default local table listing now hides `remote_*`.
- Remote mirror tables appear when using a synced remote source.

## Verification

```bash
node --check server/game-logger-server.js
node --check server/public/app.js
```

Checked local SQLite sample:

```json
{
  "start_time": "2026-04-28 13:58:02",
  "end_time": "2026-04-28 13:58:06"
}
```

