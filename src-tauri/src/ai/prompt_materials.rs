use super::types::Snapshot;
use serde_json::{json, Value};
// Tables replace repeated market column labels only. The frozen snapshot is never changed.
fn market_table(v: &Value) -> Value {
    match v {
        Value::Array(rows) if rows.len() >= 3 && rows.iter().all(Value::is_object) => {
            let cols = rows[0]
                .as_object()
                .unwrap()
                .keys()
                .cloned()
                .collect::<Vec<_>>();
            if rows
                .iter()
                .all(|r| r.as_object().unwrap().keys().cloned().collect::<Vec<_>>() == cols)
            {
                return json!({"columns":cols,"rows":rows.iter().map(|r|cols.iter().map(|k|market_table(&r[k])).collect::<Vec<_>>()).collect::<Vec<_>>()});
            }
            Value::Array(rows.iter().map(market_table).collect())
        }
        Value::Array(rows) => Value::Array(rows.iter().map(market_table).collect()),
        Value::Object(o) => Value::Object(
            o.iter()
                .map(|(k, v)| (k.clone(), market_table(v)))
                .collect(),
        ),
        _ => v.clone(),
    }
}
pub fn snapshot(s: &Snapshot) -> Value {
    let evidence=s.evidence.iter().filter(|e|e.kind!="accountSummary").map(|e|{
  let parsed=serde_json::from_str::<Value>(&e.content).unwrap_or_else(|_|Value::String(e.content.clone()));
  let mut content=if ["daily","intraday"].contains(&e.kind.as_str()){market_table(&parsed)}else{parsed};
  if e.kind=="execution" {if let Some(p)=content["position"].as_object_mut(){p.remove("trades");p.remove("feeProfile");}}
  if e.kind=="news" {if let Some(news)=content.as_object_mut(){news.remove("summary");if e.availability!="fullText" {news.remove("fullText");news.insert("readingBoundary".into(),json!("未取得完整正文，仅作为来源线索，不用于事件影响判断。"));}}}
  json!({"id":e.id,"kind":e.kind,"source":e.source,"url":e.url,"publishedAt":e.published_at,"timePrecision":e.time_precision,"eventAt":e.event_at,"collectedAt":e.collected_at,"availability":e.availability,"referenceAllowed":e.availability!="titleOnly","content":content})
 }).collect::<Vec<_>>();
    let account_summary = s
        .evidence
        .iter()
        .find(|e| e.kind == "accountSummary")
        .and_then(|e| serde_json::from_str::<Value>(&e.content).ok())
        .unwrap_or_else(|| super::account_brief::build(s));
    json!({"readingGuide":super::account_brief::READING_GUIDE,"accountSummary":account_summary,"security":s.security,"cutoffAt":s.cutoff_at,"frozenAt":s.frozen_at,"referencePrice":s.reference_price,"windows":s.windows,"sourceStates":s.source_states,"allowedEvidenceIds":s.evidence.iter().filter(|e|e.availability!="titleOnly" && e.kind!="accountSummary").map(|e|e.id.clone()).collect::<Vec<_>>(),"requiredOperationEvidenceIds":s.evidence.iter().filter(|e|["position","cash"].contains(&e.kind.as_str())).map(|e|e.id.clone()).collect::<Vec<_>>(),"evidence":evidence})
}
// The synthesis reads original model reports, not another full set of price bars.
// Keep quotes, account/trades/cash, execution levels and evidence provenance intact.
pub fn summary_snapshot(s: &Snapshot) -> Value {
    let mut compact = snapshot(s);
    if let Some(evidence) = compact["evidence"].as_array_mut() {
        for item in evidence {
            if matches!(item["kind"].as_str(), Some("daily" | "intraday")) {
                item["content"] = json!({
                    "notResent": true,
                    "note": "完整行情序列已用于独立分析，本次汇总不重复发送；请依据独立报告综合判断，不声称已重新计算或核验行情指标。"
                });
            }
        }
    }
    compact
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn tables_preserve_every_market_value_and_leave_unequal_columns_unchanged() {
        let data = json!([{"time":"09:30","price":"10.1","volume":"0"},{"time":"09:31","price":"10.2","volume":null},{"time":"09:32","price":"10.0","volume":"7"}]);
        let table = market_table(&data);
        let cols = table["columns"].as_array().unwrap();
        let back = table["rows"]
            .as_array()
            .unwrap()
            .iter()
            .map(|row| {
                Value::Object(
                    cols.iter()
                        .enumerate()
                        .map(|(i, k)| (k.as_str().unwrap().to_string(), row[i].clone()))
                        .collect(),
                )
            })
            .collect::<Vec<_>>();
        assert_eq!(Value::Array(back), data);
        let different = json!([{"p":1},{"p":2},{"p":3,"missing":null}]);
        assert_eq!(market_table(&different), different);
    }
}

#[cfg(test)]
#[test]
#[ignore = "explicit local saved-snapshot size check; no models or secrets are accessed"]
fn saved_snapshot_size_diagnostic() {
    let path = std::env::var("TKE_QA_DATABASE_PATH").expect("provide read-only database path");
    let db =
        rusqlite::Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
            .unwrap();
    let raw:String=db.query_row("SELECT s.payload FROM ai_snapshots s JOIN ai_task_snapshots ts ON ts.snapshot_id=s.id JOIN ai_tasks t ON t.id=ts.task_id ORDER BY t.seq DESC LIMIT 1",[],|r|r.get(0)).unwrap();
    let s: Snapshot = serde_json::from_str(&raw).unwrap();
    let compact = snapshot(&s);
    let old = serde_json::to_vec(&s).unwrap().len();
    let new = serde_json::to_vec(&compact).unwrap().len();
    assert!(new < old);
    assert_eq!(
        compact["evidence"].as_array().unwrap().len(),
        s.evidence
            .iter()
            .filter(|e| e.kind != "accountSummary")
            .count()
    );
    for (e, item) in s
        .evidence
        .iter()
        .filter(|e| e.kind != "accountSummary")
        .zip(compact["evidence"].as_array().unwrap())
    {
        if ["position", "cash"].contains(&e.kind.as_str()) {
            assert_eq!(
                item["content"],
                serde_json::from_str::<Value>(&e.content).unwrap()
            );
        }
    }
    println!("Saved snapshot input: {old} -> {new} bytes; reduction {:.1}%; full position/trade/cash contents preserved",100.-new as f64/old as f64*100.);
}
