use crate::storage::Store;
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};

pub fn initialize(db: &Connection) -> Result<(), String> {
    db.execute_batch(include_str!("history_schema.sql"))
        .map_err(|e| e.to_string())
}
fn validate(data: &Value, year: i32) -> Result<(), String> {
    let symbol = data["symbol"].as_str().ok_or("历史行情证券缺失")?;
    if symbol.len() != 8 || !symbol.is_ascii() {
        return Err("历史行情证券无效".into());
    }
    crate::charts::analysis_history_url(&symbol[..2], &symbol[2..], year)?;
    if data["mode"] != "daily-raw"
        || data["adjustment"] != "不复权"
        || data["sessions"]
            .as_array()
            .map(|a| !a.is_empty())
            .unwrap_or(true)
    {
        return Err("历史行情必须为不复权日线".into());
    }
    chrono::DateTime::parse_from_rfc3339(data["fetchedAt"].as_str().ok_or("历史行情时间缺失")?)
        .map_err(|_| "历史行情时间无效")?;
    let bars = data["bars"].as_array().ok_or("历史行情缺失")?;
    let mut rows = Vec::new();
    for b in bars {
        if ["open", "close", "high", "low", "volume"]
            .iter()
            .any(|k| !b[k].is_string())
        {
            return Err("历史行情数值无效".into());
        }
        rows.push(json!([
            b["date"],
            b["open"],
            b["close"],
            b["high"],
            b["low"],
            b["volume"]
        ]));
    }
    crate::charts::parse_analysis_history(
        json!({"code":0,"data":{symbol:{"day":rows}}}),
        symbol,
        year,
    )?;
    Ok(())
}
pub fn write(db: &mut Connection, year: i32, data: &Value) -> Result<(), String> {
    validate(data, year)?;
    let symbol = data["symbol"].as_str().unwrap();
    let fetched = data["fetchedAt"].as_str().unwrap();
    let timestamp = chrono::DateTime::parse_from_rfc3339(fetched)
        .unwrap()
        .timestamp_millis();
    let source = data["source"].as_str().unwrap_or("legacy");
    let tx = db.transaction().map_err(|e| e.to_string())?;
    for bar in data["bars"].as_array().unwrap() {
        tx.execute("INSERT INTO analysis_daily_bars(symbol,date,payload,fetched_ms,source) VALUES(?1,?2,?3,?4,?5)
            ON CONFLICT(symbol,date) DO UPDATE SET payload=excluded.payload,fetched_ms=excluded.fetched_ms,source=excluded.source
            WHERE excluded.fetched_ms >= analysis_daily_bars.fetched_ms",
            params![symbol,bar["date"].as_str().unwrap(),bar.to_string(),timestamp,source]).map_err(|e|e.to_string())?;
    }
    let mut metadata = data.clone();
    metadata["bars"] = json!([]);
    tx.execute("INSERT INTO analysis_history_years(symbol,year,metadata,fetched_ms) VALUES(?1,?2,?3,?4)
        ON CONFLICT(symbol,year) DO UPDATE SET metadata=excluded.metadata,fetched_ms=excluded.fetched_ms
        WHERE excluded.fetched_ms >= analysis_history_years.fetched_ms",
        params![symbol,year,metadata.to_string(),timestamp]).map_err(|e|e.to_string())?;
    tx.commit().map_err(|e| e.to_string())
}
pub fn read(db: &Connection, symbol: &str, year: i32) -> Result<Option<Value>, String> {
    let metadata: Option<String> = db
        .query_row(
            "SELECT metadata FROM analysis_history_years WHERE symbol=?1 AND year=?2",
            params![symbol, year],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    let Some(metadata) = metadata else {
        return Ok(None);
    };
    let mut data: Value = serde_json::from_str(&metadata).map_err(|_| "历史行情缓存损坏")?;
    let mut stmt = db.prepare("SELECT payload FROM analysis_daily_bars WHERE symbol=?1 AND date>=?2 AND date<=?3 ORDER BY date").map_err(|e|e.to_string())?;
    let rows = stmt
        .query_map(
            params![
                symbol,
                format!("{}-12-01", year - 1),
                format!("{year}-12-31")
            ],
            |r| r.get::<_, String>(0),
        )
        .map_err(|e| e.to_string())?;
    let mut bars = Vec::new();
    for row in rows {
        bars.push(
            serde_json::from_str::<Value>(&row.map_err(|e| e.to_string())?)
                .map_err(|_| "历史行情缓存损坏")?,
        );
    }
    data["bars"] = json!(bars);
    let mut stmt = db.prepare("SELECT date,reference_date,source FROM analysis_suspensions WHERE symbol=?1 AND date>=?2 AND date<=?3 ORDER BY date").map_err(|e|e.to_string())?;
    let events = stmt.query_map(params![symbol,format!("{}-12-01",year-1),format!("{year}-12-31")], |r| Ok(json!({"date":r.get::<_,String>(0)?,"referenceDate":r.get::<_,String>(1)?,"source":r.get::<_,String>(2)?}))).map_err(|e|e.to_string())?.collect::<Result<Vec<_>,_>>().map_err(|e|e.to_string())?;
    data["suspensions"] = json!(events);
    validate(&data, year)?;
    Ok(Some(data))
}
#[tauri::command]
pub fn load_analysis_cache(
    store: tauri::State<'_, Store>,
    symbol: String,
    year: i32,
) -> Result<Option<Value>, String> {
    let db = store.0.lock().map_err(|_| "数据库不可用")?;
    read(&db, &symbol, year)
}
#[tauri::command]
pub fn write_analysis_cache(
    store: tauri::State<'_, Store>,
    year: i32,
    data: Value,
) -> Result<(), String> {
    let mut db = store.0.lock().map_err(|_| "数据库不可用")?;
    write(&mut db, year, &data)
}
#[tauri::command]
pub fn clear_analysis_cache(store: tauri::State<'_, Store>) -> Result<(), String> {
    store
        .0
        .lock()
        .map_err(|_| "数据库不可用")?
        .execute_batch(
            "BEGIN; DELETE FROM analysis_history_years; DELETE FROM analysis_daily_bars; COMMIT;",
        )
        .map_err(|e| e.to_string())
}
#[cfg(test)]
mod tests {
    use super::*;
    fn chart(price: &str, date: &str) -> Value {
        json!({"symbol":"sh600157","mode":"daily-raw","adjustment":"不复权","sessions":[],"fetchedAt":date,
            "bars":[{"date":"2024-12-13","open":price,"close":price,"high":price,"low":price,"volume":"100"}]})
    }
    #[test]
    fn persists_merges_and_rejects_invalid_history_without_touching_account() {
        let mut db = Connection::open_in_memory().unwrap();
        initialize(&db).unwrap();
        let data = chart("1.85", "2026-09-08T00:00:00Z");
        write(&mut db, 2024, &data).unwrap();
        assert_eq!(
            read(&db, "sh600157", 2024).unwrap().unwrap()["bars"][0]["close"],
            "1.85"
        );
        write(&mut db, 2024, &chart("9", "2026-09-07T00:00:00Z")).unwrap();
        assert_eq!(
            read(&db, "sh600157", 2024).unwrap().unwrap()["bars"][0]["close"],
            "1.85"
        );
        let mut bad = data.clone();
        bad["adjustment"] = json!("前复权");
        assert!(write(&mut db, 2024, &bad).is_err());
        bad = data.clone();
        bad["bars"] = json!([]);
        assert!(write(&mut db, 2024, &bad).is_err());
        assert!(write(&mut db, 2023, &data).is_err());
        assert!(read(&db, "sz000001", 2024).unwrap().is_none());
        let mut next = data.clone();
        next["bars"][0]["date"] = json!("2024-12-16");
        write(&mut db, 2024, &next).unwrap();
        assert_eq!(
            read(&db, "sh600157", 2024).unwrap().unwrap()["bars"]
                .as_array()
                .unwrap()
                .len(),
            2
        );
    }
    #[test]
    fn reopens_database_and_preserves_documented_suspensions() {
        let path = std::env::temp_dir().join(format!(
            "history-store-{}-{}.sqlite3",
            std::process::id(),
            chrono::Utc::now().timestamp_nanos_opt().unwrap()
        ));
        {
            let mut db = Connection::open(&path).unwrap();
            initialize(&db).unwrap();
            db.execute_batch(
                "CREATE TABLE account(payload TEXT); INSERT INTO account VALUES('unchanged');",
            )
            .unwrap();
            write(&mut db, 2024, &chart("1.85", "2026-09-08T00:00:00Z")).unwrap();
            db.execute(
                "INSERT INTO analysis_suspensions VALUES(?1,?2,?3,?4)",
                params![
                    "sh600157",
                    "2024-12-16",
                    "2024-12-13",
                    "https://www.sse.com.cn/notice"
                ],
            )
            .unwrap();
        }
        let db = Connection::open(&path).unwrap();
        let data = read(&db, "sh600157", 2024).unwrap().unwrap();
        assert_eq!(data["bars"][0]["close"], "1.85");
        assert_eq!(data["suspensions"][0]["referenceDate"], "2024-12-13");
        assert_eq!(
            db.query_row("SELECT payload FROM account", [], |r| r.get::<_, String>(0))
                .unwrap(),
            "unchanged"
        );
        drop(db);
        std::fs::remove_file(path).unwrap();
    }
}
