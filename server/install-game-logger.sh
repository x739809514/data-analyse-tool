#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${1:-/opt/game-logger}"
NODE_BIN="${NODE_BIN:-node}"
NPM_BIN="${NPM_BIN:-npm}"

echo "Installing Game Logger into ${APP_DIR}"

mkdir -p "${APP_DIR}/data"

cp game-logger-server.js "${APP_DIR}/"
cp package.json "${APP_DIR}/"
rm -rf "${APP_DIR}/public"
cp -R public "${APP_DIR}/"

cd "${APP_DIR}"
"${NPM_BIN}" install --omit=dev

if [ ! -f .env ]; then
  cat > .env <<'EOF'
PORT=3000
ADMIN_API_KEY=replace-with-a-real-secret
RETENTION_DAYS=7
DB_PATH=./data/game-logger.db
DEBUG_MODE=false
MAX_QUERY_ROWS=500
AI_PROVIDER=openai
AI_MODEL=gpt-4.1-mini
AI_BASE_URL=https://api.openai.com/v1
# OPENAI_API_KEY=
# DEEPSEEK_API_KEY=
# MINIMAX_API_KEY=
# CLAUDE_API_KEY=
# GEMINI_API_KEY=
EOF
fi

cat > start-game-logger.sh <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
set -a
[ -f .env ] && . ./.env
set +a
exec node game-logger-server.js
EOF

chmod +x start-game-logger.sh

echo "Install complete."
echo "App directory: ${APP_DIR}"
echo "Edit ${APP_DIR}/.env before starting."
echo "Start command: cd ${APP_DIR} && ./start-game-logger.sh"
