const state = {
  tables: [],
  activeTable: '',
  page: 1,
  totalPages: 1,
  providers: {},
  chart: null,
  serverUrl: window.location.origin,
  sourceType: 'sqlite',
  sourceUrl: '',
  sourceConfig: '',
  hasSyncedRemote: false,
  analysisHistory: [],
  activeAnalysisId: ''
};

const STORAGE_KEY = 'game-data-analyse.settings.v1';
const ANALYSIS_HISTORY_KEY = 'game-data-analyse.analysis-history.v1';
const MAX_ANALYSIS_HISTORY = 20;

const els = {
  dbStatus: document.getElementById('dbStatus'),
  serverUrlInput: document.getElementById('serverUrlInput'),
  connectServer: document.getElementById('connectServer'),
  serverMessage: document.getElementById('serverMessage'),
  sourceTypeSelect: document.getElementById('sourceTypeSelect'),
  sourceUrlInput: document.getElementById('sourceUrlInput'),
  sourceUrlLabel: document.getElementById('sourceUrlLabel'),
  sourceConfigInput: document.getElementById('sourceConfigInput'),
  sourceConfigLabel: document.getElementById('sourceConfigLabel'),
  syncSource: document.getElementById('syncSource'),
  syncMessage: document.getElementById('syncMessage'),
  refreshTables: document.getElementById('refreshTables'),
  tableList: document.getElementById('tableList'),
  activeTableTitle: document.getElementById('activeTableTitle'),
  activeTableMeta: document.getElementById('activeTableMeta'),
  dataTable: document.getElementById('dataTable'),
  rowCount: document.getElementById('rowCount'),
  prevPage: document.getElementById('prevPage'),
  nextPage: document.getElementById('nextPage'),
  pageLabel: document.getElementById('pageLabel'),
  sqlEditor: document.getElementById('sqlEditor'),
  runSql: document.getElementById('runSql'),
  sqlMessage: document.getElementById('sqlMessage'),
  providerSelect: document.getElementById('providerSelect'),
  modelInput: document.getElementById('modelInput'),
  baseUrlInput: document.getElementById('baseUrlInput'),
  apiKeyInput: document.getElementById('apiKeyInput'),
  aiMode: document.getElementById('aiMode'),
  chatLog: document.getElementById('chatLog'),
  askForm: document.getElementById('askForm'),
  questionInput: document.getElementById('questionInput'),
  chart: document.getElementById('chart')
};

init();

async function init() {
  loadSavedSettings();
  loadAnalysisHistory();
  bindEvents();
  try {
    await connectToServer();
    addMessage('assistant', 'Ask a question about the game data. Without an API key, I will use a local fallback analysis.');
    renderAnalysisHistoryMessages();
  } catch (error) {
    addMessage('error', error.message);
  }
}

function bindEvents() {
  els.connectServer.addEventListener('click', async () => {
    try {
      await connectToServer();
    } catch (error) {
      showServerMessage(error.message, 'error');
      addMessage('error', error.message);
    }
  });
  els.refreshTables.addEventListener('click', loadTables);
  els.prevPage.addEventListener('click', () => changePage(-1));
  els.nextPage.addEventListener('click', () => changePage(1));
  els.runSql.addEventListener('click', runSql);
  els.serverUrlInput.addEventListener('change', () => {
    state.serverUrl = normalizeServerUrl(els.serverUrlInput.value);
    els.serverUrlInput.value = state.serverUrl;
    saveSettings();
  });
  els.sourceTypeSelect.addEventListener('change', async () => {
    state.sourceType = els.sourceTypeSelect.value;
    syncSourceControls();
    syncSqlControls();
    saveSettings();
    await reloadCurrentSourceView();
  });
  els.sourceUrlInput.addEventListener('change', async () => {
    state.sourceUrl = normalizeOptionalUrl(els.sourceUrlInput.value);
    els.sourceUrlInput.value = state.sourceUrl;
    saveSettings();
    await reloadCurrentSourceView();
  });
  els.sourceConfigInput.addEventListener('input', () => {
    state.sourceConfig = els.sourceConfigInput.value.trim();
    saveSettings();
  });
  els.syncSource.addEventListener('click', syncDataSource);
  els.providerSelect.addEventListener('change', () => {
    syncProviderInputs({ preferSaved: false });
    saveSettings();
  });
  [els.modelInput, els.baseUrlInput, els.apiKeyInput].forEach((input) => {
    input.addEventListener('input', saveSettings);
  });
  els.askForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    await askAi();
  });
  window.addEventListener('resize', () => {
    if (state.chart) state.chart.resize();
  });
}

