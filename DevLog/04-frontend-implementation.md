# 04 Frontend Implementation

Date: 2026-04-28

## Files

- `server/public/app.html`
- `server/public/app.css`
- `server/public/app.js`

## UI Structure

- Left sidebar: database identity, refresh action, table list.
- Main workspace: active table metadata, paginated data preview, read-only SQL runner.
- Right assistant panel: provider/model/base URL/API key controls, chat log, question form, chart area.

## Runtime

The app is intentionally static and build-free. Express serves it from `/app` and `/assets/*`.

Charts use ECharts from a CDN. If the CDN is unavailable, table and chat functionality still work, but charts will not render.

