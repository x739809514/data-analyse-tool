# 16 Remote Sync To SQLite

Date: 2026-04-28

## Goal

Avoid incomplete AI analysis for remote HTTP data sources by syncing remote rows into local SQLite mirror tables.

## Added Tables

- `remote_sync_meta`
- `remote_users`
- `remote_sessions`
- `remote_coffee_sessions`
- `remote_plant_sessions`

Each mirror table includes `source_url` so multiple remote sources can coexist.

## Added API

```text
POST /api/sources/sync
GET  /api/sources/sync/status
```

Sync supports Cloudflare Worker and Game Logger HTTP API sources. The backend pages through:

```text
/users
/session
/coffee
/plant
```

and replaces the mirror rows for the selected `source_url`.

## AI Behavior

If a remote data source has been synced:

- Table browsing switches to local `remote_*` tables.
- AI analysis uses SQLite schema for those mirror tables.
- AI-generated SQL is executed locally against complete synced data.
- Prompts instruct AI to filter by `source_url`.

If a remote data source has not been synced:

- The previous direct HTTP AI/sample path remains available.

## Verification

```bash
node --check server/game-logger-server.js
node --check server/public/app.js
```

