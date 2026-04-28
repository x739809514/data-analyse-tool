const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const Database = require('better-sqlite3');

const CONFIG = {
  port: parseInt(process.env.PORT || '3000', 10),
  adminApiKey: process.env.ADMIN_API_KEY || '',
  retentionDays: parseInt(process.env.RETENTION_DAYS || '7', 10),
  dbPath: process.env.DB_PATH || path.join(__dirname, 'data', 'game-logger.db'),
  debugMode: String(process.env.DEBUG_MODE || 'false').toLowerCase() === 'true',
  aiProvider: process.env.AI_PROVIDER || 'openai',
  aiModel: process.env.AI_MODEL || '',
  aiBaseUrl: process.env.AI_BASE_URL || '',
  maxQueryRows: parseInt(process.env.MAX_QUERY_ROWS || '500', 10)
};

const REMOTE_FIELD_ALIASES = {
  id: ['id', 'ID', 'session_id', 'sessionId', 'SessionId'],
  userId: ['user_id', 'userId', 'UserId', 'userID', 'owner', 'Owner'],
  createdAt: ['created_at', 'createdAt', 'CreatedAt', 'created'],
  startTime: ['start_time', 'startTime', 'StartTime', 'started_at', 'startedAt'],
  endTime: ['end_time', 'endTime', 'EndTime', 'ended_at', 'endedAt'],
  progress: ['progress', 'Progress'],
  npc: ['npc', 'Npc', 'NPC'],
  plant: ['plant', 'Plant']
};

const REMOTE_MIRROR_CONFIG = {
  users: {
    table: 'remote_users',
    columns: {
      created_at: { aliases: REMOTE_FIELD_ALIASES.createdAt, parser: dateStringOrNull }
    }
  },
  sessions: {
    table: 'remote_sessions',
    columns: {
      user_id: { aliases: REMOTE_FIELD_ALIASES.userId, parser: stringOrNull },
      start_time: { aliases: REMOTE_FIELD_ALIASES.startTime, parser: dateStringOrNull },
      end_time: { aliases: REMOTE_FIELD_ALIASES.endTime, parser: dateStringOrNull },
      progress: { aliases: REMOTE_FIELD_ALIASES.progress, parser: numberOrNull }
    }
  },
  coffee_sessions: {
    table: 'remote_coffee_sessions',
    columns: {
      user_id: { aliases: REMOTE_FIELD_ALIASES.userId, parser: stringOrNull },
      start_time: { aliases: REMOTE_FIELD_ALIASES.startTime, parser: dateStringOrNull },
      end_time: { aliases: REMOTE_FIELD_ALIASES.endTime, parser: dateStringOrNull },
      npc: { aliases: REMOTE_FIELD_ALIASES.npc, parser: stringOrNull }
    }
  },
  plant_sessions: {
    table: 'remote_plant_sessions',
    columns: {
      user_id: { aliases: REMOTE_FIELD_ALIASES.userId, parser: stringOrNull },
      start_time: { aliases: REMOTE_FIELD_ALIASES.startTime, parser: dateStringOrNull },
      end_time: { aliases: REMOTE_FIELD_ALIASES.endTime, parser: dateStringOrNull },
      plant: { aliases: REMOTE_FIELD_ALIASES.plant, parser: stringOrNull }
    }
  }
};

ensureDataDirectory(CONFIG.dbPath);

const db = new Database(CONFIG.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

initSchema(db);
backfillRemoteMirrorTypedColumns(db);

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use('/assets', express.static(path.join(__dirname, 'public')));

app.use((req, res, next) => {
  if (CONFIG.debugMode) {
    console.log(`${new Date().toISOString()} ${req.method} ${req.originalUrl}`);
  }
  next();
});

app.get('/health', (_req, res) => {
  res.type('text/plain').send('Game Logger Node.js + SQLite - OK');
});

app.get('/', (_req, res) => {
  res.type('html').send(`
    <html>
      <body style="font-family:sans-serif; text-align:center; padding:50px;">
        <h1>Game Logger</h1>
        <p>Status: Online</p>
        <a href="/logs/list" style="padding:10px 20px; background:#007bff; color:white; text-decoration:none; border-radius:5px;">View Logs</a>
      </body>
    </html>
  `);
});

app.get('/app', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'app.html'));
});

app.get('/api/meta', (req, res) => {
  try {
    const source = getRequestSource(req);
    res.json({
      success: true,
      database: {
        type: source.type,
        path: source.type === 'sqlite' ? CONFIG.dbPath : source.url
      },
      ai: {
        defaultProvider: CONFIG.aiProvider,
        defaultModel: CONFIG.aiModel,
        providers: getProviderPresets()
      },
      limits: {
        maxQueryRows: CONFIG.maxQueryRows
      }
    });
  } catch (error) {
    sendError(res, error.message, 400);
  }
});

app.get('/api/db/tables', async (req, res) => {
  try {
    const source = getRequestSource(req);
    if (source.type === 'customHttp') {
      return res.json({ success: true, tables: listCustomHttpTables(source) });
    }

    if (source.type === 'gameLoggerHttp' && hasSyncedRemoteSource(source)) {
      const tables = getSyncedRemoteSchema(source).map((table) => {
        const rowCount = db.prepare(`SELECT COUNT(*) AS total FROM ${quoteIdentifier(table.name)} WHERE source_url = ?`).get(source.url).total;
        return {
          name: table.name,
          rowCount,
          columns: table.columns,
          synced: true
        };
      });
      return res.json({ success: true, tables });
    }

    if (source.type === 'gameLoggerHttp') {
      return res.json({ success: true, tables: await listRemoteGameLoggerTables(source) });
    }

    const tables = listTables().map((table) => {
      const rowCount = db.prepare(`SELECT COUNT(*) AS total FROM ${quoteIdentifier(table.name)}`).get().total;
      return {
        name: table.name,
        rowCount,
        columns: getTableSchema(table.name)
      };
    });
    res.json({ success: true, tables: tables.concat(listLocalCustomCacheTables()) });
  } catch (error) {
    sendError(res, `Table list error: ${error.message}`, 500);
  }
});

app.get('/api/db/schema', async (req, res) => {
  try {
    const source = getRequestSource(req);
    if (source.type === 'customHttp') {
      return res.json({ success: true, schema: getCustomHttpSchema(source) });
    }

    res.json({
      success: true,
      schema: source.type === 'gameLoggerHttp' && hasSyncedRemoteSource(source)
        ? getSyncedRemoteSchema(source)
        : source.type === 'gameLoggerHttp'
          ? getRemoteGameLoggerSchema()
          : getDatabaseSchema()
    });
  } catch (error) {
    sendError(res, `Schema error: ${error.message}`, 500);
  }
});

app.get('/api/db/tables/:table/schema', (req, res) => {
  try {
    const source = getRequestSource(req);
    if (source.type === 'customHttp') {
      const table = getCustomHttpTable(source, req.params.table);
      const sqliteTable = getCustomSqliteTableName(table.name);
      return res.json({ success: true, table: sqliteTable, columns: getCustomSqliteTableSchema(sqliteTable) });
    }

    if (source.type === 'gameLoggerHttp' && hasSyncedRemoteSource(source)) {
      const table = assertKnownTable(req.params.table);
      if (!table.startsWith('remote_')) {
        throw new Error(`Unknown synced table: ${table}`);
      }
      return res.json({ success: true, table, columns: getSyncedRemoteTableSchema(table) });
    }

    if (source.type === 'gameLoggerHttp') {
      const remoteTable = getRemoteGameLoggerTable(req.params.table);
      return res.json({ success: true, table: remoteTable.name, columns: remoteTable.columns });
    }

    if (isLocalCustomCacheTable(req.params.table)) {
      return res.json({ success: true, table: req.params.table, columns: getCustomSqliteTableSchema(req.params.table) });
    }

    const table = assertKnownTable(req.params.table);
    res.json({ success: true, table, columns: getTableSchema(table) });
  } catch (error) {
    sendError(res, error.message, 400);
  }
});

app.get('/api/db/tables/:table/rows', async (req, res) => {
  try {
    const source = getRequestSource(req);
    if (source.type === 'customHttp') {
      const table = getCustomHttpTable(source, req.params.table);
      let page = parsePositiveInteger(req.query.page, 1);
      let limit = parsePositiveInteger(req.query.limit, 50);
      limit = clamp(limit, 1, CONFIG.maxQueryRows);
      const result = getCustomHttpRows(source, table.name, page, limit);
      return res.json({
        success: true,
        table: getCustomSqliteTableName(table.name),
        columns: result.columns,
        rows: result.rows,
        pagination: result.pagination
      });
    }

    if (source.type === 'gameLoggerHttp' && hasSyncedRemoteSource(source)) {
      const table = assertKnownTable(req.params.table);
      if (!table.startsWith('remote_')) {
        throw new Error(`Unknown synced table: ${table}`);
      }
      let page = parsePositiveInteger(req.query.page, 1);
      let limit = parsePositiveInteger(req.query.limit, 50);
      limit = clamp(limit, 1, CONFIG.maxQueryRows);
      const offset = (page - 1) * limit;
      const total = db.prepare(`SELECT COUNT(*) AS total FROM ${quoteIdentifier(table)} WHERE source_url = ?`).get(source.url).total;
      const rows = db.prepare(`
        SELECT *
        FROM ${quoteIdentifier(table)}
        WHERE source_url = ?
        LIMIT ? OFFSET ?
      `).all(source.url, limit, offset);

      return res.json({
        success: true,
        table,
        columns: getSyncedRemoteTableSchema(table),
        rows,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.max(1, Math.ceil(total / limit))
        }
      });
    }

    if (source.type === 'gameLoggerHttp') {
      const remoteTable = getRemoteGameLoggerTable(req.params.table);
      let page = parsePositiveInteger(req.query.page, 1);
      let limit = parsePositiveInteger(req.query.limit, 50);
      limit = clamp(limit, 1, CONFIG.maxQueryRows);
      const result = await fetchRemoteGameLoggerRows(source, remoteTable.name, page, limit);
      return res.json({
        success: true,
        table: remoteTable.name,
        columns: remoteTable.columns,
        rows: result.rows,
        pagination: result.pagination
      });
    }

    if (isLocalCustomCacheTable(req.params.table)) {
      let page = parsePositiveInteger(req.query.page, 1);
      let limit = parsePositiveInteger(req.query.limit, 50);
      limit = clamp(limit, 1, CONFIG.maxQueryRows);
      const result = getLocalCustomCacheRows(req.params.table, page, limit);
      return res.json({
        success: true,
        table: req.params.table,
        columns: result.columns,
        rows: result.rows,
        pagination: result.pagination
      });
    }

    const table = assertKnownTable(req.params.table);
    let page = parsePositiveInteger(req.query.page, 1);
    let limit = parsePositiveInteger(req.query.limit, 50);
    limit = clamp(limit, 1, CONFIG.maxQueryRows);
    const offset = (page - 1) * limit;

    const total = db.prepare(`SELECT COUNT(*) AS total FROM ${quoteIdentifier(table)}`).get().total;
    const rows = db.prepare(`
      SELECT *
      FROM ${quoteIdentifier(table)}
      LIMIT ? OFFSET ?
    `).all(limit, offset);

    res.json({
      success: true,
      table,
      columns: getTableSchema(table),
      rows,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit))
      }
    });
  } catch (error) {
    sendError(res, error.message, 400);
  }
});

