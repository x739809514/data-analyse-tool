# 22 Clickable Analysis History

Date: 2026-04-28

## Goal

Allow users to click a previous AI response and restore the corresponding analysis result.

## Implementation

Frontend-only history storage:

```text
game-data-analyse.analysis-history.v1
```

Each saved item contains:

- question
- analysis
- operation / SQL
- result columns
- result rows
- row count
- chart option
- source type / source URL
- provider / model
- creation time

The app keeps the latest 20 analysis records.

## Behavior

When AI analysis completes:

1. Save the result to `localStorage`.
2. Render the AI message as a clickable history item.
3. Restore that result immediately.

When a history item is clicked:

- Restore the middle data table.
- Restore the chart.
- Restore the title and operation text.
- Mark the selected message visually.

## Verification

```bash
node --check server/public/app.js
node --check server/game-logger-server.js
```

