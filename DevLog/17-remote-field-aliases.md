# 17 Remote Field Aliases

Date: 2026-04-28

## Problem

Remote Worker data can use different field naming conventions from the local SQLite schema. For example:

- `start_time`
- `startTime`
- `StartTime`

The sync code only read snake_case keys, so typed mirror columns such as `start_time` and `end_time` could become `NULL` even though the original data existed in `raw_json`.

There was also a risk that session rows without an explicit `id` would use `user_id` as the fallback primary key, causing multiple sessions for one user to overwrite each other.

## Change

Added field alias mapping for synced mirror rows:

- user id: `user_id`, `userId`, `UserId`, `userID`, `owner`, `Owner`
- start time: `start_time`, `startTime`, `StartTime`, `started_at`, `startedAt`
- end time: `end_time`, `endTime`, `EndTime`, `ended_at`, `endedAt`
- progress: `progress`, `Progress`
- session id: `id`, `ID`, `session_id`, `sessionId`, `SessionId`

Session-like tables no longer use `user_id` as a fallback primary key. If no id exists, they use a per-sync row index key such as `sessions_42`.

## Added Diagnostics

Sync result and sync status now include a `quality` object showing how many rows have non-null values for important typed columns.

## Verification

```bash
node --check server/game-logger-server.js
node --check server/public/app.js
```