app.post('/api/db/query', (req, res) => {
  try {
    const source = getRequestSource(req);
    if (source.type === 'customHttp') {
      if (!hasSyncedCustomSource(source)) {
        return sendError(res, 'Sync the custom HTTP data source before running SQL.', 400);
      }
      const inputSql = String((req.body && req.body.sql) || '');
      if (!inputSql.includes(source.url)) {
        return sendError(res, `Custom HTTP SQL must filter the current data source with source_url = '${source.url}'.`, 400);
      }
      const limit = clamp(parsePositiveInteger(req.body && req.body.limit, 100), 1, CONFIG.maxQueryRows);
      const prepared = prepareReadOnlySql(inputSql, limit);
      const startedAt = Date.now();
      const rows = db.prepare(prepared.sql).all();
      return res.json({
        success: true,
        sql: prepared.sql,
        rows,
        columns: rows.length ? Object.keys(rows[0]) : [],
        rowCount: rows.length,
        elapsedMs: Date.now() - startedAt,
        limited: prepared.limited
      });
    }

    const isSyncedRemote = source.type === 'gameLoggerHttp' && hasSyncedRemoteSource(source);
    if (source.type !== 'sqlite' && !isSyncedRemote) {
      return sendError(res, 'Read-only SQL is available for Local SQLite or synced HTTP data sources only. Sync the data source first.', 400);
    }

    const limit = clamp(parsePositiveInteger(req.body && req.body.limit, 100), 1, CONFIG.maxQueryRows);
    const inputSql = String((req.body && req.body.sql) || '');
    if (isSyncedRemote && !inputSql.includes(source.url)) {
      return sendError(res, `Synced remote SQL must filter the current data source with source_url = '${source.url}'.`, 400);
    }
    const prepared = prepareReadOnlySql(inputSql, limit);
    const startedAt = Date.now();
    const rows = db.prepare(prepared.sql).all();
    res.json({
      success: true,
      sql: prepared.sql,
      rows,
      columns: rows.length ? Object.keys(rows[0]) : [],
      rowCount: rows.length,
      elapsedMs: Date.now() - startedAt,
      limited: prepared.limited
    });
  } catch (error) {
    sendError(res, `Query error: ${error.message}`, 400);
  }
});

app.post('/api/sources/sync', async (req, res) => {
  try {
    const source = getRequestSource(req);
    if (source.type === 'customHttp') {
      const result = await syncCustomHttpSource(source);
      return res.json({ success: true, source: { type: source.type, url: source.url }, result });
    }

    if (source.type !== 'gameLoggerHttp') {
      return sendError(res, 'Sync is available for Cloudflare Worker or Game Logger HTTP API data sources only.', 400);
    }

    const result = await syncRemoteGameLoggerSource(source);
    res.json({ success: true, source, result });
  } catch (error) {
    sendError(res, `Sync error: ${error.message}`, 400);
  }
});

app.get('/api/sources/sync/status', (req, res) => {
  try {
    const source = getRequestSource(req);
    if (source.type === 'customHttp') {
      return res.json({ success: true, synced: hasSyncedCustomSource(source), tables: getCustomSyncStatus(source) });
    }

    if (source.type !== 'gameLoggerHttp') {
      return res.json({ success: true, synced: false, tables: [] });
    }

    res.json({ success: true, synced: hasSyncedRemoteSource(source), tables: getRemoteSyncStatus(source) });
  } catch (error) {
    sendError(res, `Sync status error: ${error.message}`, 400);
  }
});

app.post('/users', (_req, res) => {
  try {
    const userId = crypto.randomUUID();
    const createdAt = Date.now();
    db.prepare('INSERT INTO users (id, created_at) VALUES (?, ?)').run(userId, createdAt);
    res.json({ success: true, data: { id: userId, created_at: createdAt } });
  } catch (error) {
    sendError(res, `SQLite User Error: ${error.message}`, 500);
  }
});

app.get('/users', (req, res) => {
  handlePaginatedTable(req, res, {
    table: 'users',
    orderBy: 'created_at',
    responseKey: 'data'
  });
});

app.post('/session', (req, res) => {
  try {
    const { user_id, start_time, end_time, progress } = req.body || {};
    if (!user_id || !start_time) {
      return sendError(res, 'Missing user_id or start_time', 400);
    }

    db.prepare(
      'INSERT INTO sessions (user_id, start_time, end_time, progress) VALUES (?, ?, ?, ?)'
    ).run(user_id, start_time, end_time || null, progress || 0);

    res.json({ success: true, message: 'Session recorded' });
  } catch (error) {
    sendError(res, `SQLite Session Error: ${error.message}`, 500);
  }
});

app.get('/session', (req, res) => {
  handlePaginatedTable(req, res, {
    table: 'sessions',
    orderBy: 'start_time',
    responseKey: 'data'
  });
});

app.post('/coffee', (req, res) => {
  try {
    const { user_id, start_time, end_time, npc } = req.body || {};
    if (!user_id || !start_time) {
      return sendError(res, 'Missing user_id or start_time', 400);
    }

    db.prepare(
      'INSERT INTO coffee_sessions (user_id, start_time, end_time, npc) VALUES (?, ?, ?, ?)'
    ).run(user_id, start_time, end_time || null, npc || '');

    res.json({ success: true, message: 'Coffee session recorded' });
  } catch (error) {
    sendError(res, `SQLite Coffee Session Error: ${error.message}`, 500);
  }
});

app.get('/coffee', (req, res) => {
  handlePaginatedTable(req, res, {
    table: 'coffee_sessions',
    orderBy: 'start_time',
    responseKey: 'data'
  });
});

app.post('/plant', (req, res) => {
  try {
    const { user_id, start_time, end_time, plant } = req.body || {};
    if (!user_id || !start_time) {
      return sendError(res, 'Missing user_id or start_time', 400);
    }

    db.prepare(
      'INSERT INTO plant_sessions (user_id, start_time, end_time, plant) VALUES (?, ?, ?, ?)'
    ).run(user_id, start_time, end_time || null, plant || '');

    res.json({ success: true, message: 'Plant session recorded' });
  } catch (error) {
    sendError(res, `SQLite Plant Session Error: ${error.message}`, 500);
  }
});

app.get('/plant', (req, res) => {
  handlePaginatedTable(req, res, {
    table: 'plant_sessions',
    orderBy: 'start_time',
    responseKey: 'data'
  });
});

app.post('/logs', (req, res) => {
  try {
    const payload = req.body || {};
    const owner = payload.Owner;
    if (!owner) {
      return sendError(res, 'Missing Owner', 400);
    }

    const now = new Date().toISOString();
    const sessionId = payload.SessionId || crypto.randomUUID();

    db.prepare(`
      INSERT INTO log_owners (owner, created_at, last_updated)
      VALUES (?, ?, ?)
      ON CONFLICT(owner) DO UPDATE SET last_updated = excluded.last_updated
    `).run(owner, now, now);

    db.prepare(`
      INSERT INTO log_sessions (owner, session_id, collection_time, received_at, logs_json)
      VALUES (?, ?, ?, ?, ?)
    `).run(owner, sessionId, payload.CollectionTime || null, now, JSON.stringify(payload.Logs || {}));

    const totalSessions = db.prepare(
      'SELECT COUNT(*) AS total FROM log_sessions WHERE owner = ?'
    ).get(owner).total;

    res.json({ success: true, owner, totalSessions });
  } catch (error) {
    sendError(res, `SQLite Log Error: ${error.message}`, 500);
  }
});

app.get('/logs', (req, res) => {
  const owner = req.query.owner;
  if (!owner) {
    return res.redirect('/logs/list');
  }

  try {
    const sessions = db.prepare(`
      SELECT session_id, collection_time, received_at, logs_json
      FROM log_sessions
      WHERE owner = ?
      ORDER BY received_at DESC
    `).all(owner);

    if (!sessions.length) {
      return sendError(res, 'No logs for this player', 404);
    }

    const data = {
      owner,
      sessions: sessions.map((row) => ({
        sessionId: row.session_id,
        collectionTime: row.collection_time,
        receivedAt: row.received_at,
        logs: safeJsonParse(row.logs_json, {})
      }))
    };

    res.type('html').send(generateLogViewHTML(data));
  } catch (error) {
    sendError(res, error.message, 500);
  }
});

app.get('/logs/list', (req, res) => {
  let page = parsePositiveInteger(req.query.page, 1);
  let limit = parsePositiveInteger(req.query.limit, 20);
  if (limit > 100) limit = 100;

  try {
    const total = db.prepare('SELECT COUNT(*) AS total FROM log_owners').get().total;
    const offset = (page - 1) * limit;

    const players = db.prepare(`
      SELECT
        o.owner,
        o.last_updated AS lastModified,
        COUNT(s.id) AS totalSessions
      FROM log_owners o
      LEFT JOIN log_sessions s ON s.owner = o.owner
      GROUP BY o.owner, o.last_updated
      ORDER BY o.last_updated DESC
      LIMIT ? OFFSET ?
    `).all(limit, offset);

    res.type('html').send(generatePlayerListHTML(players, {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit))
    }));
  } catch (error) {
    sendError(res, error.message, 500);
  }
});

app.get('/logs/download/:owner', (req, res) => {
  const { owner } = req.params;

  try {
    const ownerRow = db.prepare(
      'SELECT owner, created_at, last_updated FROM log_owners WHERE owner = ?'
    ).get(owner);

    if (!ownerRow) {
      return sendError(res, 'Not found', 404);
    }

    const sessions = db.prepare(`
      SELECT session_id, collection_time, received_at, logs_json
      FROM log_sessions
      WHERE owner = ?
      ORDER BY received_at ASC
    `).all(owner);

    const payload = {
      owner: ownerRow.owner,
      createdAt: ownerRow.created_at,
      lastUpdated: ownerRow.last_updated,
      sessions: sessions.map((row) => ({
        sessionId: row.session_id,
        collectionTime: row.collection_time,
        receivedAt: row.received_at,
        logs: safeJsonParse(row.logs_json, {})
      }))
    };

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${owner}.json"`);
    res.send(JSON.stringify(payload, null, 2));
  } catch (error) {
    sendError(res, error.message, 500);
  }
});

