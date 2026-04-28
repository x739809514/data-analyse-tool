# 19 Unified Remote Normalization

Date: 2026-04-28

## Problem

The date string fix needed to apply consistently to all remote mirror tables, not only `remote_sessions`.

## Change

Added centralized remote mirror mapping:

- `REMOTE_FIELD_ALIASES`
- `REMOTE_MIRROR_CONFIG`

Both sync inserts and startup backfill now use the same configuration.

Covered mirror tables:

- `remote_users`
- `remote_sessions`
- `remote_coffee_sessions`
- `remote_plant_sessions`

Covered normalized fields:

- ids
- user ids
- created time
- start time
- end time
- progress
- npc
- plant

Time fields use `dateStringOrNull()` everywhere, so numeric timestamps, numeric timestamp strings, and date strings are normalized to `YYYY-MM-DD HH:mm:ss`.

## Future Data Sources

Future source adapters should map their rows through the same `REMOTE_MIRROR_CONFIG` path before writing typed local SQLite columns. This keeps field parsing and backfill behavior consistent.

## Verification

```bash
node --check server/game-logger-server.js
node --check server/public/app.js
```
