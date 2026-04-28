# 18 Date String Time Sync

Date: 2026-04-28

## Problem

Worker session rows contained time fields in `raw_json`:

```json
{
  "start_time": "2026-04-28 13:58:02",
  "end_time": "2026-04-28 13:58:06"
}
```

The mirror sync code used `Number(value)`, which converts those date strings to `NaN`. As a result, `remote_sessions.start_time` and `remote_sessions.end_time` were stored as `NULL`.

## Change

Historical note: this step originally added `numberOrTimeOrNull()`. It was later replaced by the unified `dateStringOrNull()` rule in `DevLog/19-unified-remote-normalization.md` and `DevLog/20-readable-remote-times.md`.

Current behavior:

- Keeps numeric timestamps unchanged.
- Parses date strings such as `YYYY-MM-DD HH:mm:ss`.
- Stores normalized values as `YYYY-MM-DD HH:mm:ss`.

Updated sync mapping for:

- `remote_users.created_at`
- `remote_sessions.start_time`
- `remote_sessions.end_time`
- `remote_coffee_sessions.start_time`
- `remote_coffee_sessions.end_time`
- `remote_plant_sessions.start_time`
- `remote_plant_sessions.end_time`

## Backfill

On server startup, existing `remote_sessions` rows with missing `start_time` or `end_time` are backfilled from `raw_json`.

## Verification

```bash
node --check server/game-logger-server.js
node --check server/public/app.js
```