app.post('/logs/cleanup', (req, res) => {
  if (!CONFIG.adminApiKey || req.get('X-Admin-Key') !== CONFIG.adminApiKey) {
    return sendError(res, 'Unauthorized', 401);
  }

  try {
    const deletedCount = deleteOldLogs(CONFIG.retentionDays);
    res.json({ success: true, deletedCount });
  } catch (error) {
    sendError(res, error.message, 500);
  }
});

app.post('/api/ai/analyze', async (req, res) => {
  try {
    const body = req.body || {};
    const question = String(body.question || '').trim();
    if (!question) {
      return sendError(res, 'Question is required', 400);
    }

    const provider = String(body.provider || CONFIG.aiProvider || 'openai').toLowerCase();
    const providerPreset = getProviderPresets()[provider] || getProviderPresets().openai;
    const model = String(body.model || CONFIG.aiModel || providerPreset.defaultModel || '').trim();
    const apiKey = String(body.apiKey || getProviderApiKey(provider) || '').trim();
    const baseUrl = String(body.baseUrl || CONFIG.aiBaseUrl || providerPreset.baseUrl || '').trim();
    const source = getRequestSource(req);
    if (source.type === 'customHttp') {
      const aiConfigured = Boolean(apiKey && model);
      const customAnalysis = await analyzeCustomHttpSource({
        source,
        question,
        limit: body.limit,
        aiConfigured,
        provider,
        model,
        apiKey,
        baseUrl
      });
      return res.json({
        success: true,
        provider,
        model,
        aiConfigured,
        wantsChart: shouldGenerateChart(question),
        plan: customAnalysis.plan,
        query: customAnalysis.query,
        analysis: customAnalysis.analysis,
        chart: customAnalysis.chart
      });
    }

    const useSyncedRemote = source.type === 'gameLoggerHttp' && hasSyncedRemoteSource(source);
    const schema = useSyncedRemote
      ? getSyncedRemoteSchema(source)
      : source.type === 'gameLoggerHttp'
        ? getRemoteGameLoggerSchema()
        : getDatabaseSchema();
    let aiConfigured = Boolean(apiKey && model);

    if (useSyncedRemote) {
      return await respondWithSqlAiAnalysis(res, {
        provider,
        model,
        apiKey,
        baseUrl,
        question,
        schema,
        aiConfigured,
        limit: body.limit,
        source
      });
    }

    if (source.type === 'gameLoggerHttp') {
      const remoteAnalysis = await analyzeRemoteGameLoggerSource({
        source,
        question,
        limit: body.limit,
        schema,
        aiConfigured,
        provider,
        model,
        apiKey,
        baseUrl
      });
      return res.json({
        success: true,
        provider,
        model,
        aiConfigured,
        wantsChart: shouldGenerateChart(question),
        plan: remoteAnalysis.plan,
        query: remoteAnalysis.query,
        analysis: remoteAnalysis.analysis,
        chart: remoteAnalysis.chart
      });
    }

    return await respondWithSqlAiAnalysis(res, {
      provider,
      model,
      apiKey,
      baseUrl,
      question,
      schema,
      aiConfigured,
      limit: body.limit,
      source
    });
  } catch (error) {
    sendError(res, `AI analysis error: ${error.message}`, 400);
  }
});

app.use((_req, res) => {
  sendError(res, 'Not Found', 404);
});

app.listen(CONFIG.port, () => {
  console.log(`Game Logger listening on port ${CONFIG.port}`);
  console.log(`SQLite DB: ${CONFIG.dbPath}`);
});

