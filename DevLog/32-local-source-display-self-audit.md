# 32 - Local Source Display Self Audit

## Problem

The Local SQLite view still displayed confusing data after source switching.

The main issue was that `sourceType=sqlite` mixed built-in backend tables with `custom_*` synced cache tables. That made Local look like it belonged to a previous Custom Worker source, while normal Cloudflare/Game Logger caches were not shown there.

## Decision

Make table display source-specific:

- Local SQLite shows only backend-owned local tables.
- Cloudflare/Game Logger shows only the selected URL's `remote_*` local mirror tables after sync.
- Custom Worker shows only the selected URL/config's `custom_*` local mirror tables after sync.

Cached data is not deleted from SQLite. It is filtered out of the current view unless it belongs to the selected source.

## Changes

- Removed `custom_*` cache tables from the Local SQLite table list.
- Removed `custom_*` cache tables from the Local SQLite AI schema.
- Fixed local fallback progress analysis so it only uses tables that actually have `progress` or `progresses`.
- Fixed fallback analysis for Cloudflare/Custom synced tables so generated SQL includes `source_url = current URL`.

## Verification

- `node --check server/game-logger-server.js`
- `node --check server/public/app.js`
- Started backend on temporary port `3114`.
- Verified:
  - `sourceType=sqlite` returns only built-in tables.
  - Cloudflare/Game Logger URL returns only `remote_*` synced tables.
  - Custom Worker URL returns only configured `custom_*` synced tables.
  - Local AI fallback no longer errors on progress analysis.
  - Custom AI fallback uses `custom_sessions.progresses` with `source_url` filter.
  - Cloudflare AI fallback uses `remote_sessions.progress` with `source_url` filter.

## Notes

This makes the UI match the active data source instead of acting like a global cache browser.
