const fs = require('fs');
const path = require('path');

const CONFIG = {
  port: parseInt(process.env.PORT || '3000', 10),
  adminApiKey: process.env.ADMIN_API_KEY || '',
  retentionDays: parseInt(process.env.RETENTION_DAYS || '7', 10),
  dbPath: process.env.DB_PATH || path.join(__dirname, '..', 'data', 'game-logger.db'),
  debugMode: String(process.env.DEBUG_MODE || 'false').toLowerCase() === 'true',
  aiProvider: process.env.AI_PROVIDER || 'openai',
  aiModel: process.env.AI_MODEL || '',
  aiBaseUrl: process.env.AI_BASE_URL || '',
  maxQueryRows: parseInt(process.env.MAX_QUERY_ROWS || '500', 10)
};

function ensureDataDirectory(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function getProviderPresets() {
  return {
    openai: {
      label: 'OpenAI',
      type: 'openai-compatible',
      baseUrl: 'https://api.openai.com/v1',
      defaultModel: 'gpt-4.1-mini'
    },
    deepseek: {
      label: 'DeepSeek',
      type: 'openai-compatible',
      baseUrl: 'https://api.deepseek.com/v1',
      defaultModel: 'deepseek-chat'
    },
    minimax: {
      label: 'Minimax',
      type: 'openai-compatible',
      baseUrl: 'https://api.minimax.chat/v1',
      defaultModel: 'MiniMax-Text-01'
    },
    claude: {
      label: 'Claude',
      type: 'anthropic',
      baseUrl: 'https://api.anthropic.com/v1',
      defaultModel: 'claude-3-5-sonnet-latest'
    },
    gemini: {
      label: 'Gemini',
      type: 'gemini',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      defaultModel: 'gemini-1.5-flash'
    }
  };
}

function getProviderApiKey(provider) {
  const keyByProvider = {
    openai: process.env.OPENAI_API_KEY,
    deepseek: process.env.DEEPSEEK_API_KEY,
    minimax: process.env.MINIMAX_API_KEY,
    claude: process.env.CLAUDE_API_KEY || process.env.ANTHROPIC_API_KEY,
    gemini: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY
  };
  return keyByProvider[provider] || process.env.AI_API_KEY || '';
}

module.exports = {
  CONFIG,
  ensureDataDirectory,
  getProviderApiKey,
  getProviderPresets
};
