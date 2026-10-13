use super::types::*;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{de::DeserializeOwned, Serialize};

pub fn initialize(db: &Connection) -> AiResult<()> {
    db.execute_batch(include_str!("schema.sql"))
        .map_err(|_| AiError::storage())
}
fn encode<T: Serialize>(v: &T) -> AiResult<String> {
    serde_json::to_string(v).map_err(|_| AiError::storage())
}
fn decode<T: DeserializeOwned>(v: &str) -> AiResult<T> {
    serde_json::from_str(v).map_err(|_| AiError::new("corruptData", "AI 数据格式异常"))
}
fn invalid(message: &str) -> AiError {
    AiError::new("invalidInput", message)
}
pub fn validate_security(s: &SecurityRef) -> AiResult<()> {
    if !crate::valid_symbol(&s.market, &s.code)
        || s.id != format!("{}{}", s.market, s.code)
        || s.name.trim().is_empty()
    {
        return Err(invalid("证券身份无效"));
    }
    Ok(())
}
fn timestamp(s: &str) -> AiResult<chrono::DateTime<chrono::FixedOffset>> {
    chrono::DateTime::parse_from_rfc3339(s).map_err(|_| invalid("时间必须包含时区"))
}
pub fn create_task(db: &mut Connection, request: &StartRequest) -> AiResult<TaskDetail> {
    if request.request_id.is_empty()
        || request.request_id.len() > 128
        || request.securities.is_empty()
        || request.participant_ids.is_empty()
        || request.summary_model_id.is_empty()
    {
        return Err(invalid("分析范围或模型缺失"));
    }
    let mut symbols = std::collections::HashSet::new();
    for s in &request.securities {
        validate_security(s)?;
        if !symbols.insert(&s.id) {
            return Err(invalid("证券重复"));
        }
    }
    let unique: std::collections::HashSet<_> = request.participant_ids.iter().collect();
    if unique.len() != request.participant_ids.len() {
        return Err(invalid("模型重复"));
    }
    let tx = db.transaction().map_err(|_| AiError::storage())?;
    let previous: Option<(String, String)> = tx
        .query_row(
            "SELECT id,request_payload FROM ai_tasks WHERE request_id=?1",
            [&request.request_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()
        .map_err(|_| AiError::storage())?;
    if let Some((id, payload)) = previous {
        if decode::<StartRequest>(&payload)? != *request {
            return Err(invalid("相同请求标识的范围已改变"));
        }
        return get_task(&tx, &id);
    }
    let id = uuid::Uuid::new_v4().to_string();
    let created = chrono::Utc::now().to_rfc3339();
    tx.execute("INSERT INTO ai_tasks(id,request_id,created_at,status,request_payload) VALUES(?1,?2,?3,?4,?5)",params![id,request.request_id,created,encode(&TaskStatus::Pending)?,encode(request)?]).map_err(|_|AiError::storage())?;
    let task = get_task(&tx, &id)?;
    tx.commit().map_err(|_| AiError::storage())?;
    Ok(task)
}
fn rows<T: DeserializeOwned>(db: &Connection, sql: &str, id: &str) -> AiResult<Vec<T>> {
    let mut stmt = db.prepare(sql).map_err(|_| AiError::storage())?;
    let rows = stmt
        .query_map([id], |r| r.get::<_, String>(0))
        .map_err(|_| AiError::storage())?;
    rows.map(|r| decode(&r.map_err(|_| AiError::storage())?))
        .collect()
}
pub fn get_task(db: &Connection, id: &str) -> AiResult<TaskDetail> {
    let value:Option<Vec<String>>=db.query_row("SELECT id,COALESCE(parent_id,''),created_at,status,request_payload,progress,call_attempts,group_summaries,errors FROM ai_tasks WHERE id=?1",[id],|r|(0..9).map(|i|r.get::<_,String>(i)).collect()).optional().map_err(|_|AiError::storage())?;
    let v = value.ok_or_else(|| AiError::new("notFound", "分析记录不存在"))?;
    Ok(TaskDetail { id:v[0].clone(),parent_id:if v[1].is_empty(){None}else{Some(v[1].clone())},created_at:v[2].clone(),status:decode(&v[3])?,request_snapshot:decode(&v[4])?,progress:decode(&v[5])?,call_attempts:decode(&v[6])?,group_summary_versions:decode(&v[7])?,errors:decode(&v[8])?,security_snapshots:rows(db,"SELECT s.payload FROM ai_snapshots s JOIN ai_task_snapshots a ON a.snapshot_id=s.id WHERE a.task_id=?1 ORDER BY s.id",id)?,reports:rows(db,"SELECT payload FROM ai_reports WHERE task_id=?1 ORDER BY rowid",id)?,summary_versions:rows(db,"SELECT payload FROM ai_summaries WHERE task_id=?1 ORDER BY version,rowid",id)? })
}
pub fn save_snapshot(db: &mut Connection, task_id: &str, snapshot: &Snapshot) -> AiResult<()> {
    validate_security(&snapshot.security)?;
    if timestamp(&snapshot.frozen_at)? < timestamp(&snapshot.cutoff_at)? {
        return Err(invalid("冻结时间早于截止时间"));
    }
    let task = get_task(db, task_id)?;
    if !task
        .request_snapshot
        .securities
        .contains(&snapshot.security)
    {
        return Err(invalid("快照证券不属于任务"));
    }
    let mut unique = std::collections::HashSet::new();
    for e in &snapshot.evidence {
        if e.security_id != snapshot.security.id || !unique.insert(&e.id) {
            return Err(invalid("证据归属无效或重复"));
        }
        timestamp(&e.collected_at)?;
    }
    let tx = db.transaction().map_err(|_| AiError::storage())?;
    let payload = encode(snapshot)?;
    let old: Option<String> = tx
        .query_row(
            "SELECT payload FROM ai_snapshots WHERE id=?1",
            [&snapshot.id],
            |r| r.get(0),
        )
        .optional()
        .map_err(|_| AiError::storage())?;
    if let Some(old) = old {
        if old != payload {
            return Err(invalid("不能修改已冻结快照"));
        }
    } else {
        tx.execute(
            "INSERT INTO ai_snapshots VALUES(?1,?2)",
            params![snapshot.id, payload],
        )
        .map_err(|_| AiError::storage())?;
        for e in &snapshot.evidence {
            let payload = encode(e)?;
            let old: Option<String> = tx
                .query_row(
                    "SELECT payload FROM ai_evidence WHERE id=?1",
                    [&e.id],
                    |r| r.get(0),
                )
                .optional()
                .map_err(|_| AiError::storage())?;
            if let Some(old) = old {
                if old != payload {
                    return Err(invalid("不能改写历史证据"));
                }
            } else {
                tx.execute(
                    "INSERT INTO ai_evidence VALUES(?1,?2)",
                    params![e.id, payload],
                )
                .map_err(|_| AiError::storage())?;
            }
            tx.execute(
                "INSERT INTO ai_snapshot_evidence VALUES(?1,?2)",
                params![snapshot.id, e.id],
            )
            .map_err(|_| AiError::storage())?;
        }
    }
    tx.execute(
        "INSERT OR IGNORE INTO ai_task_snapshots VALUES(?1,?2)",
        params![task_id, snapshot.id],
    )
    .map_err(|_| AiError::storage())?;
    tx.commit().map_err(|_| AiError::storage())?;
    Ok(())
}
pub fn save_report(db: &mut Connection, task_id: &str, report: &IndependentReport) -> AiResult<()> {
    let task = get_task(db, task_id)?;
    if !task
        .security_snapshots
        .iter()
        .any(|s| s.id == report.snapshot_id)
        || !task
            .request_snapshot
            .participant_ids
            .contains(&report.model_snapshot.id)
    {
        return Err(invalid("模型报告不属于该快照或参与模型"));
    }
    db.execute(
        "INSERT INTO ai_reports VALUES(?1,?2,?3,?4)",
        params![report.id, task_id, report.snapshot_id, encode(report)?],
    )
    .map_err(|_| AiError::new("immutableReport", "报告已存在或无法保存"))?;
    Ok(())
}
pub fn append_summary(
    db: &mut Connection,
    task_id: &str,
    summary: &SummaryVersion,
) -> AiResult<()> {
    let tx = db.transaction().map_err(|_| AiError::storage())?;
    let task = get_task(&tx, task_id)?;
    let max = task
        .summary_versions
        .iter()
        .filter(|s| s.snapshot_id == summary.snapshot_id)
        .map(|s| s.version)
        .max()
        .unwrap_or(0);
    if summary.version != max + 1 || summary.input_report_ids.is_empty() {
        return Err(invalid("汇总版本必须追加并指定输入报告"));
    }
    let mut models = std::collections::HashSet::new();
    for id in &summary.input_report_ids {
        let r = task
            .reports
            .iter()
            .find(|r| r.id == *id)
            .ok_or_else(|| invalid("汇总输入报告不存在"))?;
        if r.snapshot_id != summary.snapshot_id
            || r.validation.get("valid").and_then(|v| v.as_bool()) != Some(true)
            || !models.insert(&r.model_snapshot.id)
        {
            return Err(invalid("汇总输入无效、跨快照或同一模型重复"));
        }
    }
    tx.execute(
        "INSERT INTO ai_summaries VALUES(?1,?2,?3,?4,?5)",
        params![
            summary.id,
            task_id,
            summary.snapshot_id,
            summary.version,
            encode(summary)?
        ],
    )
    .map_err(|_| AiError::storage())?;
    tx.commit().map_err(|_| AiError::storage())?;
    Ok(())
}
pub fn set_status(db: &Connection, task_id: &str, status: TaskStatus) -> AiResult<()> {
    if db
        .execute(
            "UPDATE ai_tasks SET status=?1 WHERE id=?2",
            params![encode(&status)?, task_id],
        )
        .map_err(|_| AiError::storage())?
        != 1
    {
        return Err(AiError::new("notFound", "分析记录不存在"));
    }
    Ok(())
}
pub fn list_history(db: &Connection, q: &HistoryQuery) -> AiResult<HistoryPage> {
    let limit = q.limit.unwrap_or(30);
    if limit == 0 || limit > 100 {
        return Err(invalid("历史分页数量必须为1～100"));
    }
    let cursor = q
        .cursor
        .as_ref()
        .map(|c| c.parse::<i64>().map_err(|_| invalid("历史游标无效")))
        .transpose()?;
    let offset = chrono::FixedOffset::east_opt(8 * 3600).unwrap();
    let bound = |s: &Option<String>, end: bool| -> AiResult<Option<String>> {
        s.as_ref()
            .map(|s| {
                let mut d = chrono::NaiveDate::parse_from_str(s, "%Y-%m-%d")
                    .map_err(|_| invalid("历史日期无效"))?;
                if end {
                    d = d.succ_opt().ok_or_else(|| invalid("历史日期无效"))?;
                }
                let local = d
                    .and_hms_opt(0, 0, 0)
                    .unwrap()
                    .and_local_timezone(offset)
                    .single()
                    .ok_or_else(|| invalid("历史日期无效"))?;
                Ok(local.with_timezone(&chrono::Utc).to_rfc3339())
            })
            .transpose()
    };
    let start = bound(&q.date_from, false)?;
    let end = bound(&q.date_to, true)?;
    if let (Some(a), Some(b)) = (&start, &end) {
        if a >= b {
            return Err(invalid("历史日期范围无效"));
        }
    }
    let status = q.status.as_ref().map(encode).transpose()?;
    let mut stmt=db.prepare("SELECT id,seq,request_payload FROM ai_tasks WHERE (?1 IS NULL OR seq<?1) AND (?2 IS NULL OR created_at>=?2) AND (?3 IS NULL OR created_at<?3) AND (?4 IS NULL OR status=?4) ORDER BY seq DESC").map_err(|_|AiError::storage())?;
    let mut rows = stmt
        .query(params![cursor, start, end, status])
        .map_err(|_| AiError::storage())?;
    let mut found = Vec::new();
    while let Some(r) = rows.next().map_err(|_| AiError::storage())? {
        let request: StartRequest =
            decode(&r.get::<_, String>(2).map_err(|_| AiError::storage())?)?;
        if q.security_id
            .as_ref()
            .is_none_or(|id| request.securities.iter().any(|s| s.id == *id))
        {
            found.push((
                r.get::<_, String>(0).map_err(|_| AiError::storage())?,
                r.get::<_, i64>(1).map_err(|_| AiError::storage())?,
            ));
            if found.len() > limit as usize {
                break;
            }
        }
    }
    let more = found.len() > limit as usize;
    found.truncate(limit as usize);
    let next_cursor = if more {
        found.last().map(|r| r.1.to_string())
    } else {
        None
    };
    let items = found
        .into_iter()
        .map(|(id, _)| get_task(db, &id))
        .collect::<AiResult<Vec<_>>>()?;
    Ok(HistoryPage { items, next_cursor })
}
pub fn delete_task(db: &mut Connection, task_id: &str) -> AiResult<()> {
    let tx = db.transaction().map_err(|_| AiError::storage())?;
    let task = get_task(&tx, task_id)?;
    if task.status.active() {
        return Err(invalid("请先取消正在运行的分析"));
    }
    if task.parent_id.is_some() {
        return Err(invalid("请通过整批任务管理此报告"));
    }
    let active:i64=tx.query_row("WITH RECURSIVE children AS (SELECT id,status FROM ai_tasks WHERE parent_id=?1 UNION ALL SELECT t.id,t.status FROM ai_tasks t JOIN children c ON t.parent_id=c.id) SELECT COUNT(*) FROM children WHERE status IN ('\"pending\"','\"collecting\"','\"analyzing\"','\"summarizing\"')",[task_id],|r|r.get(0)).map_err(|_|AiError::storage())?;
    if active > 0 {
        return Err(invalid("请先取消批量分析"));
    }
    tx.execute("DELETE FROM ai_tasks WHERE id=?1", [task_id])
        .map_err(|_| AiError::storage())?;
    tx.execute(
        "DELETE FROM ai_snapshots WHERE id NOT IN (SELECT snapshot_id FROM ai_task_snapshots)",
        [],
    )
    .map_err(|_| AiError::storage())?;
    tx.execute(
        "DELETE FROM ai_evidence WHERE id NOT IN (SELECT evidence_id FROM ai_snapshot_evidence)",
        [],
    )
    .map_err(|_| AiError::storage())?;
    tx.commit().map_err(|_| AiError::storage())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn setup() -> Connection {
        let db = Connection::open_in_memory().unwrap();
        initialize(&db).unwrap();
        db
    }
    fn request(id: &str) -> StartRequest {
        StartRequest {
            request_id: id.into(),
            securities: vec![fixture().security],
            group: None,
            participant_ids: vec!["model-1".into()],
            summary_model_id: "model-1".into(),
        }
    }
    fn fixture() -> Snapshot {
        serde_json::from_str(include_str!("fixtures/contracts/snapshot.json")).unwrap()
    }
    fn model() -> ModelConfig {
        ModelConfig {
            id: "model-1".into(),
            display_name: "测试模型".into(),
            provider: "custom".into(),
            base_url: "https://example.com/v1".into(),
            model: "test".into(),
            enabled: true,
        }
    }
    fn report() -> IndependentReport {
        IndependentReport {
            id: "report-1".into(),
            snapshot_id: "snapshot-1".into(),
            model_snapshot: model(),
            windows: json!({}),
            claims: json!([]),
            raw_output: "{}".into(),
            validation: json!({"valid":true}),
            usage: None,
        }
    }
    fn summary(version: u32) -> SummaryVersion {
        SummaryVersion {
            id: format!("summary-{version}"),
            snapshot_id: "snapshot-1".into(),
            version,
            input_report_ids: vec!["report-1".into()],
            summary_model_snapshot: model(),
            windows: json!({}),
            key_claims: json!([]),
            disagreements: json!([]),
            validation: json!({"valid":true}),
        }
    }
    #[test]
    fn migration_preserves_account_and_history() {
        let db = Connection::open_in_memory().unwrap();
        db.execute_batch("CREATE TABLE account(payload TEXT); INSERT INTO account VALUES('ledger'); CREATE TABLE analysis_daily_bars(payload TEXT); INSERT INTO analysis_daily_bars VALUES('history');").unwrap();
        initialize(&db).unwrap();
        initialize(&db).unwrap();
        assert_eq!(
            db.query_row("SELECT payload FROM account", [], |r| r.get::<_, String>(0))
                .unwrap(),
            "ledger"
        );
        assert_eq!(
            db.query_row("SELECT payload FROM analysis_daily_bars", [], |r| r
                .get::<_, String>(0))
                .unwrap(),
            "history"
        );
        assert!(db
            .query_row("SELECT COUNT(*) FROM ai_tasks", [], |r| r.get::<_, i64>(0))
            .is_ok());
    }
    #[test]
    fn duplicate_request_returns_same_task() {
        let mut db = setup();
        let first = create_task(&mut db, &request("request-1"));
        assert!(first.is_ok());
        let first = first.unwrap();
        let second = create_task(&mut db, &request("request-1")).unwrap();
        assert_eq!(first.id, second.id);
        let mut altered = request("request-1");
        altered.summary_model_id = "different".into();
        assert!(create_task(&mut db, &altered).is_err());
    }
    #[test]
    fn summary_versions_are_append_only() {
        let mut db = setup();
        let t = create_task(&mut db, &request("request-1")).unwrap();
        save_snapshot(&mut db, &t.id, &fixture()).unwrap();
        save_report(&mut db, &t.id, &report()).unwrap();
        append_summary(&mut db, &t.id, &summary(1)).unwrap();
        append_summary(&mut db, &t.id, &summary(2)).unwrap();
        assert!(append_summary(&mut db, &t.id, &summary(1)).is_err());
        let restored = get_task(&db, &t.id).unwrap();
        assert_eq!(restored.summary_versions.len(), 2);
        assert_eq!(
            restored.security_snapshots[0].cutoff_at,
            "2026-10-13T10:30:00+08:00"
        );
        let mut changed = fixture();
        changed.reference_price = Some("999".into());
        assert!(save_snapshot(&mut db, &t.id, &changed).is_err());
    }
    #[test]
    fn delete_keeps_shared_evidence() {
        let mut db = setup();
        let a = create_task(&mut db, &request("a")).unwrap();
        let b = create_task(&mut db, &request("b")).unwrap();
        save_snapshot(&mut db, &a.id, &fixture()).unwrap();
        save_snapshot(&mut db, &b.id, &fixture()).unwrap();
        set_status(&db, &a.id, TaskStatus::Completed).unwrap();
        set_status(&db, &b.id, TaskStatus::Completed).unwrap();
        delete_task(&mut db, &a.id).unwrap();
        assert_eq!(
            get_task(&db, &b.id).unwrap().security_snapshots[0].evidence[0].id,
            "evidence-1"
        );
        assert_eq!(
            db.query_row("SELECT COUNT(*) FROM ai_evidence", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            1
        );
        delete_task(&mut db, &b.id).unwrap();
        assert_eq!(
            db.query_row("SELECT COUNT(*) FROM ai_evidence", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            0
        );
    }
    #[test]
    fn history_filters_and_pages_without_duplicates() {
        let mut db = setup();
        for id in ["a", "b", "c"] {
            create_task(&mut db, &request(id)).unwrap();
        }
        let page = list_history(
            &db,
            &HistoryQuery {
                security_id: Some("sh600519".into()),
                limit: Some(2),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(page.items.len(), 2);
        assert!(page.next_cursor.is_some());
        let next = list_history(
            &db,
            &HistoryQuery {
                cursor: page.next_cursor,
                limit: Some(2),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(next.items.len(), 1);
        assert!(!page.items.iter().any(|p| p.id == next.items[0].id));
        assert!(list_history(
            &db,
            &HistoryQuery {
                date_from: Some("invalid".into()),
                ..Default::default()
            }
        )
        .is_err());
    }
    #[test]
    fn unknown_snapshot_or_foreign_model_report_is_rejected() {
        let mut db = setup();
        let t = create_task(&mut db, &request("a")).unwrap();
        assert!(save_report(&mut db, &t.id, &report()).is_err());
        save_snapshot(&mut db, &t.id, &fixture()).unwrap();
        let mut r = report();
        r.model_snapshot.id = "other".into();
        assert!(save_report(&mut db, &t.id, &r).is_err());
        assert!(delete_task(&mut db, &t.id).is_err());
    }
}