function initSchema(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      start_time INTEGER NOT NULL,
      end_time INTEGER,
      progress INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS coffee_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      start_time INTEGER NOT NULL,
      end_time INTEGER,
      npc TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS plant_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      start_time INTEGER NOT NULL,
      end_time INTEGER,
      plant TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS log_owners (
      owner TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      last_updated TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS log_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner TEXT NOT NULL,
      session_id TEXT NOT NULL,
      collection_time TEXT,
      received_at TEXT NOT NULL,
      logs_json TEXT NOT NULL,
      FOREIGN KEY(owner) REFERENCES log_owners(owner) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS remote_sync_meta (
      source_url TEXT NOT NULL,
      table_name TEXT NOT NULL,
      synced_at TEXT NOT NULL,
      row_count INTEGER NOT NULL,
      total_rows INTEGER NOT NULL,
      PRIMARY KEY(source_url, table_name)
    );

    CREATE TABLE IF NOT EXISTS remote_users (
      source_url TEXT NOT NULL,
      id TEXT NOT NULL,
      created_at TEXT,
      raw_json TEXT NOT NULL,
      synced_at TEXT NOT NULL,
      PRIMARY KEY(source_url, id)
    );

    CREATE TABLE IF NOT EXISTS remote_sessions (
      source_url TEXT NOT NULL,
      id TEXT NOT NULL,
      user_id TEXT,
      start_time TEXT,
      end_time TEXT,
      progress INTEGER,
      raw_json TEXT NOT NULL,
      synced_at TEXT NOT NULL,
      PRIMARY KEY(source_url, id)
    );

    CREATE TABLE IF NOT EXISTS remote_coffee_sessions (
      source_url TEXT NOT NULL,
      id TEXT NOT NULL,
      user_id TEXT,
      start_time TEXT,
      end_time TEXT,
      npc TEXT,
      raw_json TEXT NOT NULL,
      synced_at TEXT NOT NULL,
      PRIMARY KEY(source_url, id)
    );

    CREATE TABLE IF NOT EXISTS remote_plant_sessions (
      source_url TEXT NOT NULL,
      id TEXT NOT NULL,
      user_id TEXT,
      start_time TEXT,
      end_time TEXT,
      plant TEXT,
      raw_json TEXT NOT NULL,
      synced_at TEXT NOT NULL,
      PRIMARY KEY(source_url, id)
    );

    CREATE TABLE IF NOT EXISTS remote_generic_rows (
      source_url TEXT NOT NULL,
      table_name TEXT NOT NULL,
      row_id TEXT NOT NULL,
      raw_json TEXT NOT NULL,
      synced_at TEXT NOT NULL,
      PRIMARY KEY(source_url, table_name, row_id)
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_start_time ON sessions(start_time DESC);
    CREATE INDEX IF NOT EXISTS idx_coffee_start_time ON coffee_sessions(start_time DESC);
    CREATE INDEX IF NOT EXISTS idx_plant_start_time ON plant_sessions(start_time DESC);
    CREATE INDEX IF NOT EXISTS idx_log_owner_received_at ON log_sessions(owner, received_at DESC);
    CREATE INDEX IF NOT EXISTS idx_remote_sessions_source_progress ON remote_sessions(source_url, progress);
    CREATE INDEX IF NOT EXISTS idx_remote_sessions_source_user ON remote_sessions(source_url, user_id);
    CREATE INDEX IF NOT EXISTS idx_remote_generic_source_table ON remote_generic_rows(source_url, table_name);
  `);
}

function backfillRemoteMirrorTypedColumns(database) {
  const transaction = database.transaction(() => {
    for (const config of Object.values(REMOTE_MIRROR_CONFIG)) {
      const columnNames = Object.keys(config.columns);
      const rows = database.prepare(`
        SELECT source_url, id, raw_json
        FROM ${quoteIdentifier(config.table)}
        WHERE raw_json IS NOT NULL
      `).all();

      const assignments = columnNames.map((column) => `${quoteIdentifier(column)} = COALESCE(?, ${quoteIdentifier(column)})`).join(', ');
      const update = database.prepare(`
        UPDATE ${quoteIdentifier(config.table)}
        SET ${assignments}
        WHERE source_url = ?
          AND id = ?
      `);

      for (const row of rows) {
        const raw = safeJsonParse(row.raw_json, {});
        const values = columnNames.map((column) => normalizeRemoteField(raw, config.columns[column]));
        update.run(...values, row.source_url, row.id);
      }
    }
  });

  transaction();
}

function handlePaginatedTable(req, res, options) {
  const table = options.table;
  const orderBy = options.orderBy;
  let page = parsePositiveInteger(req.query.page, 1);
  let limit = parsePositiveInteger(req.query.limit, 20);

  if (limit > 100) limit = 100;

  const offset = (page - 1) * limit;

  try {
    const total = db.prepare(`SELECT COUNT(*) AS total FROM ${table}`).get().total;
    const rows = db.prepare(`
      SELECT * FROM ${table}
      ORDER BY ${orderBy} DESC
      LIMIT ? OFFSET ?
    `).all(limit, offset);

    res.json({
      success: true,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      },
      [options.responseKey]: rows
    });
  } catch (error) {
    sendError(res, `SQLite Select Error: ${error.message}`, 500);
  }
}

async function respondWithSqlAiAnalysis(res, context) {
  let plan;
  if (context.aiConfigured) {
    plan = await requestAnalysisPlan(context);
  } else {
    plan = buildLocalAnalysisPlan(context.question, context.schema);
  }

  const sqlLimit = clamp(parsePositiveInteger(context.limit, 100), 1, CONFIG.maxQueryRows);
  const prepared = prepareReadOnlySql(plan.sql, sqlLimit);
  const startedAt = Date.now();
  const rows = db.prepare(prepared.sql).all();
  const queryResult = {
    sql: prepared.sql,
    rows,
    columns: rows.length ? Object.keys(rows[0]) : [],
    rowCount: rows.length,
    elapsedMs: Date.now() - startedAt
  };

  let narrative;
  if (context.aiConfigured) {
    narrative = await requestAnalysisNarrative({
      provider: context.provider,
      model: context.model,
      apiKey: context.apiKey,
      baseUrl: context.baseUrl,
      question: context.question,
      schema: context.schema,
      plan,
      queryResult
    });
  } else {
    narrative = buildLocalNarrative(context.question, plan, queryResult);
  }

  res.json({
    success: true,
    provider: context.provider,
    model: context.model,
    aiConfigured: context.aiConfigured,
    dataMode: context.source && context.source.type === 'gameLoggerHttp' ? 'synced-sqlite' : 'sqlite',
    wantsChart: shouldGenerateChart(context.question),
    plan,
    query: queryResult,
    analysis: narrative.analysis,
    chart: narrative.chart
  });
}

function deleteOldLogs(retentionDays) {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
  const cutoffIso = cutoffDate.toISOString();

  const deleted = db.prepare(
    'DELETE FROM log_sessions WHERE received_at < ?'
  ).run(cutoffIso);

  db.prepare(`
    DELETE FROM log_owners
    WHERE owner NOT IN (SELECT DISTINCT owner FROM log_sessions)
  `).run();

  return deleted.changes;
}

function getRequestSource(req) {
  const bodySource = req.body && req.body.source ? req.body.source : {};
  const type = String(bodySource.type || req.query.sourceType || 'sqlite');
  const url = String(bodySource.url || req.query.sourceUrl || '').trim().replace(/\/+$/g, '');
  const configText = bodySource.config || req.query.sourceConfig || '';

  if (type === 'customHttp') {
    if (!url || !/^https?:\/\//i.test(url)) {
      throw new Error('A valid Data Source URL is required for Custom HTTP data sources');
    }
    return { type: 'customHttp', url, tables: parseCustomSourceTables(configText) };
  }

  if (type === 'gameLoggerHttp' || type === 'cloudflareWorker') {
    if (!url || !/^https?:\/\//i.test(url)) {
      throw new Error('A valid Data Source URL is required for Game Logger HTTP API');
    }
    return { type: 'gameLoggerHttp', url };
  }

  return { type: 'sqlite', url: '' };
}

function parseCustomSourceTables(configText) {
  let parsed;
  try {
    parsed = JSON.parse(String(configText || '[]'));
  } catch (_error) {
    throw new Error('Tables Config JSON is invalid');
  }
  if (!Array.isArray(parsed) || !parsed.length) {
    throw new Error('Tables Config JSON must be a non-empty array');
  }
  return parsed.map((item) => {
    const name = String(item.name || '').trim();
    const endpoint = String(item.endpoint || '').trim();
    const responseKey = item.responseKey === undefined ? 'data' : String(item.responseKey);
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
      throw new Error(`Invalid custom table name: ${name}`);
    }
    if (!endpoint.startsWith('/')) {
      throw new Error(`Endpoint for ${name} must start with /`);
    }
    return { name, endpoint, responseKey };
  });
}

async function syncRemoteGameLoggerSource(source) {
  const syncedAt = new Date().toISOString();
  const summary = {};

  for (const table of Object.values(getRemoteGameLoggerTables())) {
    const rows = await fetchAllRemoteGameLoggerRows(source, table.name);
    replaceRemoteMirrorRows(source, table.name, rows, syncedAt);
    db.prepare(`
      INSERT INTO remote_sync_meta (source_url, table_name, synced_at, row_count, total_rows)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(source_url, table_name) DO UPDATE SET
        synced_at = excluded.synced_at,
        row_count = excluded.row_count,
        total_rows = excluded.total_rows
    `).run(source.url, getRemoteMirrorTableName(table.name), syncedAt, rows.length, rows.length);
    const quality = getRemoteMirrorQuality(source, getRemoteMirrorTableName(table.name));
    summary[getRemoteMirrorTableName(table.name)] = {
      syncedRows: rows.length,
      totalRows: rows.length,
      syncedAt,
      quality
    };
  }

  return summary;
}

async function syncCustomHttpSource(source) {
  const syncedAt = new Date().toISOString();
  const summary = {};
  const transaction = db.transaction((table, rows) => {
    const sqliteTable = getCustomSqliteTableName(table.name);
    ensureCustomSqliteTable(sqliteTable, rows);
    db.prepare(`DELETE FROM ${quoteIdentifier(sqliteTable)} WHERE source_url = ?`).run(source.url);
    db.prepare('DELETE FROM remote_generic_rows WHERE source_url = ? AND table_name = ?').run(source.url, table.name);
    const insertRaw = db.prepare(`
      INSERT OR REPLACE INTO remote_generic_rows (source_url, table_name, row_id, raw_json, synced_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    const insertStructured = prepareCustomStructuredInsert(sqliteTable, rows);
    rows.forEach((row, index) => {
      const rowId = getGenericRowId(row, index);
      const rawJson = JSON.stringify(row || {});
      insertRaw.run(source.url, table.name, rowId, rawJson, syncedAt);
      insertStructured.run(...buildCustomStructuredValues(source.url, rowId, row, rawJson, syncedAt, insertStructured.columns));
    });
    db.prepare(`
      INSERT INTO remote_sync_meta (source_url, table_name, synced_at, row_count, total_rows)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(source_url, table_name) DO UPDATE SET
        synced_at = excluded.synced_at,
        row_count = excluded.row_count,
        total_rows = excluded.total_rows
    `).run(source.url, `custom_${table.name}`, syncedAt, rows.length, rows.length);
  });

  for (const table of source.tables) {
    const rows = await fetchAllCustomRows(source, table);
    transaction(table, rows);
    summary[getCustomSqliteTableName(table.name)] = { syncedRows: rows.length, totalRows: rows.length, syncedAt };
  }
  return summary;
}

function getCustomSqliteTableName(tableName) {
  return `custom_${tableName}`;
}

function ensureCustomSqliteTable(sqliteTable, rows) {
  db.prepare(`
    CREATE TABLE IF NOT EXISTS ${quoteIdentifier(sqliteTable)} (
      source_url TEXT NOT NULL,
      row_id TEXT NOT NULL,
      raw_json TEXT NOT NULL,
      synced_at TEXT NOT NULL,
      PRIMARY KEY(source_url, row_id)
    )
  `).run();

  const existingColumns = new Set(getTableSchema(sqliteTable).map((column) => column.name));
  for (const column of inferCustomStructuredColumns(rows)) {
    if (!existingColumns.has(column.name)) {
      db.prepare(`ALTER TABLE ${quoteIdentifier(sqliteTable)} ADD COLUMN ${quoteIdentifier(column.name)} ${column.type}`).run();
      existingColumns.add(column.name);
    }
  }
}

function inferCustomStructuredColumns(rows) {
  const columns = new Map();
  for (const row of rows) {
    for (const [key, value] of Object.entries(row || {})) {
      const columnName = normalizeSqliteColumnName(key);
      if (['source_url', 'row_id', 'raw_json', 'synced_at'].includes(columnName)) continue;
      const existing = columns.get(columnName);
      const nextType = inferSqliteType(key, value);
      columns.set(columnName, existing === 'TEXT' ? existing : nextType);
    }
  }
  return Array.from(columns.entries()).map(([name, type]) => ({ name, type }));
}

function normalizeSqliteColumnName(key) {
  const normalized = String(key || '').trim().replace(/[^A-Za-z0-9_]/g, '_');
  const safe = normalized || 'field';
  return /^[A-Za-z_]/.test(safe) ? safe : `field_${safe}`;
}

function inferSqliteType(key, value) {
  if (/time|date|_at$/i.test(key)) return 'TEXT';
  if (typeof value === 'number' && Number.isInteger(value)) return 'INTEGER';
  if (typeof value === 'number') return 'REAL';
  if (typeof value === 'boolean') return 'INTEGER';
  return 'TEXT';
}

function prepareCustomStructuredInsert(sqliteTable, rows) {
  const columns = inferCustomStructuredColumns(rows).map((column) => column.name);
  const allColumns = ['source_url', 'row_id', ...columns, 'raw_json', 'synced_at'];
  const sql = `
    INSERT OR REPLACE INTO ${quoteIdentifier(sqliteTable)} (${allColumns.map(quoteIdentifier).join(', ')})
    VALUES (${allColumns.map(() => '?').join(', ')})
  `;
  const statement = db.prepare(sql);
  statement.columns = columns;
  return statement;
}

function buildCustomStructuredValues(sourceUrl, rowId, row, rawJson, syncedAt, columns) {
  const normalized = {};
  for (const [key, value] of Object.entries(row || {})) {
    normalized[normalizeSqliteColumnName(key)] = normalizeCustomStructuredValue(key, value);
  }
  return [
    sourceUrl,
    rowId,
    ...columns.map((column) => normalized[column] === undefined ? null : normalized[column]),
    rawJson,
    syncedAt
  ];
}

function normalizeCustomStructuredValue(key, value) {
  if (/time|date|_at$/i.test(key)) {
    return dateStringOrNull(value);
  }
  if (typeof value === 'boolean') {
    return value ? 1 : 0;
  }
  if (value && typeof value === 'object') {
    return JSON.stringify(value);
  }
  return value === undefined ? null : value;
}

async function fetchAllCustomRows(source, table) {
  const pageSize = Math.min(CONFIG.maxQueryRows, 500);
  let page = 1;
  let allRows = [];
  let totalPages = 1;

  do {
    const result = await fetchCustomRows(source, table, page, pageSize);
    allRows = allRows.concat(result.rows);
    totalPages = result.pagination.totalPages || 1;
    page += 1;
  } while (page <= totalPages);

  return allRows;
}

async function fetchCustomRows(source, table, page, limit) {
  const url = new URL(`${source.url}${table.endpoint}`);
  url.searchParams.set('page', String(page));
  url.searchParams.set('limit', String(limit));
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP data source returned ${response.status} for ${table.endpoint}`);
  }
  const data = await response.json();
  const rows = extractRowsFromResponse(data, table.responseKey);
  const pagination = data && data.pagination ? data.pagination : {};
  return {
    rows,
    pagination: {
      page: pagination.page || page,
      limit: pagination.limit || limit,
      total: pagination.total || rows.length,
      totalPages: pagination.totalPages || Math.max(1, Math.ceil(rows.length / limit))
    }
  };
}

function extractRowsFromResponse(data, responseKey) {
  if (responseKey === '' && Array.isArray(data)) return data;
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data[responseKey])) return data[responseKey];
  if (data && Array.isArray(data.data)) return data.data;
  if (data && Array.isArray(data.rows)) return data.rows;
  if (data && Array.isArray(data.items)) return data.items;
  return [];
}

function getGenericRowId(row, index) {
  const id = getField(row, REMOTE_FIELD_ALIASES.id) || getField(row, ['uuid', 'UUID', 'key', 'Key']);
  return id === null || id === undefined || id === '' ? `row_${index}` : String(id);
}

function listCustomHttpTables(source) {
  return source.tables.map((table) => {
    const sqliteTable = getCustomSqliteTableName(table.name);
    const row = doesTableExist(sqliteTable)
      ? db.prepare(`
        SELECT COUNT(*) AS total
        FROM ${quoteIdentifier(sqliteTable)}
        WHERE source_url = ?
      `).get(source.url)
      : { total: 0 };
    return {
      name: sqliteTable,
      rowCount: row.total,
      columns: getCustomSqliteTableSchema(sqliteTable),
      synced: row.total > 0
    };
  });
}

function getCustomHttpSchema(source) {
  return source.tables.map((table) => ({
    name: getCustomSqliteTableName(table.name),
    columns: getCustomSqliteTableSchema(getCustomSqliteTableName(table.name)),
    sourceUrl: source.url
  }));
}

function getCustomHttpTable(source, tableName) {
  const normalized = String(tableName || '').replace(/^custom_/, '');
  const table = source.tables.find((item) => item.name === normalized);
  if (!table) throw new Error(`Unknown custom table: ${tableName}`);
  return table;
}

function getCustomSqliteTableSchema(sqliteTable) {
  if (!doesTableExist(sqliteTable)) {
    return [
      schemaColumn('source_url', 'TEXT'),
      schemaColumn('row_id', 'TEXT'),
      schemaColumn('raw_json', 'TEXT'),
      schemaColumn('synced_at', 'TEXT datetime YYYY-MM-DD HH:mm:ss')
    ];
  }
  return getTableSchema(sqliteTable).map(normalizeRemoteSchemaColumn);
}

function inferCustomTableColumns(source, tableName) {
  const rows = db.prepare(`
    SELECT raw_json
    FROM remote_generic_rows
    WHERE source_url = ? AND table_name = ?
    LIMIT 50
  `).all(source.url, tableName);
  const names = new Set(['_row_id']);
  for (const row of rows) {
    Object.keys(safeJsonParse(row.raw_json, {})).forEach((key) => names.add(key));
  }
  return Array.from(names).map((name) => schemaColumn(name, inferColumnTypeFromName(name)));
}

function inferColumnTypeFromName(name) {
  if (['created_at', 'start_time', 'end_time'].includes(name) || /time|date|_at$/i.test(name)) {
    return 'TEXT datetime YYYY-MM-DD HH:mm:ss';
  }
  return 'TEXT';
}

function getCustomHttpRows(source, tableName, page, limit) {
  const sqliteTable = getCustomSqliteTableName(tableName);
  if (!doesTableExist(sqliteTable)) {
    return {
      rows: [],
      columns: getCustomSqliteTableSchema(sqliteTable),
      pagination: {
        page,
        limit,
        total: 0,
        totalPages: 1
      }
    };
  }

  const offset = (page - 1) * limit;
  const total = db.prepare(`
    SELECT COUNT(*) AS total
    FROM ${quoteIdentifier(sqliteTable)}
    WHERE source_url = ?
  `).get(source.url).total;
  const rows = db.prepare(`
    SELECT *
    FROM ${quoteIdentifier(sqliteTable)}
    WHERE source_url = ?
    LIMIT ? OFFSET ?
  `).all(source.url, limit, offset);
  return {
    rows,
    columns: getCustomSqliteTableSchema(sqliteTable),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit))
    }
  };
}

function normalizeGenericDisplayRow(row) {
  const data = safeJsonParse(row.raw_json, {});
  const normalized = { _row_id: row.row_id, ...data };
  for (const key of Object.keys(normalized)) {
    if (/time|date|_at$/i.test(key)) {
      normalized[key] = dateStringOrNull(normalized[key]) || normalized[key];
    }
  }
  return normalized;
}

function hasSyncedCustomSource(source) {
  const row = db.prepare('SELECT COUNT(*) AS total FROM remote_generic_rows WHERE source_url = ?').get(source.url);
  return row.total > 0;
}

function getCustomSyncStatus(source) {
  return db.prepare(`
    SELECT table_name AS tableName, synced_at AS syncedAt, row_count AS rowCount, total_rows AS totalRows
    FROM remote_sync_meta
    WHERE source_url = ? AND table_name LIKE 'custom_%'
    ORDER BY table_name ASC
  `).all(source.url);
}

function listLocalCustomCacheTables() {
  const rows = db.prepare(`
    SELECT table_name AS tableName, COUNT(*) AS sourceCount, SUM(row_count) AS rowCount
    FROM remote_sync_meta
    WHERE table_name LIKE 'custom_%'
    GROUP BY table_name
    ORDER BY table_name ASC
  `).all();

  return rows.map((row) => {
    const tableName = row.tableName.replace(/^custom_/, '');
    const sqliteTable = getCustomSqliteTableName(tableName);
    return {
      name: sqliteTable,
      rowCount: row.rowCount || 0,
      columns: getCustomSqliteTableSchema(sqliteTable),
      synced: true
    };
  });
}

function isLocalCustomCacheTable(tableName) {
  return /^custom_[A-Za-z_][A-Za-z0-9_]*$/.test(String(tableName || '')) && doesTableExist(tableName);
}

function getLocalCustomCacheRows(tableName, page, limit) {
  const offset = (page - 1) * limit;
  const total = db.prepare(`
    SELECT COUNT(*) AS total
    FROM ${quoteIdentifier(tableName)}
  `).get().total;
  const rows = db.prepare(`
    SELECT *
    FROM ${quoteIdentifier(tableName)}
    LIMIT ? OFFSET ?
  `).all(limit, offset);
  return {
    rows,
    columns: getCustomSqliteTableSchema(tableName),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit))
    }
  };
}

async function fetchAllRemoteGameLoggerRows(source, tableName) {
  const pageSize = Math.min(CONFIG.maxQueryRows, 500);
  let page = 1;
  let allRows = [];
  let totalPages = 1;

  do {
    const result = await fetchRemoteGameLoggerRows(source, tableName, page, pageSize);
    allRows = allRows.concat(result.rows);
    totalPages = result.pagination.totalPages || 1;
    page += 1;
  } while (page <= totalPages);

  return allRows;
}

function replaceRemoteMirrorRows(source, tableName, rows, syncedAt) {
  const mirrorTable = getRemoteMirrorTableName(tableName);
  const transaction = db.transaction(() => {
    db.prepare(`DELETE FROM ${quoteIdentifier(mirrorTable)} WHERE source_url = ?`).run(source.url);
    for (let index = 0; index < rows.length; index += 1) {
      insertRemoteMirrorRow(source, tableName, rows[index], index, syncedAt);
    }
  });
  transaction();
}

function insertRemoteMirrorRow(source, tableName, row, index, syncedAt) {
  const id = getRemoteRowId(tableName, row, index);
  const rawJson = JSON.stringify(row || {});
  const config = REMOTE_MIRROR_CONFIG[tableName];

  if (!config) {
    return;
  }

  const columns = Object.keys(config.columns);
  const values = columns.map((column) => normalizeRemoteField(row, config.columns[column]));
  const columnSql = ['source_url', 'id', ...columns, 'raw_json', 'synced_at'].map(quoteIdentifier).join(', ');
  const placeholders = ['source_url', 'id', ...columns, 'raw_json', 'synced_at'].map(() => '?').join(', ');

  db.prepare(`
    INSERT OR REPLACE INTO ${quoteIdentifier(config.table)} (${columnSql})
    VALUES (${placeholders})
  `).run(source.url, id, ...values, rawJson, syncedAt);
}

function getRemoteRowId(tableName, row, index) {
  const id = getField(row, REMOTE_FIELD_ALIASES.id);
  if (id !== null && id !== undefined && id !== '') {
    return String(id);
  }

  if (tableName === 'users') {
    const userId = getField(row, REMOTE_FIELD_ALIASES.userId);
    if (userId !== null && userId !== undefined && userId !== '') {
      return String(userId);
    }
  }

  return `${tableName}_${index}`;
}

function normalizeRemoteField(row, fieldConfig) {
  return fieldConfig.parser(getField(row, fieldConfig.aliases));
}

function getField(row, names) {
  for (const name of names) {
    if (Object.prototype.hasOwnProperty.call(row || {}, name)) {
      return row[name];
    }
  }
  return null;
}

function getRemoteMirrorTableName(remoteTableName) {
  const map = {
    users: 'remote_users',
    sessions: 'remote_sessions',
    coffee_sessions: 'remote_coffee_sessions',
    plant_sessions: 'remote_plant_sessions'
  };
  return map[remoteTableName] || remoteTableName;
}

function hasSyncedRemoteSource(source) {
  const row = db.prepare('SELECT COUNT(*) AS total FROM remote_sync_meta WHERE source_url = ?').get(source.url);
  return row.total > 0;
}

function getRemoteSyncStatus(source) {
  const rows = db.prepare(`
    SELECT table_name AS tableName, synced_at AS syncedAt, row_count AS rowCount, total_rows AS totalRows
    FROM remote_sync_meta
    WHERE source_url = ?
    ORDER BY table_name ASC
  `).all(source.url);
  return rows.map((row) => ({
    ...row,
    quality: getRemoteMirrorQuality(source, row.tableName)
  }));
}

function getRemoteMirrorQuality(source, tableName) {
  const trackedColumns = {
    remote_users: ['id', 'created_at'],
    remote_sessions: ['id', 'user_id', 'start_time', 'end_time', 'progress'],
    remote_coffee_sessions: ['id', 'user_id', 'start_time', 'end_time', 'npc'],
    remote_plant_sessions: ['id', 'user_id', 'start_time', 'end_time', 'plant']
  }[tableName];

  if (!trackedColumns) {
    return {};
  }

  const result = {};
  for (const column of trackedColumns) {
    result[column] = db.prepare(`
      SELECT COUNT(*) AS total
      FROM ${quoteIdentifier(tableName)}
      WHERE source_url = ?
        AND ${quoteIdentifier(column)} IS NOT NULL
        AND ${quoteIdentifier(column)} != ''
    `).get(source.url).total;
  }
  return result;
}

function getSyncedRemoteSchema(source) {
  const names = ['remote_users', 'remote_sessions', 'remote_coffee_sessions', 'remote_plant_sessions'];
  return names.map((name) => ({
    name,
    columns: getSyncedRemoteTableSchema(name),
    sourceUrl: source.url
  }));
}

function getSyncedRemoteTableSchema(tableName) {
  return getTableSchema(tableName).map(normalizeRemoteSchemaColumn);
}

function normalizeRemoteSchemaColumn(column) {
  if (['created_at', 'start_time', 'end_time'].includes(column.name)) {
    return {
      ...column,
      type: 'TEXT datetime YYYY-MM-DD HH:mm:ss'
    };
  }
  return column;
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function dateStringOrNull(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return formatDateTime(normalizeTimestampMs(value));
  }

  const text = String(value).trim();
  if (!text) {
    return null;
  }

  if (/^\d+$/.test(text)) {
    const numeric = Number(text);
    if (Number.isFinite(numeric)) {
      return formatDateTime(normalizeTimestampMs(numeric));
    }
  }

  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}/.test(text)) {
    return text.replace('T', ' ').slice(0, 19);
  }

  const parsed = Date.parse(text.includes('T') ? text : text.replace(' ', 'T'));
  return Number.isFinite(parsed) ? formatDateTime(parsed) : text;
}

function normalizeTimestampMs(value) {
  return Math.abs(value) < 1000000000000 ? value * 1000 : value;
}

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
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

function stringOrNull(value) {
  return value === null || value === undefined ? null : String(value);
}

function getRemoteGameLoggerSchema() {
  return Object.values(getRemoteGameLoggerTables());
}

function getRemoteGameLoggerTables() {
  return {
    users: {
      name: 'users',
      endpoint: '/users',
      responseKey: 'data',
      columns: [
        schemaColumn('id', 'TEXT', true),
        schemaColumn('created_at', 'INTEGER')
      ]
    },
    sessions: {
      name: 'sessions',
      endpoint: '/session',
      responseKey: 'data',
      columns: [
        schemaColumn('id', 'INTEGER', true),
        schemaColumn('user_id', 'TEXT'),
        schemaColumn('start_time', 'INTEGER'),
        schemaColumn('end_time', 'INTEGER'),
        schemaColumn('progress', 'INTEGER')
      ]
    },
    coffee_sessions: {
      name: 'coffee_sessions',
      endpoint: '/coffee',
      responseKey: 'data',
      columns: [
        schemaColumn('id', 'INTEGER', true),
        schemaColumn('user_id', 'TEXT'),
        schemaColumn('start_time', 'INTEGER'),
        schemaColumn('end_time', 'INTEGER'),
        schemaColumn('npc', 'TEXT')
      ]
    },
    plant_sessions: {
      name: 'plant_sessions',
      endpoint: '/plant',
      responseKey: 'data',
      columns: [
        schemaColumn('id', 'INTEGER', true),
        schemaColumn('user_id', 'TEXT'),
        schemaColumn('start_time', 'INTEGER'),
        schemaColumn('end_time', 'INTEGER'),
        schemaColumn('plant', 'TEXT')
      ]
    }
  };
}

function schemaColumn(name, type, primaryKey = false) {
  return {
    cid: 0,
    name,
    type,
    notNull: false,
    defaultValue: null,
    primaryKey
  };
}

function getRemoteGameLoggerTable(tableName) {
  const table = getRemoteGameLoggerTables()[String(tableName || '')];
  if (!table) {
    throw new Error(`Unknown HTTP data source table: ${tableName}`);
  }
  return table;
}

async function listRemoteGameLoggerTables(source) {
  const tables = [];
  for (const table of Object.values(getRemoteGameLoggerTables())) {
    try {
      const result = await fetchRemoteGameLoggerRows(source, table.name, 1, 1);
      tables.push({
        name: table.name,
        rowCount: result.pagination.total,
        columns: table.columns
      });
    } catch (_error) {
      tables.push({
        name: table.name,
        rowCount: 0,
        columns: table.columns,
        unavailable: true
      });
    }
  }
  return tables;
}

async function fetchRemoteGameLoggerRows(source, tableName, page, limit) {
  const table = getRemoteGameLoggerTable(tableName);
  const url = new URL(`${source.url}${table.endpoint}`);
  url.searchParams.set('page', String(page));
  url.searchParams.set('limit', String(limit));

  const response = await fetch(url);
  const contentType = response.headers.get('content-type') || '';
  if (!response.ok) {
    throw new Error(`HTTP data source returned ${response.status} for ${table.endpoint}`);
  }
  if (!contentType.includes('application/json')) {
    throw new Error(`HTTP data source did not return JSON for ${table.endpoint}`);
  }

  const data = await response.json();
  if (data.success === false) {
    throw new Error(data.error || `HTTP data source failed for ${table.endpoint}`);
  }

  const rows = Array.isArray(data[table.responseKey]) ? data[table.responseKey] : [];
  const pagination = data.pagination || {};
  return {
    rows,
    pagination: {
      page: pagination.page || page,
      limit: pagination.limit || limit,
      total: pagination.total || rows.length,
      totalPages: pagination.totalPages || Math.max(1, Math.ceil(rows.length / limit))
    }
  };
}

async function analyzeRemoteGameLoggerSource(options) {
  const limit = clamp(parsePositiveInteger(options.limit, 100), 1, CONFIG.maxQueryRows);
  if (options.aiConfigured) {
    return requestRemoteDataAnalysis(options, limit);
  }

  const sessions = await fetchRemoteGameLoggerRows(options.source, 'sessions', 1, limit);
  const progressTarget = extractProgressTarget(options.question);

  if (progressTarget !== null) {
    return analyzeRemoteProgressTarget(options, sessions.rows, progressTarget);
  }

  const grouped = new Map();

  for (const row of sessions.rows) {
    const userId = row.user_id || 'unknown';
    const startTime = Number(row.start_time) || 0;
    const endTime = Number(row.end_time) || 0;
    const durationMs = endTime > startTime ? endTime - startTime : 0;
    const current = grouped.get(userId) || { user_id: userId, total_minutes: 0, session_count: 0 };
    current.total_minutes += durationMs / 60000;
    current.session_count += 1;
    grouped.set(userId, current);
  }

  const rows = Array.from(grouped.values())
    .map((row) => ({
      user_id: row.user_id,
      total_minutes: Math.round(row.total_minutes * 100) / 100,
      session_count: row.session_count
    }))
    .sort((a, b) => b.total_minutes - a.total_minutes);

  const plan = {
    title: 'Remote Game Time By User',
    sql: 'HTTP data source aggregation: GET /session grouped by user_id',
    chartType: 'bar',
    xField: 'user_id',
    yField: 'total_minutes',
    notes: 'Remote Game Logger HTTP data source does not support SQL. The backend fetched session rows and aggregated them in memory.'
  };

  const query = {
    sql: plan.sql,
    rows,
    columns: rows.length ? Object.keys(rows[0]) : ['user_id', 'total_minutes', 'session_count'],
    rowCount: rows.length,
    elapsedMs: 0
  };

  const narrative = buildLocalNarrative(options.question, plan, query);
  return {
    plan,
    query,
    analysis: narrative.analysis,
    chart: narrative.chart
  };
}

function analyzeRemoteProgressTarget(options, sessionRows, progressTarget) {
  const matchedRows = sessionRows.filter((row) => Number(row.progress) >= progressTarget);
  const uniqueUserIds = new Set(matchedRows.map((row) => row.user_id || row.id || 'unknown'));
  const rows = [{
    progress_target: progressTarget,
    matched_session_count: matchedRows.length,
    matched_id_count: uniqueUserIds.size
  }];

  const plan = {
    title: `Sessions Reaching Progress ${progressTarget}`,
    sql: `HTTP data source filter: GET /session where progress >= ${progressTarget}`,
    chartType: 'bar',
    xField: 'progress_target',
    yField: 'matched_id_count',
    notes: 'Remote Game Logger HTTP data source does not support SQL. The backend fetched session rows and filtered progress in memory.'
  };

  const query = {
    sql: plan.sql,
    rows,
    columns: Object.keys(rows[0]),
    rowCount: rows.length,
    elapsedMs: 0
  };

  const analysis = [
    `在当前读取到的 session 数据中，progress >= ${progressTarget} 的 session 有 ${matchedRows.length} 条。`,
    `达到该 progress 的唯一 id 数量是 ${uniqueUserIds.size} 个。`,
    `本次远程 HTTP 数据源读取了 ${sessionRows.length} 条 session 记录进行统计。`
  ].join('\n');

  return {
    plan,
    query,
    analysis,
    chart: shouldGenerateChart(options.question) ? buildChartOption(plan, rows) : null
  };
}

function extractProgressTarget(question) {
  const text = String(question || '');
  if (!/progress|进度/i.test(text)) {
    return null;
  }
  const match = text.match(/progress\D*(\d+)/i) || text.match(/(\d+)\D*(?:这个)?\s*(?:progress|进度)/i);
  return match ? Number(match[1]) : null;
}

async function requestRemoteDataAnalysis(options, limit) {
  const dataset = await collectRemoteGameLoggerDataset(options.source, limit);
  const wantsChart = shouldGenerateChart(options.question);
  const rowSummary = Object.fromEntries(Object.entries(dataset.tables).map(([name, table]) => [
    name,
    {
      fetchedRows: table.rows.length,
      totalRows: table.pagination.total,
      columns: table.columns.map((column) => column.name)
    }
  ]));

  const system = [
    'You are a data analyst working with game telemetry JSON rows fetched from a remote HTTP API.',
    'Analyze only the provided data. Do not invent rows or columns.',
    'Return only valid JSON.',
    wantsChart
      ? 'JSON keys: title, analysis, operation, rows, columns, chart. chart must be a valid ECharts option. Use pie charts for percentage/proportion/share questions when appropriate.'
      : 'JSON keys: title, analysis, operation, rows, columns. Do not include chart unless the user explicitly asks for a chart.',
    'rows must be a small result table derived from the provided rows, not the full raw dataset.',
    'columns must match keys in rows.',
    'If data is limited, clearly mention the fetched row count and total row count in analysis.'
  ].join(' ');

  const prompt = [
    `Question: ${options.question}`,
    `Chart requested: ${wantsChart ? 'yes' : 'no'}`,
    `Schema: ${JSON.stringify(options.schema)}`,
    `Fetched row summary: ${JSON.stringify(rowSummary)}`,
    `Data JSON: ${JSON.stringify(dataset.tables)}`
  ].join('\n\n');

  const content = await callAiText(options, [
    { role: 'system', content: system },
    { role: 'user', content: prompt }
  ]);
  const parsed = parseJsonFromText(content);
  const rows = Array.isArray(parsed.rows) ? parsed.rows.slice(0, CONFIG.maxQueryRows) : [];
  const columns = Array.isArray(parsed.columns) && parsed.columns.length
    ? parsed.columns.map(String)
    : rows.length ? Object.keys(rows[0]) : [];
  const plan = {
    title: String(parsed.title || 'Remote AI Analysis'),
    sql: String(parsed.operation || 'AI analysis over remote HTTP data source rows'),
    chartType: wantsChart ? 'auto' : 'none',
    xField: '',
    yField: '',
    notes: 'AI analyzed remote HTTP data source rows supplied by the backend.'
  };

  return {
    plan,
    query: {
      sql: plan.sql,
      rows,
      columns,
      rowCount: rows.length,
      elapsedMs: 0
    },
    analysis: String(parsed.analysis || 'Analysis completed.'),
    chart: wantsChart ? parsed.chart || null : null
  };
}

async function analyzeCustomHttpSource(options) {
  const limit = clamp(parsePositiveInteger(options.limit, 100), 1, CONFIG.maxQueryRows);
  if (hasSyncedCustomSource(options.source)) {
    return analyzeSyncedCustomSqliteSource(options, limit);
  }

  const dataset = collectCustomDataset(options.source, limit);
  const wantsChart = shouldGenerateChart(options.question);
  if (!options.aiConfigured) {
    const firstTable = Object.keys(dataset.tables)[0] || '';
    const rows = firstTable ? dataset.tables[firstTable].rows.slice(0, limit) : [];
    return {
      plan: {
        title: 'Custom HTTP Preview',
        sql: firstTable ? `Custom HTTP synced preview: ${firstTable}` : 'Custom HTTP source is not synced',
        chartType: 'none',
        xField: '',
        yField: '',
        notes: 'Configure an AI provider for flexible custom Worker analysis.'
      },
      query: {
        sql: firstTable ? `Custom HTTP synced preview: ${firstTable}` : 'No synced data',
        rows,
        columns: rows.length ? Object.keys(rows[0]) : [],
        rowCount: rows.length,
        elapsedMs: 0
      },
      analysis: firstTable
        ? `已读取自定义数据源 ${firstTable} 的 ${rows.length} 行本地同步数据。配置 AI API 后可以做更复杂分析。`
        : '这个自定义数据源还没有同步数据。',
      chart: null
    };
  }

  const system = [
    'You are a data analyst working with synced custom HTTP JSON tables.',
    'Analyze only the provided local synced rows. Do not invent rows or columns.',
    'Return only valid JSON.',
    wantsChart
      ? 'JSON keys: title, analysis, operation, rows, columns, chart. chart must be a valid ECharts option.'
      : 'JSON keys: title, analysis, operation, rows, columns. Do not include chart unless the user asks for one.',
    'Rows must be a small derived result table, not the full raw dataset.',
    'Date/time fields are normalized to YYYY-MM-DD HH:mm:ss when possible.'
  ].join(' ');
  const prompt = [
    `Question: ${options.question}`,
    `Chart requested: ${wantsChart ? 'yes' : 'no'}`,
    `Tables config: ${JSON.stringify(options.source.tables)}`,
    `Synced data: ${JSON.stringify(dataset.tables)}`
  ].join('\n\n');
  const content = await callAiText(options, [
    { role: 'system', content: system },
    { role: 'user', content: prompt }
  ]);
  const parsed = parseJsonFromText(content);
  const rows = Array.isArray(parsed.rows) ? parsed.rows.slice(0, CONFIG.maxQueryRows) : [];
  const columns = Array.isArray(parsed.columns) && parsed.columns.length
    ? parsed.columns.map(String)
    : rows.length ? Object.keys(rows[0]) : [];
  return {
    plan: {
      title: String(parsed.title || 'Custom HTTP Analysis'),
      sql: String(parsed.operation || 'AI analysis over synced custom HTTP rows'),
      chartType: wantsChart ? 'auto' : 'none',
      xField: '',
      yField: '',
      notes: 'AI analyzed synced custom HTTP JSON rows.'
    },
    query: {
      sql: String(parsed.operation || 'AI analysis over synced custom HTTP rows'),
      rows,
      columns,
      rowCount: rows.length,
      elapsedMs: 0
    },
    analysis: String(parsed.analysis || 'Analysis completed.'),
    chart: wantsChart ? parsed.chart || null : null
  };
}

async function analyzeSyncedCustomSqliteSource(options, limit) {
  const schema = getCustomHttpSchema(options.source);
  if (!options.aiConfigured) {
    const firstTable = schema[0] && schema[0].name;
    const rows = firstTable
      ? db.prepare(`SELECT * FROM ${quoteIdentifier(firstTable)} WHERE source_url = ? LIMIT ?`).all(options.source.url, limit)
      : [];
    return {
      plan: {
        title: firstTable || 'Custom HTTP Analysis',
        sql: firstTable ? `SELECT * FROM ${quoteIdentifier(firstTable)} WHERE source_url = '${escapeSqlLiteral(options.source.url)}' LIMIT ${limit}` : 'No synced custom table',
        chartType: 'none',
        xField: '',
        yField: '',
        notes: 'Configure an AI provider for flexible SQL analysis.'
      },
      query: {
        sql: firstTable ? `SELECT * FROM ${quoteIdentifier(firstTable)} WHERE source_url = '${escapeSqlLiteral(options.source.url)}' LIMIT ${limit}` : 'No synced custom table',
        rows,
        columns: rows.length ? Object.keys(rows[0]) : [],
        rowCount: rows.length,
        elapsedMs: 0
      },
      analysis: firstTable ? `已读取 ${firstTable} 的 ${rows.length} 行同步数据。` : '这个自定义数据源还没有同步数据。',
      chart: null
    };
  }

  const plan = await requestAnalysisPlan({
    provider: options.provider,
    model: options.model,
    apiKey: options.apiKey,
    baseUrl: options.baseUrl,
    question: options.question,
    schema,
    source: options.source
  });
  if (!plan.sql.includes(options.source.url)) {
    throw new Error(`AI SQL must filter source_url = '${options.source.url}'`);
  }
  const prepared = prepareReadOnlySql(plan.sql, limit);
  const startedAt = Date.now();
  const rows = db.prepare(prepared.sql).all();
  const queryResult = {
    sql: prepared.sql,
    rows,
    columns: rows.length ? Object.keys(rows[0]) : [],
    rowCount: rows.length,
    elapsedMs: Date.now() - startedAt
  };
  const narrative = await requestAnalysisNarrative({
    provider: options.provider,
    model: options.model,
    apiKey: options.apiKey,
    baseUrl: options.baseUrl,
    question: options.question,
    schema,
    plan,
    queryResult
  });
  return {
    plan,
    query: queryResult,
    analysis: narrative.analysis,
    chart: narrative.chart
  };
}

function collectCustomDataset(source, limit) {
  const tables = {};
  for (const table of source.tables) {
    const result = getCustomHttpRows(source, table.name, 1, limit);
    tables[table.name] = {
      columns: result.columns,
      rows: result.rows,
      totalRows: result.pagination.total
    };
  }
  return { tables };
}

async function collectRemoteGameLoggerDataset(source, limit) {
  const tables = {};
  for (const table of Object.values(getRemoteGameLoggerTables())) {
    try {
      const result = await fetchRemoteGameLoggerRows(source, table.name, 1, limit);
      tables[table.name] = {
        endpoint: table.endpoint,
        columns: table.columns,
        pagination: result.pagination,
        rows: result.rows
      };
    } catch (error) {
      tables[table.name] = {
        endpoint: table.endpoint,
        columns: table.columns,
        pagination: { page: 1, limit, total: 0, totalPages: 1 },
        rows: [],
        error: error.message
      };
    }
  }
  return { tables };
}

function listTables() {
  return db.prepare(`
    SELECT name
    FROM sqlite_master
    WHERE type = 'table'
      AND name NOT LIKE 'sqlite_%'
      AND name NOT LIKE 'remote_%'
      AND name NOT LIKE 'custom_%'
    ORDER BY name ASC
  `).all();
}

function getTableSchema(tableName) {
  const table = assertKnownTable(tableName);
  return db.prepare(`PRAGMA table_info(${quoteIdentifier(table)})`).all().map((column) => ({
    cid: column.cid,
    name: column.name,
    type: column.type,
    notNull: Boolean(column.notnull),
    defaultValue: column.dflt_value,
    primaryKey: Boolean(column.pk)
  }));
}

function getDatabaseSchema() {
  return listTables().map((table) => ({
    name: table.name,
    columns: getTableSchema(table.name)
  }));
}

function assertKnownTable(tableName) {
  const normalized = String(tableName || '').trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(normalized)) {
    throw new Error('Invalid table name');
  }

  const exists = db.prepare(`
    SELECT name
    FROM sqlite_master
    WHERE type = 'table'
      AND name = ?
      AND name NOT LIKE 'sqlite_%'
  `).get(normalized);

  if (!exists) {
    throw new Error(`Unknown table: ${normalized}`);
  }

  return normalized;
}

function doesTableExist(tableName) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(String(tableName || ''))) {
    return false;
  }
  return Boolean(db.prepare(`
    SELECT name
    FROM sqlite_master
    WHERE type = 'table'
      AND name = ?
  `).get(tableName));
}

function prepareReadOnlySql(inputSql, requestedLimit) {
  let sql = String(inputSql || '').trim();
  if (!sql) {
    throw new Error('SQL is required');
  }

  sql = sql.replace(/;+\s*$/g, '').trim();
  const normalized = sql.toLowerCase();
  const blockedPatterns = [
    /--/,
    /\/\*/,
    /\b(insert|update|delete|drop|alter|create|replace|truncate|attach|detach|vacuum|pragma|reindex|grant|revoke)\b/
  ];

  if (sql.includes(';') || blockedPatterns.some((pattern) => pattern.test(normalized))) {
    throw new Error('Only a single read-only SELECT statement is allowed');
  }

  if (!/^(select|with)\b/i.test(sql)) {
    throw new Error('Only SELECT queries are allowed');
  }

  const limit = clamp(requestedLimit, 1, CONFIG.maxQueryRows);
  let limited = false;
  if (!/\blimit\s+\d+\b/i.test(sql)) {
    sql = `SELECT * FROM (${sql}) AS limited_result LIMIT ${limit}`;
    limited = true;
  }

  return { sql, limited };
}

function quoteIdentifier(identifier) {
  return `"${String(identifier).replace(/"/g, '""')}"`;
}

