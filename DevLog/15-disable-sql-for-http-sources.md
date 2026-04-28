# 15 Disable SQL For HTTP Sources

Date: 2026-04-28

## Problem

Users could click `Run` in the SQL panel while using a Cloudflare Worker or HTTP data source. The backend correctly rejected the request because remote HTTP sources do not support SQL execution, but the UI made this look like an app error.

## Change

When the selected data source is not Local SQLite:

- Disable the SQL editor.
- Disable the Run button.
- Show a clear message:

```text
Remote HTTP data sources do not support SQL execution.
```

Table preview and AI Analyse remain available.

## Verification

```bash
node --check server/public/app.js
node --check server/game-logger-server.js
```

