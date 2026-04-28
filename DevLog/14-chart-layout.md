# 14 Chart Layout

Date: 2026-04-28

## Change

Moved the chart panel out of the right AI sidebar and into the main workspace below the SQL panel.

## Result

The chart now uses the same width as the center data preview and SQL areas. The right sidebar is dedicated to AI configuration and conversation.

## Verification

```bash
node --check server/public/app.js
```

