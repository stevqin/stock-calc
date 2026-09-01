use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::{fs, path::PathBuf, sync::Mutex};
use tauri::Manager;

pub struct Store(pub Mutex<Connection>);
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Stored {
    pub revision: i64,
    pub payload: Option<String>,
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Backup {
    format: String,
    version: u32,
    exported_at: String,
    account: serde_json::Value,
}

pub fn connect(path: PathBuf) -> Result<Connection, String> {
    let db = Connection::open(path).map_err(|e| e.to_string())?;
    db.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
        CREATE TABLE IF NOT EXISTS account (id INTEGER PRIMARY KEY CHECK(id=1),revision INTEGER NOT NULL,payload TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS recovery (revision INTEGER PRIMARY KEY,payload TEXT NOT NULL,saved_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
        CREATE TABLE IF NOT EXISTS market_cache (key TEXT PRIMARY KEY,payload TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS drafts (id INTEGER PRIMARY KEY CHECK(id=1),payload TEXT NOT NULL);").map_err(|e|e.to_string())?;
    Ok(db)
}
pub fn initialize(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let dir = if std::env::var("TCALCULATOR_QA_PROFILE").ok().as_deref() == Some("1") {
        app.path().app_data_dir()?.join("qa-profile")
    } else {
        app.path().app_data_dir()?
    };
    fs::create_dir_all(&dir)?;
    app.manage(Store(Mutex::new(
        connect(dir.join("simulation.sqlite3")).map_err(std::io::Error::other)?,
    )));
    Ok(())
}
fn load(db: &Connection) -> Result<Stored, String> {
    let mut stmt = db
        .prepare("SELECT revision,payload FROM account WHERE id=1")
        .map_err(|e| e.to_string())?;
    let mut rows = stmt.query([]).map_err(|e| e.to_string())?;
    match rows.next().map_err(|e| e.to_string())? {
        Some(row) => Ok(Stored {
            revision: row.get(0).map_err(|e| e.to_string())?,
            payload: Some(row.get(1).map_err(|e| e.to_string())?),
        }),
        None => Ok(Stored {
            revision: 0,
            payload: None,
        }),
    }
}
fn validate_payload(payload: &str) -> Result<(), String> {
    if payload.len() > 16 * 1024 * 1024 {
        return Err("账户数据超过16MB上限".into());
    }
    let v: serde_json::Value = serde_json::from_str(payload).map_err(|_| "账户JSON无效")?;
    if (v["schemaVersion"] != 2 && v["schemaVersion"] != 3 && v["schemaVersion"] != 4)
        || !v["entries"].is_array()
        || !v["securities"].is_array()
        || !v["initialized"].is_boolean()
    {
        return Err("不支持的账户格式".into());
    }
    Ok(())
}
fn save(db: &mut Connection, expected: i64, payload: String) -> Result<Stored, String> {
    validate_payload(&payload)?;
    let tx = db
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(|e| e.to_string())?;
    let current = load(&tx)?;
    if current.revision != expected {
        return Err("账户已在其他窗口更新，请重新加载后操作；本次操作未保存".into());
    }
    if let Some(old) = current.payload {
        tx.execute(
            "INSERT OR REPLACE INTO recovery(revision,payload) VALUES(?1,?2)",
            params![current.revision, old],
        )
        .map_err(|e| e.to_string())?;
    }
    let revision = current.revision + 1;
    tx.execute("INSERT INTO account(id,revision,payload) VALUES(1,?1,?2) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,payload=excluded.payload",params![revision,payload]).map_err(|e|e.to_string())?;
    tx.execute("DELETE FROM recovery WHERE revision NOT IN (SELECT revision FROM recovery ORDER BY revision DESC LIMIT 20)",[]).map_err(|e|e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(Stored {
        revision,
        payload: Some(payload),
    })
}
#[tauri::command]
pub fn load_account(store: tauri::State<'_, Store>) -> Result<Stored, String> {
    let db = store.0.lock().map_err(|_| "数据库不可用")?;
    load(&db)
}
#[tauri::command]
pub fn save_account(
    app: tauri::AppHandle,
    store: tauri::State<'_, Store>,
    expected_revision: i64,
    payload: String,
) -> Result<Stored, String> {
    let mut db = store.0.lock().map_err(|_| "数据库不可用")?;
    let previous = load(&db)?;
    if previous.revision != expected_revision {
        return Err("其他窗口已修改账户，请重新加载".into());
    }
    validate_payload(&payload)?;
    if let Some(old) = previous.payload {
        let mut dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
        if std::env::var("TCALCULATOR_QA_PROFILE").ok().as_deref() == Some("1") {
            dir = dir.join("qa-profile");
        }
        dir = dir.join("auto-backups");
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let day = chrono::Utc::now()
            .with_timezone(&chrono::FixedOffset::east_opt(8 * 3600).unwrap())
            .format("%Y%m%d");
        let file = dir.join(format!("account-{day}.json"));
        if !file.exists() {
            use std::io::Write;
            let v: serde_json::Value = serde_json::from_str(&old).map_err(|e| e.to_string())?;
            let backup = serde_json::json!({"format":"t-calculator-backup","version":v["schemaVersion"],"account":v,"exportedAt":chrono::Utc::now().to_rfc3339()});
            let temp = dir.join(format!("account-{day}.tmp"));
            let mut f = fs::File::create(&temp).map_err(|e| e.to_string())?;
            f.write_all(&serde_json::to_vec(&backup).map_err(|e| e.to_string())?)
                .and_then(|_| f.sync_all())
                .map_err(|e| e.to_string())?;
            fs::rename(temp, file).map_err(|e| e.to_string())?;
        }
    }
    save(&mut db, expected_revision, payload)
}
#[tauri::command]
pub async fn export_account(store: tauri::State<'_, Store>) -> Result<Option<String>, String> {
    let saved = {
        let db = store.0.lock().map_err(|_| "数据库不可用")?;
        load(&db)?
    };
    let payload = saved.payload.ok_or("尚无账户可备份")?;
    let backup = Backup {
        format: "t-calculator-backup".into(),
        version: serde_json::from_str::<serde_json::Value>(&payload)
            .map_err(|_| "数据库内容损坏")?["schemaVersion"]
            .as_u64()
            .unwrap_or(2) as u32,
        exported_at: chrono::Utc::now().to_rfc3339(),
        account: serde_json::from_str(&payload).map_err(|_| "数据库内容损坏")?,
    };
    let filename = format!(
        "T刻-账户备份-{}.json",
        chrono::Local::now().format("%Y%m%d-%H%M%S")
    );
    let file = rfd::AsyncFileDialog::new()
        .set_file_name(&filename)
        .add_filter("账户备份", &["json"])
        .save_file()
        .await;
    if let Some(file) = file {
        let bytes = serde_json::to_vec_pretty(&backup).map_err(|e| e.to_string())?;
        fs::write(file.path(), bytes).map_err(|e| e.to_string())?;
        Ok(Some(file.path().display().to_string()))
    } else {
        Ok(None)
    }
}
#[tauri::command]
pub async fn read_backup() -> Result<Option<String>, String> {
    let Some(file) = rfd::AsyncFileDialog::new()
        .add_filter("账户备份", &["json"])
        .pick_file()
        .await
    else {
        return Ok(None);
    };
    if fs::metadata(file.path()).map_err(|e| e.to_string())?.len() > 16 * 1024 * 1024 {
        return Err("备份文件过大".into());
    }
    let bytes = fs::read(file.path()).map_err(|e| e.to_string())?;
    let backup: Backup = serde_json::from_slice(&bytes).map_err(|_| "不是有效账户备份")?;
    if backup.format != "t-calculator-backup" || ![2, 3, 4].contains(&backup.version) {
        return Err("备份版本不支持".into());
    }
    let payload = backup.account.to_string();
    validate_payload(&payload)?;
    Ok(Some(payload))
}
#[derive(Serialize)]
pub struct RecoveryRow {
    revision: i64,
    time: String,
    trades: usize,
    cash: usize,
    securities: usize,
}
#[tauri::command]
pub fn list_recovery(store: tauri::State<'_, Store>) -> Result<Vec<RecoveryRow>, String> {
    let db = store.0.lock().map_err(|_| "数据库不可用")?;
    let mut stmt = db
        .prepare("SELECT revision,payload,saved_at FROM recovery ORDER BY revision DESC")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
            ))
        })
        .map_err(|e| e.to_string())?;
    let mut out = vec![];
    for row in rows {
        let (revision, payload, time) = row.map_err(|e| e.to_string())?;
        let v: serde_json::Value = serde_json::from_str(&payload).map_err(|e| e.to_string())?;
        out.push(RecoveryRow {
            revision,
            time: format!("{}Z", time.replace(' ', "T")),
            trades: v["entries"].as_array().map_or(0, |x| x.len()),
            cash: v["cashEntries"].as_array().map_or(0, |x| x.len()),
            securities: v["securities"].as_array().map_or(0, |x| x.len()),
        });
    }
    Ok(out)
}
#[tauri::command]
pub fn read_recovery(store: tauri::State<'_, Store>, revision: i64) -> Result<String, String> {
    store
        .0
        .lock()
        .map_err(|_| "数据库不可用")?
        .query_row(
            "SELECT payload FROM recovery WHERE revision=?1",
            [revision],
            |r| r.get(0),
        )
        .map_err(|_| "恢复点已不存在".into())
}
#[tauri::command]
pub fn load_market_cache(
    store: tauri::State<'_, Store>,
) -> Result<std::collections::BTreeMap<String, String>, String> {
    let db = store.0.lock().map_err(|_| "数据库不可用")?;
    let mut stmt = db
        .prepare("SELECT key,payload FROM market_cache LIMIT 1000")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<_, _>>().map_err(|e| e.to_string())
}
fn valid_cache_key(key: &str) -> bool {
    if key == "quotes" || key == "fund-flows" {
        return true;
    }
    let Some((symbol, mode)) = key.split_once(':') else {
        return false;
    };
    symbol.len() == 8
        && symbol.is_ascii()
        && super::valid_symbol(&symbol[..2], &symbol[2..])
        && ["daily", "daily-raw", "intraday", "five-day"].contains(&mode)
}
#[tauri::command]
pub fn write_market_cache(
    store: tauri::State<'_, Store>,
    key: String,
    payload: String,
) -> Result<(), String> {
    if !valid_cache_key(&key)
        || payload.len() > 2 * 1024 * 1024
        || serde_json::from_str::<serde_json::Value>(&payload).is_err()
    {
        return Err("行情缓存无效".into());
    }
    let db = store.0.lock().map_err(|_| "数据库不可用")?;
    db.execute(
        "INSERT OR REPLACE INTO market_cache(key,payload) VALUES(?1,?2)",
        params![key, payload],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}
#[tauri::command]
pub fn clear_market_cache(store: tauri::State<'_, Store>) -> Result<(), String> {
    store
        .0
        .lock()
        .map_err(|_| "数据库不可用")?
        .execute("DELETE FROM market_cache", [])
        .map_err(|e| e.to_string())?;
    Ok(())
}
#[tauri::command]
pub fn load_drafts(store: tauri::State<'_, Store>) -> Result<String, String> {
    use rusqlite::OptionalExtension;
    let v: Option<String> = store
        .0
        .lock()
        .map_err(|_| "数据库不可用")?
        .query_row("SELECT payload FROM drafts WHERE id=1", [], |r| r.get(0))
        .optional()
        .map_err(|e| e.to_string())?;
    Ok(v.unwrap_or_else(|| "{}".into()))
}
#[tauri::command]
pub fn save_drafts(store: tauri::State<'_, Store>, payload: String) -> Result<(), String> {
    if payload.len() > 1024 * 1024
        || !serde_json::from_str::<serde_json::Value>(&payload)
            .map_err(|_| "草稿格式无效")?
            .is_object()
    {
        return Err("草稿无效或过大".into());
    }
    store
        .0
        .lock()
        .map_err(|_| "数据库不可用")?
        .execute(
            "INSERT OR REPLACE INTO drafts(id,payload) VALUES(1,?1)",
            [payload],
        )
        .map_err(|e| e.to_string())?;
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    fn payload() -> String {
        r#"{"schemaVersion":2,"entries":[],"securities":[],"initialized":false}"#.into()
    }
    #[test]
    fn persistence_and_conflict() {
        let mut db = connect(PathBuf::from(":memory:")).unwrap();
        assert_eq!(load(&db).unwrap().revision, 0);
        save(&mut db, 0, payload()).unwrap();
        assert_eq!(load(&db).unwrap().revision, 1);
        assert!(save(&mut db, 0, payload()).is_err());
        save(&mut db, 1, payload()).unwrap();
        assert_eq!(
            db.query_row("SELECT count(*) FROM recovery", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            1
        );
    }
    #[test]
    fn invalid_does_not_replace() {
        let mut db = connect(PathBuf::from(":memory:")).unwrap();
        save(&mut db, 0, payload()).unwrap();
        assert!(save(&mut db, 1, "{}".into()).is_err());
        assert_eq!(load(&db).unwrap().revision, 1);
    }
}
