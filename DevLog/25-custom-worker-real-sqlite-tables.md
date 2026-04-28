# 25 Custom Worker Real SQLite Tables

Date: 2026-04-28

## Goal

Make Custom Worker synced data behave like real local SQLite data.

## Change

Custom Worker sync now creates or migrates real SQLite tables:

```text
custom_<tableName>
```

For example:

```text
custom_players
custom_matches
custom_comments
```

Each table includes:

- `source_url`
- `row_id`
- inferred JSON fields as SQLite columns
- `raw_json`
- `synced_at`

The old `remote_generic_rows` raw cache remains as a backup, but the UI, SQL, and AI analysis now use the real `custom_*` tables after sync.

## Field Rules

- JSON keys are converted to safe SQLite column names.
- Numeric values become `INTEGER` or `REAL`.
- Booleans become `INTEGER` 0/1.
- Objects/arrays become JSON strings.
- Time-like fields become `TEXT` and are normalized to `YYYY-MM-DD HH:mm:ss`.

## SQL Behavior

After sync, `Custom Worker / HTTP JSON` enables SQL Run.

Queries must filter the current source:

```sql
WHERE source_url = 'https://your-worker.workers.dev'
```

This prevents mixing multiple Workers in one query by accident.

## Verification

```bash
node --check server/game-logger-server.js
node --check server/public/app.js
```

