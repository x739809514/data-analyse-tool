# 12 Remote Progress Analysis

Date: 2026-04-28

## Problem

For remote HTTP data sources, AI fallback always grouped `/session` by game time. It did not handle questions such as:

```text
session 表中有多少个 id 达到了 100015 这个 progress
```

## Change

Added a remote fallback branch for progress questions:

- Detects `progress` / `进度`.
- Extracts a numeric target.
- Fetches `/session`.
- Counts rows where `progress >= target`.
- Counts unique ids using `user_id`, falling back to `id`.

Frontend now labels non-SQL remote operations as `Data operation` instead of `SQL`.

## Verification

```bash
node --check server/game-logger-server.js
node --check server/public/app.js
```