async function loadMeta() {
  const meta = await api(withSource('/api/meta'));
  els.dbStatus.textContent = `${meta.database.type}: ${shortPath(meta.database.path)}`;
  state.providers = meta.ai.providers || {};
  els.providerSelect.innerHTML = Object.entries(state.providers).map(([key, provider]) => (
    `<option value="${escapeHtml(key)}">${escapeHtml(provider.label)}</option>`
  )).join('');
  const saved = getSavedSettings();
  els.providerSelect.value = saved.provider || meta.ai.defaultProvider || 'openai';
  syncProviderInputs({ preferSaved: true });
}

async function loadTables() {
  const data = await api(withSource('/api/db/tables'));
  state.tables = data.tables;
  state.hasSyncedRemote = state.sourceType !== 'sqlite' && state.tables.some((table) => table.synced);
  renderTableList();
  syncSqlControls();
  if (state.activeTable && !state.tables.some((table) => table.name === state.activeTable)) {
    state.activeTable = '';
    clearTableView();
  }
  if (!state.activeTable && state.tables[0]) {
    await selectTable(state.tables[0].name);
  } else if (!state.tables.length) {
    clearTableView();
  }
}

async function connectToServer() {
  state.serverUrl = normalizeServerUrl(els.serverUrlInput.value);
  els.serverUrlInput.value = state.serverUrl;
  saveSettings();
  els.dbStatus.textContent = 'Connecting...';
  showServerMessage('Connecting...', '');
  els.connectServer.disabled = true;
  state.activeTable = '';
  state.page = 1;
  try {
    await loadMeta();
    await loadTables();
    await loadSyncStatus();
    showServerMessage(`Connected: ${state.serverUrl}`, 'ok');
  } catch (error) {
    els.dbStatus.textContent = 'Connection failed';
    state.tables = [];
    renderTableList();
    throw error;
  } finally {
    els.connectServer.disabled = false;
  }
}

function renderTableList() {
  els.tableList.innerHTML = state.tables.map((table) => `
    <button class="table-item ${table.name === state.activeTable ? 'active' : ''}" data-table="${escapeHtml(table.name)}" type="button">
      <strong>${escapeHtml(table.name)}</strong>
      <span>${table.rowCount} rows · ${table.columns.length} columns</span>
    </button>
  `).join('');

  els.tableList.querySelectorAll('button').forEach((button) => {
    button.addEventListener('click', () => selectTable(button.dataset.table));
  });
}

async function reloadCurrentSourceView() {
  state.activeTable = '';
  state.page = 1;
  state.totalPages = 1;
  state.tables = [];
  clearTableView();
  renderTableList();
  if (state.sourceType !== 'sqlite' && !state.sourceUrl) {
    setSyncMessage('Enter a data source URL, then sync or refresh.', '');
    syncSqlControls();
    return;
  }
  await loadTables();
  await loadSyncStatus();
}

function clearTableView() {
  els.activeTableTitle.textContent = 'Select a table';
  els.activeTableMeta.textContent = '';
  els.rowCount.textContent = '0 rows';
  els.pageLabel.textContent = 'Page 1 / 1';
  els.prevPage.disabled = true;
  els.nextPage.disabled = true;
  els.dataTable.innerHTML = '<tbody><tr><td>No table selected</td></tr></tbody>';
}

async function selectTable(tableName) {
  state.activeTable = tableName;
  state.page = 1;
  renderTableList();
  if (state.sourceType === 'sqlite') {
    els.sqlEditor.value = `SELECT * FROM "${tableName}" LIMIT 50`;
  } else if (state.hasSyncedRemote) {
    els.sqlEditor.value = `SELECT * FROM "${tableName}" WHERE source_url = '${escapeSqlLiteral(state.sourceUrl)}' LIMIT 50`;
  }
  syncSqlControls();
  await loadRows();
}

