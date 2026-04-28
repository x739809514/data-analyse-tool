# 20 Readable Remote Times

Date: 2026-04-28

## Problem

Remote mirror time fields were converted into millisecond timestamps. This made calculations possible, but table browsing was not user-friendly because users expected readable date-time values.

## Change

Remote mirror time fields are now normalized to:

```text
YYYY-MM-DD HH:mm:ss
```

Covered fields:

- `remote_users.created_at`
- `remote_sessions.start_time`
- `remote_sessions.end_time`
- `remote_coffee_sessions.start_time`
- `remote_coffee_sessions.end_time`
- `remote_plant_sessions.start_time`
- `remote_plant_sessions.end_time`

The normalizer accepts:

- numeric timestamps
- numeric timestamp strings
- `YYYY-MM-DD HH:mm:ss`
- ISO-like strings

## AI Guidance

Synced remote schemas now describe time fields as:

```text
TEXT datetime YYYY-MM-DD HH:mm:ss
```

AI SQL prompts instruct duration calculations to use:

```sql
strftime('%s', end_time) - strftime('%s', start_time)
```

## Verification

```bash
node --check server/game-logger-server.js
node --check server/public/app.js
```

