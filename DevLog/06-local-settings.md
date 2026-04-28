# 06 Local Settings

Date: 2026-04-28

## Changes

Added browser-side configuration persistence for:

- Server URL.
- AI provider.
- AI model.
- AI base URL.
- AI API key.

The app stores these values in `localStorage` under:

```text
game-data-analyse.settings.v1
```

## Behavior

On page load:

1. Read saved settings from `localStorage`.
2. Use saved Server URL or fallback to `window.location.origin`.
3. Call `/api/meta` against the configured server.
4. Populate provider presets.
5. Restore saved AI settings where possible.

When the user changes Server URL and clicks Connect, all database and AI calls use that server.

## Security Note

The API key is stored locally in the browser. This is convenient for local/dev use, but it is not encrypted. For production, prefer server-side environment variables or encrypted credential storage.