async function loadRows() {
  if (!state.activeTable) return;
  const data = await api(withSource(`/api/db/tables/${encodeURIComponent(state.activeTable)}/rows?page=${state.page}&limit=50`));
  state.totalPages = data.pagination.totalPages;
  els.activeTableTitle.textContent = data.table;
  els.activeTableMeta.textContent = data.columns.map((column) => `${column.name} ${column.type || ''}`.trim()).join(' · ');
  els.rowCount.textContent = `${data.pagination.total} rows`;
  els.pageLabel.textContent = `Page ${data.pagination.page} / ${data.pagination.totalPages}`;
  els.prevPage.disabled = data.pagination.page <= 1;
  els.nextPage.disabled = data.pagination.page >= data.pagination.totalPages;
  renderDataTable(data.columns.map((column) => column.name), data.rows);
}

function changePage(delta) {
  const nextPage = Math.min(state.totalPages, Math.max(1, state.page + delta));
  if (nextPage !== state.page) {
    state.page = nextPage;
    loadRows();
  }
}

async function runSql() {
  els.runSql.disabled = true;
  els.sqlMessage.textContent = 'Running query...';
  try {
    const data = await api('/api/db/query', {
      method: 'POST',
      body: {
        sql: els.sqlEditor.value,
        limit: 100,
        source: getSourcePayload()
      }
    });
    renderDataTable(data.columns, data.rows);
    els.activeTableTitle.textContent = 'SQL Result';
    els.activeTableMeta.textContent = data.sql;
    els.rowCount.textContent = `${data.rowCount} rows`;
    els.sqlMessage.textContent = `Completed in ${data.elapsedMs}ms${data.limited ? ' · limit applied' : ''}`;
  } catch (error) {
    els.sqlMessage.textContent = error.message;
  } finally {
    els.runSql.disabled = false;
  }
}

async function askAi() {
  const question = els.questionInput.value.trim();
  if (!question) return;
  addMessage('user', question);
  els.questionInput.value = '';
  const submit = els.askForm.querySelector('button');
  submit.disabled = true;
  try {
    const data = await api('/api/ai/analyze', {
      method: 'POST',
      body: {
        question,
        provider: els.providerSelect.value,
        model: els.modelInput.value.trim(),
        baseUrl: els.baseUrlInput.value.trim(),
        apiKey: els.apiKeyInput.value.trim(),
        limit: 100,
        source: getSourcePayload()
      }
    });
    saveSettings();
    els.aiMode.textContent = data.aiConfigured ? `${data.provider} API` : 'Local fallback';
    const queryLabel = state.sourceType === 'sqlite' ? 'SQL' : 'Data operation';
    const historyItem = createAnalysisHistoryItem(question, data, queryLabel);
    saveAnalysisHistoryItem(historyItem);
    addMessage('assistant', formatAnalysisMessage(historyItem), { historyId: historyItem.id });
    restoreAnalysis(historyItem.id);
  } catch (error) {
    addMessage('error', error.message);
  } finally {
    submit.disabled = false;
  }
}

function syncProviderInputs(options = {}) {
  const saved = getSavedSettings();
  const provider = state.providers[els.providerSelect.value] || {};
  els.modelInput.value = options.preferSaved && saved.model ? saved.model : provider.defaultModel || '';
  els.baseUrlInput.value = options.preferSaved && saved.baseUrl ? saved.baseUrl : provider.baseUrl || '';
  els.apiKeyInput.value = options.preferSaved && saved.apiKey ? saved.apiKey : '';
}

function syncSourceControls() {
  const isRemote = els.sourceTypeSelect.value !== 'sqlite';
  const isCustom = els.sourceTypeSelect.value === 'customHttp';
  els.sourceUrlLabel.style.display = isRemote ? 'grid' : 'none';
  els.sourceConfigLabel.style.display = isCustom ? 'grid' : 'none';
  els.syncSource.style.display = isRemote ? 'block' : 'none';
  els.syncMessage.style.display = isRemote ? 'block' : 'none';
  if (!isRemote) {
    els.sourceUrlInput.value = '';
    els.syncMessage.textContent = 'No sync needed for Local SQLite';
  }
}

