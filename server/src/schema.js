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

module.exports = {
  initSchema
};