function clamp(value, min, max) {
  const parsed = parseInt(value, 10);
  if (!Number.isFinite(parsed)) return min;
  return Math.min(max, Math.max(min, parsed));
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

async function requestAnalysisPlan(context) {
  const system = [
    'You generate safe SQLite analysis plans.',
    'Return only JSON with keys: title, sql, chartType, xField, yField, notes.',
    'The SQL must be a single read-only SELECT or WITH query.',
    'Prefer aggregated results and include aliases that are easy to chart.',
    context.source && context.source.type === 'gameLoggerHttp'
      ? `For remote synced tables, filter every query with source_url = '${escapeSqlLiteral(context.source.url)}'.`
      : '',
    context.source && context.source.type === 'gameLoggerHttp'
      ? 'Remote synced time columns are TEXT in YYYY-MM-DD HH:mm:ss format. For duration calculations in SQLite, use strftime(\'%s\', end_time) - strftime(\'%s\', start_time).'
      : ''
  ].join(' ');

  const prompt = [
    `Question: ${context.question}`,
    `Schema JSON: ${JSON.stringify(context.schema)}`,
    'Return the plan JSON now.'
  ].join('\n\n');

  const content = await callAiText(context, [
    { role: 'system', content: system },
    { role: 'user', content: prompt }
  ]);

  const parsed = parseJsonFromText(content);
  if (!parsed.sql) {
    throw new Error('AI plan did not include sql');
  }
  return {
    title: String(parsed.title || 'AI Analysis'),
    sql: String(parsed.sql),
    chartType: String(parsed.chartType || 'bar'),
    xField: parsed.xField ? String(parsed.xField) : '',
    yField: parsed.yField ? String(parsed.yField) : '',
    notes: String(parsed.notes || '')
  };
}

function escapeSqlLiteral(value) {
  return String(value || '').replace(/'/g, "''");
}

async function requestAnalysisNarrative(context) {
  const rowsForAi = context.queryResult.rows.slice(0, 80);
  const wantsChart = shouldGenerateChart(context.question);
  const system = [
    'You explain data analysis results for a game analytics dashboard.',
    wantsChart
      ? 'Return only JSON with keys: analysis and chart. chart must be a valid ECharts option object.'
      : 'Return only JSON with key: analysis. Do not include chart JSON unless the user asked for a chart.'
  ].join(' ');

  const prompt = [
    `Question: ${context.question}`,
    `Plan: ${JSON.stringify(context.plan)}`,
    `SQL result: ${JSON.stringify({ columns: context.queryResult.columns, rows: rowsForAi, rowCount: context.queryResult.rowCount })}`,
    wantsChart
      ? 'Return concise findings and an ECharts option.'
      : 'Return concise findings only.'
  ].join('\n\n');

  const content = await callAiText(context, [
    { role: 'system', content: system },
    { role: 'user', content: prompt }
  ]);

  const parsed = parseJsonFromText(content);
  return {
    analysis: String(parsed.analysis || 'Analysis completed.'),
    chart: wantsChart ? parsed.chart || buildChartOption(context.plan, context.queryResult.rows) : null
  };
}

async function callAiText(context, messages) {
  const preset = getProviderPresets()[context.provider] || getProviderPresets().openai;
  if (preset.type === 'anthropic') {
    return callAnthropic(context, messages);
  }
  if (preset.type === 'gemini') {
    return callGemini(context, messages);
  }
  return callOpenAiCompatible(context, messages);
}

async function callOpenAiCompatible(context, messages) {
  const endpoint = `${context.baseUrl.replace(/\/+$/g, '')}/chat/completions`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${context.apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: context.model,
      messages,
      temperature: 0.2,
      response_format: { type: 'json_object' }
    })
  });
  const data = await readAiResponse(response);
  return data.choices && data.choices[0] && data.choices[0].message
    ? data.choices[0].message.content
    : '';
}