async function syncDataSource() {
  if (state.sourceType === 'sqlite') return;
  state.sourceUrl = normalizeOptionalUrl(els.sourceUrlInput.value);
  els.sourceUrlInput.value = state.sourceUrl;
  saveSettings();
  els.syncSource.disabled = true;
  setSyncMessage('Syncing remote data...', '');
  try {
    const data = await api('/api/sources/sync', {
      method: 'POST',
      body: {
        source: getSourcePayload()
      }
    });
    const parts = Object.entries(data.result || {}).map(([table, item]) => `${table}: ${item.syncedRows}`);
    setSyncMessage(`Synced ${parts.join(', ')}`, 'ok');
    await loadTables();
    syncSqlControls();
  } catch (error) {
    setSyncMessage(error.message, 'error');
  } finally {
    els.syncSource.disabled = false;
  }
}

async function loadSyncStatus() {
  if (state.sourceType === 'sqlite') {
    setSyncMessage('No sync needed for Local SQLite', '');
    return;
  }
  try {
    const data = await api(withSource('/api/sources/sync/status'));
    if (!data.synced) {
      setSyncMessage('Not synced yet', '');
      return;
    }
    const parts = data.tables.map((table) => `${table.tableName}: ${table.rowCount}`);
    setSyncMessage(`Synced ${parts.join(', ')}`, 'ok');
  } catch (error) {
    setSyncMessage(error.message, 'error');
  }
}

function setSyncMessage(text, type) {
  els.syncMessage.textContent = text;
  els.syncMessage.className = `server-message ${type || ''}`.trim();
}

function syncSqlControls() {
  const canRunSql = els.sourceTypeSelect.value === 'sqlite' || state.hasSyncedRemote;
  els.runSql.disabled = !canRunSql;
  els.sqlEditor.disabled = !canRunSql;
  if (!canRunSql) {
    els.sqlEditor.value = '';
    els.sqlEditor.placeholder = els.sourceTypeSelect.value === 'customHttp'
      ? 'Sync the custom HTTP data source first to run SQL against real custom_* tables.'
      : 'Sync the HTTP data source first to run SQL against local mirror tables.';
    els.sqlMessage.textContent = els.sourceTypeSelect.value === 'customHttp'
      ? 'Custom HTTP data sources need Sync Data Source before SQL execution.'
      : 'Remote HTTP data sources need Sync Data Source before SQL execution.';
  } else {
    els.sqlEditor.placeholder = state.sourceType === 'sqlite'
      ? 'SELECT * FROM sessions LIMIT 50'
      : `SELECT * FROM remote_sessions WHERE source_url = '${state.sourceUrl}' LIMIT 50`;
    if (els.sqlMessage.textContent === 'Remote HTTP data sources need Sync Data Source before SQL execution.') {
      els.sqlMessage.textContent = '';
    }
  }
}

function renderDataTable(columns, rows) {
  if (!columns.length) {
    els.dataTable.innerHTML = '<tbody><tr><td>No rows</td></tr></tbody>';
    return;
  }
  const head = `<thead><tr>${columns.map((column) => `<th>${escapeHtml(column)}</th>`).join('')}</tr></thead>`;
  const body = `<tbody>${rows.map((row) => (
    `<tr>${columns.map((column) => {
      const value = formatCell(row[column], column);
      return `<td title="${escapeHtml(value)}">${escapeHtml(value)}</td>`;
    }).join('')}</tr>`
  )).join('')}</tbody>`;
  els.dataTable.innerHTML = head + body;
}

function renderChart(option) {
  if (!option) {
    if (state.chart) {
      state.chart.clear();
    }
    els.chart.innerHTML = '<div class="empty-chart">No chart requested</div>';
    return;
  }
  els.chart.innerHTML = '';
  if (!window.echarts) {
    els.chart.innerHTML = '<div class="empty-chart">Chart library unavailable</div>';
    return;
  }
  if (!state.chart) {
    state.chart = window.echarts.init(els.chart);
  }
  state.chart.setOption(option, true);
}

