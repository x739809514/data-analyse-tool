# 09 Separate Backend And Source

Date: 2026-04-28

## Problem

The previous UI treated `Server URL` as both the analysis backend and the data server. That is incorrect because Cloudflare Worker and ECS can be independent data sources.

## New Model

The app now has two separate concepts:

- Analysis Backend URL: the Node/Express app that serves `/api/*`.
- Data Source: where game data is read from.

Supported data sources:

- `sqlite`: local SQLite database on the analysis backend.
- `gameLoggerHttp`: remote Game Logger compatible HTTP API.

## Remote Game Logger HTTP API

For Cloudflare Worker or ECS data sources, the backend expects these JSON endpoints:

```text
GET /users?page=1&limit=50
GET /session?page=1&limit=50
GET /coffee?page=1&limit=50
GET /plant?page=1&limit=50
```

These endpoints should return the existing shape:

```json
{
  "success": true,
  "pagination": {
    "page": 1,
    "limit": 50,
    "total": 0,
    "totalPages": 1
  },
  "data": []
}
```

## Limits

Read-only SQL is still only available for local SQLite. For HTTP data sources, table preview works and AI fallback analysis can aggregate session game time from `/session`.

