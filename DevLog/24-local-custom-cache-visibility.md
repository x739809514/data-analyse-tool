# 24 Local Custom Cache Visibility

Date: 2026-04-28

## Problem

After syncing a `Custom Worker / HTTP JSON` source, switching back to `Local SQLite on backend` and clicking Refresh did not show the synced custom data. This was confusing because the data had been downloaded locally.

## Change

Local mode now shows synced custom HTTP cache tables as synthetic logical tables:
Local mode now shows synced custom HTTP cache tables as real SQLite tables:

```text
custom_<tableName>
```

Example:

```text
custom_players
custom_matches
```

These tables are named:

```text
custom_<tableName>
```

and include `source_url` so rows from different Workers remain distinguishable.

## SQL Behavior

The `custom_*` tables are real SQLite tables. SQL Run is available after sync.

## Verification

```bash
node --check server/game-logger-server.js
node --check server/public/app.js
```