function addMessage(type, text, options = {}) {
  const div = document.createElement('div');
  div.className = `message ${type}`;
  div.textContent = text;
  if (options.historyId) {
    div.classList.add('history-message');
    div.dataset.historyId = options.historyId;
    div.title = 'Click to restore this analysis';
    div.addEventListener('click', () => restoreAnalysis(options.historyId));
  }
  els.chatLog.appendChild(div);
  els.chatLog.scrollTop = els.chatLog.scrollHeight;
}

function createAnalysisHistoryItem(question, data, queryLabel) {
  return {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    createdAt: new Date().toISOString(),
    question,
    queryLabel,
    title: data.plan && data.plan.title ? data.plan.title : 'AI Result',
    analysis: data.analysis || '',
    operation: data.query && data.query.sql ? data.query.sql : '',
    columns: data.query && Array.isArray(data.query.columns) ? data.query.columns : [],
    rows: data.query && Array.isArray(data.query.rows) ? data.query.rows : [],
    rowCount: data.query && typeof data.query.rowCount === 'number' ? data.query.rowCount : 0,
    chart: data.chart || null,
    sourceType: state.sourceType,
    sourceUrl: state.sourceUrl,
    provider: data.provider || '',
    model: data.model || ''
  };
}

function saveAnalysisHistoryItem(item) {
  state.analysisHistory = [
    item,
    ...state.analysisHistory.filter((existing) => existing.id !== item.id)
  ].slice(0, MAX_ANALYSIS_HISTORY);
  localStorage.setItem(ANALYSIS_HISTORY_KEY, JSON.stringify(state.analysisHistory));
}

function loadAnalysisHistory() {
  try {
    const parsed = JSON.parse(localStorage.getItem(ANALYSIS_HISTORY_KEY) || '[]');
    state.analysisHistory = Array.isArray(parsed) ? parsed.slice(0, MAX_ANALYSIS_HISTORY) : [];
  } catch (_error) {
    state.analysisHistory = [];
  }
}

function renderAnalysisHistoryMessages() {
  for (const item of [...state.analysisHistory].reverse()) {
    addMessage('assistant', formatAnalysisMessage(item), { historyId: item.id });
  }
}

function restoreAnalysis(historyId) {
  const item = state.analysisHistory.find((entry) => entry.id === historyId);
  if (!item) return;

  state.activeAnalysisId = historyId;
  renderDataTable(item.columns, item.rows);
  renderChart(item.chart);
  els.activeTableTitle.textContent = item.title || 'AI Result';
  els.activeTableMeta.textContent = item.operation || '';
  els.rowCount.textContent = `${item.rowCount} rows`;
  els.sqlMessage.textContent = `${item.queryLabel || 'Operation'} restored from ${formatDateTimeCell(item.createdAt)}`;

  els.chatLog.querySelectorAll('.history-message').forEach((node) => {
    node.classList.toggle('active', node.dataset.historyId === historyId);
  });
}

function formatAnalysisMessage(item) {
  return `${item.analysis}\n\n${item.queryLabel || 'Operation'}:\n${item.operation}`;
}

async function api(url, options = {}) {
  let response;
  const target = buildApiUrl(url);
  try {
    response = await fetch(target, {
      method: options.method || 'GET',
      headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
      body: options.body ? JSON.stringify(options.body) : undefined
    });
  } catch (error) {
    throw new Error(`Cannot reach server: ${target}`);
  }

  let data = {};
  try {
    data = await response.json();
  } catch (_error) {
    throw new Error(`Server did not return JSON: ${target}`);
  }

  if (!response.ok || data.success === false) {
    throw new Error(data.error || `Request failed: ${response.status}`);
  }
  return data;
}

function showServerMessage(text, type) {
  els.serverMessage.textContent = text;
  els.serverMessage.className = `server-message ${type || ''}`.trim();
}

