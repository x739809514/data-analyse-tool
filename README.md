# Game Data Analyse

An Express + SQLite game data collection server with a browser workspace for table browsing, safe SQL queries, and AI-assisted analysis.

## Current MVP

- Game event/log collection endpoints from the existing server.
- Database explorer at `/app`.
- Table list, schema view, row preview, and read-only SQL execution.
- AI analysis endpoint that can call OpenAI-compatible APIs.
- Provider presets for OpenAI, DeepSeek, Minimax, Claude, and Gemini.
- Chart rendering in the browser with ECharts.

## Run

```bash
cd server
npm install
npm start
```

Open:

```text
http://localhost:3000/app
```

## AI Configuration

The app can use request-level API keys from the browser form, or environment variables.

Common environment variables:

```bash
AI_PROVIDER=openai
AI_MODEL=gpt-4.1-mini
OPENAI_API_KEY=...
DEEPSEEK_API_KEY=...
MINIMAX_API_KEY=...
CLAUDE_API_KEY=...
GEMINI_API_KEY=...
```

For OpenAI-compatible services you can also set:

```bash
AI_BASE_URL=https://api.openai.com/v1
```

## Security Notes

The SQL API only accepts read-only statements and automatically limits result size. For production, also use database accounts with read-only permissions and do not expose admin secrets to browsers.

