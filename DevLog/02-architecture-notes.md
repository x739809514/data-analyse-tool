# 02 Architecture Notes

Date: 2026-04-28

## Current Stack

The repo already contains a Node.js Express server using `better-sqlite3`.

Keeping the MVP on this stack avoids dependency churn and gives an immediately deployable app:

- Backend: Express
- Database: SQLite via `better-sqlite3`
- Frontend: Static HTML/CSS/JS served from Express
- Charts: ECharts loaded from CDN in the browser
- AI: Server-side gateway using Node's built-in `fetch`

## AI Analysis Flow

The app should not send full database contents to an AI provider.

Flow:

1. Browser sends a user question and optional provider/model settings.
2. Backend reads a compact database schema.
3. Backend asks the selected model for a JSON analysis plan containing SQL and chart intent.
4. Backend validates the SQL as read-only and adds a row limit when practical.
5. Backend executes the SQL.
6. Backend asks the model to summarize the result and return ECharts option JSON.
7. Browser renders text plus chart.

If the AI provider is not configured, the backend returns a deterministic local fallback plan and chart for common session-time questions.

## SQL Safety Rules

MVP SQL rules:

- Only a single `SELECT` or `WITH ... SELECT` statement.
- Reject write or schema keywords.
- Reject comments and multiple statements.
- Apply `LIMIT` if no limit exists.
- Enforce a maximum returned row count.

This is not a replacement for database-level read-only credentials, but it is enough for the first SQLite-only local workspace.