function buildApiUrl(url) {
  if (/^https?:\/\//i.test(url)) return url;
  return `${state.serverUrl}${url.startsWith('/') ? url : `/${url}`}`;
}

function withSource(path) {
  const separator = path.includes('?') ? '&' : '?';
  const params = new URLSearchParams({
    sourceType: normalizeSourceTypeForApi(state.sourceType)
  });
  if (state.sourceUrl) {
    params.set('sourceUrl', state.sourceUrl);
  }
  if (state.sourceConfig && state.sourceType === 'customHttp') {
    params.set('sourceConfig', state.sourceConfig);
  }
  return `${path}${separator}${params.toString()}`;
}

function getSourcePayload() {
  return {
    type: normalizeSourceTypeForApi(state.sourceType),
    url: state.sourceUrl,
    config: state.sourceConfig
  };
}

function escapeSqlLiteral(value) {
  return String(value || '').replace(/'/g, "''");
}

function loadSavedSettings() {
  const saved = getSavedSettings();
  state.serverUrl = normalizeServerUrl(saved.serverUrl || window.location.origin);
  state.sourceType = saved.sourceType || 'sqlite';
  state.sourceUrl = saved.sourceUrl || '';
  state.sourceConfig = saved.sourceConfig || '[{"name":"sessions","endpoint":"/session","responseKey":"data"}]';
  els.serverUrlInput.value = state.serverUrl;
  els.sourceTypeSelect.value = state.sourceType;
  els.sourceUrlInput.value = state.sourceUrl;
  els.sourceConfigInput.value = state.sourceConfig;
  syncSourceControls();
  syncSqlControls();
  els.providerSelect.value = saved.provider || els.providerSelect.value;
  els.modelInput.value = saved.model || '';
  els.baseUrlInput.value = saved.baseUrl || '';
  els.apiKeyInput.value = saved.apiKey || '';
}

function saveSettings() {
  const settings = {
    serverUrl: normalizeServerUrl(els.serverUrlInput.value || state.serverUrl),
    sourceType: els.sourceTypeSelect.value,
    sourceUrl: normalizeOptionalUrl(els.sourceUrlInput.value),
    sourceConfig: els.sourceConfigInput.value.trim(),
    provider: els.providerSelect.value,
    model: els.modelInput.value.trim(),
    baseUrl: els.baseUrlInput.value.trim(),
    apiKey: els.apiKeyInput.value.trim()
  };
  state.serverUrl = settings.serverUrl;
  state.sourceType = settings.sourceType;
  state.sourceUrl = settings.sourceUrl;
  state.sourceConfig = settings.sourceConfig;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

function getSavedSettings() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
  } catch (_error) {
    return {};
  }
}

function normalizeServerUrl(value) {
  const fallback = window.location.origin;
  let text = String(value || fallback).trim();
  if (!/^https?:\/\//i.test(text)) {
    text = `http://${text}`;
  }
  try {
    const url = new URL(text);
    url.hash = '';
    url.search = '';
    url.pathname = url.pathname.replace(/\/app\/?$/i, '').replace(/\/+$/g, '');
    return url.toString().replace(/\/+$/g, '');
  } catch (_error) {
    return fallback;
  }
}

function normalizeOptionalUrl(value) {
  const text = String(value || '').trim();
  return text ? normalizeServerUrl(text) : '';
}

function normalizeSourceTypeForApi(type) {
  return type === 'cloudflareWorker' ? 'gameLoggerHttp' : type;
}

function formatCell(value, column) {
  if (value === null || value === undefined) return '';
  if (isTimeColumn(column)) {
    return formatDateTimeCell(value);
  }
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function isTimeColumn(column) {
  return /(^|_)(time|at)$|^(created_at|updated_at|received_at|last_updated|collection_time)$/i.test(String(column || ''));
}

function formatDateTimeCell(value) {
  if (typeof value === 'string') {
    const text = value.trim();
    if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}/.test(text)) {
      return text.replace('T', ' ').slice(0, 19);
    }
    if (!/^\d+$/.test(text)) {
      return text;
    }
  }

  const number = Number(value);
  if (!Number.isFinite(number)) {
    return String(value);
  }

  const date = new Date(Math.abs(number) < 1000000000000 ? number * 1000 : number);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  const pad = (part) => String(part).padStart(2, '0');
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate())
  ].join('-') + ' ' + [
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds())
  ].join(':');
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function shortPath(value) {
  const text = String(value || '');
  return text.length > 34 ? `...${text.slice(-31)}` : text;
}
