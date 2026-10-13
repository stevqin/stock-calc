PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS ai_schema(version INTEGER PRIMARY KEY);
INSERT OR IGNORE INTO ai_schema VALUES(1);
CREATE TABLE IF NOT EXISTS ai_models(id TEXT PRIMARY KEY, payload TEXT NOT NULL, credential_ref TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS ai_defaults(id INTEGER PRIMARY KEY CHECK(id=1),payload TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS ai_tasks(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE NOT NULL,request_id TEXT UNIQUE NOT NULL,parent_id TEXT REFERENCES ai_tasks(id) ON DELETE CASCADE,created_at TEXT NOT NULL,status TEXT NOT NULL,request_payload TEXT NOT NULL,progress TEXT NOT NULL DEFAULT '{}',call_attempts TEXT NOT NULL DEFAULT '[]',group_summaries TEXT NOT NULL DEFAULT '[]',errors TEXT NOT NULL DEFAULT '[]');
CREATE TABLE IF NOT EXISTS ai_snapshots(id TEXT PRIMARY KEY,payload TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS ai_task_snapshots(task_id TEXT REFERENCES ai_tasks(id) ON DELETE CASCADE,snapshot_id TEXT REFERENCES ai_snapshots(id),PRIMARY KEY(task_id,snapshot_id));
CREATE TABLE IF NOT EXISTS ai_evidence(id TEXT PRIMARY KEY,payload TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS ai_snapshot_evidence(snapshot_id TEXT REFERENCES ai_snapshots(id) ON DELETE CASCADE,evidence_id TEXT REFERENCES ai_evidence(id),PRIMARY KEY(snapshot_id,evidence_id));
CREATE TABLE IF NOT EXISTS ai_reports(id TEXT PRIMARY KEY,task_id TEXT NOT NULL REFERENCES ai_tasks(id) ON DELETE CASCADE,snapshot_id TEXT NOT NULL REFERENCES ai_snapshots(id),payload TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS ai_summaries(id TEXT PRIMARY KEY,task_id TEXT NOT NULL REFERENCES ai_tasks(id) ON DELETE CASCADE,snapshot_id TEXT NOT NULL REFERENCES ai_snapshots(id),version INTEGER NOT NULL,payload TEXT NOT NULL,UNIQUE(task_id,snapshot_id,version));
CREATE INDEX IF NOT EXISTS ai_reports_task ON ai_reports(task_id);
CREATE INDEX IF NOT EXISTS ai_summaries_task ON ai_summaries(task_id);
CREATE INDEX IF NOT EXISTS ai_tasks_status ON ai_tasks(status,seq);

CREATE TABLE IF NOT EXISTS ai_credential_cleanup(reference TEXT PRIMARY KEY);