async function callAnthropic(context, messages) {
  const endpoint = `${context.baseUrl.replace(/\/+$/g, '')}/messages`;
  const system = messages.filter((message) => message.role === 'system').map((message) => message.content).join('\n');
  const userMessages = messages.filter((message) => message.role !== 'system');
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'x-api-key': context.apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: context.model,
      max_tokens: 1600,
      temperature: 0.2,
      system,
      messages: userMessages
    })
  });
  const data = await readAiResponse(response);
  return Array.isArray(data.content)
    ? data.content.map((part) => part.text || '').join('')
    : '';
}

async function callGemini(context, messages) {
  const endpoint = `${context.baseUrl.replace(/\/+$/g, '')}/models/${encodeURIComponent(context.model)}:generateContent?key=${encodeURIComponent(context.apiKey)}`;
  const text = messages.map((message) => `${message.role.toUpperCase()}:\n${message.content}`).join('\n\n');
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      generationConfig: {
        temperature: 0.2,
        responseMimeType: 'application/json'
      },
      contents: [{ role: 'user', parts: [{ text }] }]
    })
  });
  const data = await readAiResponse(response);
  return data.candidates && data.candidates[0] && data.candidates[0].content
    ? data.candidates[0].content.parts.map((part) => part.text || '').join('')
    : '';
}

