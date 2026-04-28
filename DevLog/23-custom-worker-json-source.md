# 23 Custom Worker JSON Source

Date: 2026-04-28

## Problem

Different Cloudflare Workers may collect different datasets with different table names and endpoints. The previous Worker support assumed a fixed Game Logger API:

```text
/users
/session
/coffee
/plant
```

That caused sync failures for Workers with different routes or table names.

## Change

Added a new data source type:

```text
Custom Worker / HTTP JSON
```

The UI now accepts a table configuration JSON:

```json
[
  {
    "name": "sessions",
    "endpoint": "/session",
    "responseKey": "data"
  }
]
```

Multiple tables are supported:

```json
[
  { "name": "players", "endpoint": "/api/players", "responseKey": "items" },
  { "name": "matches", "endpoint": "/api/matches", "responseKey": "rows" }
]
```

Use `responseKey: ""` when the endpoint returns a JSON array directly.

## Storage

Custom source rows are synced to real SQLite tables:

```text
custom_<tableName>
```

Each custom table includes:

- `source_url`
- `row_id`
- `raw_json`
- `synced_at`
- inferred JSON fields as SQLite columns

The app also keeps a raw backup in `remote_generic_rows`.

## AI Behavior

For Custom Worker / HTTP JSON:

- Sync first.
- Table preview reads the real local `custom_*` SQLite tables.
- AI Analyse uses the real table schema after sync.
- SQL Run is available after sync, with `source_url` filtering required.

## Verification

```bash
node --check server/game-logger-server.js
node --check server/public/app.js
```
