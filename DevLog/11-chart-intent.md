# 11 Chart Intent

Date: 2026-04-28

## Change

AI analysis now generates chart output only when the user's question explicitly asks for visual output.

Chart intent keywords include:

- English: `chart`, `graph`, `plot`, `visual`, `visualize`, `trend`, `line`, `bar`, `pie`
- Chinese: `图表`, `图`, `可视化`, `趋势`, `折线`, `柱状`, `饼图`

## Behavior

If chart intent is absent:

- Backend returns `chart: null`.
- AI prompt asks for text analysis only.
- Frontend clears the chart panel and shows `No chart requested`.

If chart intent is present:

- Backend asks for or builds an ECharts option.
- Frontend renders the chart.

## Verification

```bash
node --check server/game-logger-server.js
node --check server/public/app.js
```