async function readAiResponse(response) {
  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch (_error) {
    data = { raw: text };
  }
  if (!response.ok) {
    throw new Error(data.error && data.error.message ? data.error.message : `AI request failed with ${response.status}`);
  }
  return data;
}

function parseJsonFromText(text) {
  const value = String(text || '').trim();
  try {
    return JSON.parse(value);
  } catch (_error) {
    const match = value.match(/\{[\s\S]*\}/);
    if (!match) {
      throw new Error('AI response was not JSON');
    }
    return JSON.parse(match[0]);
  }
}

function buildLocalAnalysisPlan(question, schema) {
  const hasSessions = schema.some((table) => table.name === 'sessions');
  const wantsGameTime = /time|时长|游戏|play|session|active/i.test(question);
  if (hasSessions && wantsGameTime) {
    return {
      title: 'Game Time By User',
      sql: `
        SELECT
          user_id,
          ROUND(SUM(CASE WHEN end_time IS NOT NULL THEN MAX(end_time - start_time, 0) ELSE 0 END) / 60000.0, 2) AS total_minutes,
          COUNT(*) AS session_count
        FROM sessions
        GROUP BY user_id
        ORDER BY total_minutes DESC
      `,
      chartType: 'bar',
      xField: 'user_id',
      yField: 'total_minutes',
      notes: 'Local fallback plan used because no AI provider was configured.'
    };
  }

  const firstTable = schema[0] && schema[0].name;
  return {
    title: firstTable ? `Preview ${firstTable}` : 'Database Preview',
    sql: firstTable ? `SELECT * FROM ${quoteIdentifier(firstTable)}` : 'SELECT 1 AS value',
    chartType: 'bar',
    xField: '',
    yField: '',
    notes: 'Local fallback plan used because no AI provider was configured.'
  };
}

