# 10 Cloudflare Worker Source

Date: 2026-04-28

## Change

Added an explicit `Cloudflare Worker` option in the Data Source selector.

Frontend behavior:

- `Cloudflare Worker` displays the Data Source URL field.
- The Worker URL is saved in browser local storage.
- API calls pass the source URL to the analysis backend.

Backend behavior:

- `cloudflareWorker` is normalized to the existing HTTP data source adapter.
- It expects the same Game Logger compatible JSON endpoints:
  - `/users`
  - `/session`
  - `/coffee`
  - `/plant`

## Verification

```bash
node --check server/public/app.js
node --check server/game-logger-server.js
```

