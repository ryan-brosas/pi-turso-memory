export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  scope_key TEXT NOT NULL UNIQUE,
  root_path TEXT NOT NULL,
  remote_url TEXT,
  display_name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  pi_session_path TEXT,
  parent_session_id TEXT,
  branch_name TEXT,
  git_head TEXT,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  end_reason TEXT
);

CREATE TABLE IF NOT EXISTS progress_events (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  session_id TEXT REFERENCES sessions(id),
  parent_event_id TEXT,
  kind TEXT NOT NULL,
  phase TEXT,
  summary TEXT NOT NULL,
  evidence TEXT,
  tool_name TEXT,
  tool_call_id TEXT,
  exit_code INTEGER,
  git_head TEXT,
  branch_name TEXT,
  file_paths_json TEXT NOT NULL DEFAULT '[]',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  redaction_status TEXT NOT NULL DEFAULT 'clean',
  occurred_at TEXT NOT NULL,
  content_hash TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS memory_items (
  id TEXT PRIMARY KEY,
  owner_key TEXT NOT NULL,
  project_id TEXT REFERENCES projects(id),
  source_session_id TEXT REFERENCES sessions(id),
  source_event_id TEXT,
  kind TEXT NOT NULL,
  scope TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'candidate',
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  tags_json TEXT NOT NULL DEFAULT '[]',
  confidence REAL NOT NULL DEFAULT 0.5,
  importance REAL NOT NULL DEFAULT 0.5,
  evidence_kind TEXT NOT NULL DEFAULT 'inferred',
  valid_from TEXT,
  valid_until TEXT,
  supersedes_id TEXT,
  source_entry_id TEXT,
  git_head TEXT,
  branch_name TEXT,
  file_paths_json TEXT NOT NULL DEFAULT '[]',
  content_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_accessed_at TEXT,
  UNIQUE(owner_key, content_hash)
);

CREATE TABLE IF NOT EXISTS memory_links (
  from_id TEXT NOT NULL REFERENCES memory_items(id),
  to_id TEXT NOT NULL REFERENCES memory_items(id),
  relation TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 0.5,
  created_at TEXT NOT NULL,
  PRIMARY KEY(from_id, to_id, relation)
);

CREATE TABLE IF NOT EXISTS working_state (
  project_id TEXT PRIMARY KEY REFERENCES projects(id),
  session_id TEXT REFERENCES sessions(id),
  goal TEXT NOT NULL,
  phase TEXT NOT NULL,
  state_json TEXT NOT NULL,
  source_event_id TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS markdown_exports (
  id TEXT PRIMARY KEY,
  memory_id TEXT REFERENCES memory_items(id),
  event_id TEXT,
  path TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'inbox',
  exported_at TEXT NOT NULL,
  promoted_at TEXT
);

CREATE INDEX IF NOT EXISTS progress_project_time ON progress_events(project_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS memory_scope_status_time ON memory_items(owner_key, scope, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS memory_kind_status ON memory_items(kind, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS links_to ON memory_links(to_id);
`;
