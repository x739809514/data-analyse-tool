# 08 ECS Deploy Not Found

Date: 2026-04-28

## Problem

When deploying to ECS, `/app` or `/api/meta` can return `Not Found` if the remote server is still running the old `game-logger-server.js`, or if the install script does not copy the browser app files.

## Change

Updated `server/install-game-logger.sh` to copy:

```text
server/public/
```

into the deployment directory.

## ECS Checks

Expected routes after deploying the latest code and restarting:

```text
GET /health
GET /app
GET /api/meta
GET /api/db/tables
```

If `/health` works but `/api/meta` returns `Not Found`, the ECS process is running old code.

If `/api/meta` works but `/app` fails, the `public/` folder was not deployed.

