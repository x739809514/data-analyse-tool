# 07 Connect Feedback

Date: 2026-04-28

## Problem

The Connect button could appear to do nothing because failed requests were only visible in the browser console or chat panel during initial load.

## Changes

- Added a visible server connection status below the Server URL input.
- Connect now shows `Connecting...`, `Connected`, or the error reason.
- Connect disables itself while a connection attempt is in progress.
- Server URL normalization now accepts:
  - `localhost:3000`
  - `http://localhost:3000`
  - `http://localhost:3000/app`
- Fetch failures now report the concrete target URL that could not be reached.

## Verification

```bash
node --check server/public/app.js
node --check server/game-logger-server.js
```

Both checks passed.

