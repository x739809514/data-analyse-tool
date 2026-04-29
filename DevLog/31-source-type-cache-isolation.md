# 31 - Source Type Cache Isolation

## Problem

Switching between Custom Worker and normal Cloudflare/Game Logger could show the wrong local cache state.

The main failure was:

- A Custom Worker sync writes `custom_*` rows into `remote_sync_meta`.
- Normal Cloudflare/Game Logger sync status checked only `source_url`.
- If the same URL had `custom_*` metadata, the normal remote path incorrectly treated it as a synced `remote_*` source.
- The UI could then show empty `remote_*` local mirror tables or stale tables from the previous source.

## Changes

- `hasSyncedRemoteSource()` now only counts real remote mirror tables:
  - `remote_users`
  - `remote_sessions`
  - `remote_coffee_sessions`
  - `remote_plant_sessions`
- `getRemoteSyncStatus()` now uses the same `remote_*` filter.
- Frontend source switching now clears the active table, rows, paging, and table list before loading the new source.
- Changing data source URL now reloads the current source view.
- Remote source reload with an empty URL now shows a URL prompt instead of calling the backend with an invalid source.

## Verification

- `node --check server/game-logger-server.js`
- `node --check server/public/app.js`
- Started backend on temporary port `3112`.
- Verified a `custom_*` only URL returns `synced:false` when queried as `gameLoggerHttp`.
- Verified the same URL returns `synced:true` when queried as `customHttp`.
- Verified a normal Cloudflare/Game Logger URL still returns `remote_*` synced tables.

## Notes

This keeps cached data in SQLite but isolates what the UI shows by current source type and URL. It avoids destructive deletes while making the visible state match the selected source.