function buildLocalNarrative(question, plan, queryResult) {
  return {
    analysis: [
      `Question: ${question}`,
      `Executed ${queryResult.sql}.`,
      `Returned ${queryResult.rowCount} rows in ${queryResult.elapsedMs}ms.`,
      plan.notes
    ].filter(Boolean).join('\n'),
    chart: shouldGenerateChart(question) ? buildChartOption(plan, queryResult.rows) : null
  };
}

function shouldGenerateChart(question) {
  return /chart|graph|plot|visual|visualize|trend|line|bar|pie|图表|图|可视化|趋势|折线|柱状|饼图/i.test(String(question || ''));
}

function buildChartOption(plan, rows) {
  const fields = rows.length ? Object.keys(rows[0]) : [];
  const xField = plan.xField || fields[0] || 'name';
  const yField = plan.yField || fields.find((field) => typeof rows[0][field] === 'number') || fields[1] || xField;
  const labels = rows.map((row) => String(row[xField]));
  const values = rows.map((row) => Number(row[yField]) || 0);

  return {
    title: { text: plan.title || 'Analysis' },
    tooltip: { trigger: 'axis' },
    grid: { left: 48, right: 24, bottom: 64, top: 56 },
    xAxis: { type: 'category', data: labels, axisLabel: { rotate: labels.length > 8 ? 30 : 0 } },
    yAxis: { type: 'value' },
    series: [{
      type: plan.chartType === 'line' ? 'line' : 'bar',
      data: values,
      name: yField
    }]
  };
}

function generatePlayerListHTML(players, pagination) {
  const { page, totalPages } = pagination;
  const prevLink = page > 1
    ? `<a href="/logs/list?page=${page - 1}" style="padding:10px 20px; background:#6c757d; color:white; border-radius:4px; text-decoration:none;">Previous</a>`
    : `<span style="color:#999;">Previous</span>`;
  const nextLink = page < totalPages
    ? `<a href="/logs/list?page=${page + 1}" style="padding:10px 20px; background:#007bff; color:white; border-radius:4px; text-decoration:none;">Next</a>`
    : `<span style="color:#999;">No more players</span>`;

  return `<html><head><title>Players</title><style>body{font-family:sans-serif;max-width:800px;margin:20px auto;background:#f4f4f4}.card{background:white;padding:20px;border-radius:8px;box-shadow:0 2px 5px rgba(0,0,0,0.1)}table{width:100%;border-collapse:collapse}th,td{padding:12px;text-align:left;border-bottom:1px solid #eee}a{color:#007bff;text-decoration:none}</style></head>
  <body><div class="card"><h2>Player Logs</h2><table><tr><th>Player ID</th><th>Sessions</th><th>Last Active</th><th>Action</th></tr>
  ${players.map((player) => `<tr><td>${escapeHtml(player.owner)}</td><td>${player.totalSessions}</td><td>${new Date(player.lastModified).toLocaleString()}</td><td><a href="/logs?owner=${encodeURIComponent(player.owner)}">View</a></td></tr>`).join('')}
  </table>
  <div style="margin-top:20px; display:flex; justify-content:space-between;">${prevLink}${nextLink}</div>
  </div><p><a href="/">← Home</a></p></body></html>`;
}

function generateLogViewHTML(data) {
  return `<html><head><title>${escapeHtml(data.owner)}</title><style>body{font-family:sans-serif;margin:20px;background:#f9f9f9}.session{background:white;padding:15px;margin-bottom:15px;border-radius:8px;border-left:5px solid #007bff}.log{font-family:monospace;font-size:12px;padding:4px;border-bottom:1px solid #f0f0f0}.Error{color:red}.Warning{color:#856404;background:#fff3cd}</style></head>
  <body><h1>Logs: ${escapeHtml(data.owner)}</h1><a href="/logs/list">← Back to List</a>
  ${data.sessions.map((session) => `
    <div class="session">
      <strong>Session: ${escapeHtml(session.sessionId)}</strong> (Received: ${new Date(session.receivedAt).toLocaleString()})
      <div style="margin-top:10px">
        ${renderLogGroups(session.logs)}
      </div>
    </div>
  `).join('')}
  </body></html>`;
}

function renderLogGroups(logGroups) {
  return Object.entries(logGroups || {}).map(([category, items]) => {
    return (Array.isArray(items) ? items : []).map((entry) => {
      const level = entry && entry.level ? String(entry.level) : '';
      const timestamp = entry && entry.timestamp ? String(entry.timestamp) : '';
      const message = entry && entry.message ? String(entry.message) : '';
      return `<div class="log ${escapeHtml(level)}">[${escapeHtml(timestamp)}] [${escapeHtml(category)}] ${escapeHtml(message)}</div>`;
    }).join('');
  }).join('');
}

function ensureDataDirectory(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function parsePositiveInteger(value, fallback) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function safeJsonParse(value, fallback) {
  try {
    return JSON.parse(value);
  } catch (_error) {
    return fallback;
  }
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sendError(res, message, status) {
  res.status(status).json({ success: false, error: message });
}
