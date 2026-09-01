use serde::Serialize;
use serde_json::Value;
use std::collections::{BTreeMap, HashSet};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FundFlow {
    market: String,
    code: String,
    main_net: String,
    quote_time: String,
    fetched_at: String,
    source: &'static str,
}
#[derive(Debug, Serialize)]
pub struct FundFlowBatch {
    flows: Vec<FundFlow>,
    errors: BTreeMap<String, String>,
}

// The ulist endpoint uses f62=main net, f66=super-large net, f72=large net.
// These field IDs are NOT interchangeable with stock/get field IDs.
fn cents(v: &Value) -> Option<i128> {
    let raw = match v {
        Value::Number(n) => n.to_string(),
        Value::String(s) => s.clone(),
        _ => return None,
    };
    let negative = raw.starts_with('-');
    let s = raw.strip_prefix('-').unwrap_or(&raw);
    let (whole, fraction) = s.split_once('.').unwrap_or((s, ""));
    if whole.is_empty()
        || whole.len() > 15
        || fraction.len() > 2
        || !whole
            .bytes()
            .chain(fraction.bytes())
            .all(|b| b.is_ascii_digit())
    {
        return None;
    }
    let n = whole.parse::<i128>().ok()? * 100 + format!("{fraction:0<2}").parse::<i128>().ok()?;
    Some(if negative { -n } else { n })
}
fn amount(n: i128) -> String {
    format!(
        "{}{}.{:02}",
        if n < 0 { "-" } else { "" },
        n.abs() / 100,
        n.abs() % 100
    )
}

fn parse(bytes: &[u8], symbols: &[super::Symbol]) -> Result<FundFlowBatch, String> {
    let json: Value = serde_json::from_slice(bytes).map_err(|_| "资金流响应不是有效JSON")?;
    if json["rc"].as_i64() != Some(0) {
        return Err("东方财富资金流服务暂不可用".into());
    }
    let rows = json["data"]["diff"].as_array().ok_or("资金流字段缺失")?;
    if rows.len() > 50 {
        return Err("资金流响应超出范围".into());
    }
    let requested: HashSet<String> = symbols
        .iter()
        .map(|s| format!("{}{}", s.market, s.code))
        .collect();
    let mut found = BTreeMap::new();
    for row in rows {
        let market = match row["f13"].as_i64() {
            Some(1) => "sh",
            Some(0) => "sz",
            _ => return Err("资金流市场字段异常".into()),
        };
        let code = row["f12"].as_str().ok_or("资金流代码缺失")?;
        let id = format!("{market}{code}");
        if !requested.contains(&id) || found.contains_key(&id) {
            return Err("资金流证券不匹配或重复".into());
        }
        let result = (|| -> Result<FundFlow, String> {
            let main = cents(&row["f62"]).ok_or("该证券主力净流入暂缺")?;
            let large = cents(&row["f72"]).ok_or("大单资金字段暂缺")?;
            let super_large = cents(&row["f66"]).ok_or("超大单资金字段暂缺")?;
            if main != large + super_large {
                return Err("资金流字段口径校验失败".into());
            }
            let timestamp = row["f124"].as_i64().ok_or("资金流时间缺失")?;
            if timestamp < 946684800 || timestamp > chrono::Utc::now().timestamp() + 300 {
                return Err("资金流时间异常".into());
            }
            let time = chrono::DateTime::from_timestamp(timestamp, 0)
                .ok_or("资金流时间异常")?
                .with_timezone(&chrono::FixedOffset::east_opt(8 * 3600).unwrap());
            Ok(FundFlow {
                market: market.into(),
                code: code.into(),
                main_net: amount(main),
                quote_time: time.format("%Y%m%d%H%M%S").to_string(),
                fetched_at: chrono::Utc::now().to_rfc3339(),
                source: "东方财富",
            })
        })();
        found.insert(id, result);
    }
    let mut out = FundFlowBatch {
        flows: vec![],
        errors: BTreeMap::new(),
    };
    for s in symbols {
        let id = format!("{}{}", s.market, s.code);
        match found
            .remove(&id)
            .unwrap_or_else(|| Err("该证券资金流暂缺".into()))
        {
            Ok(flow) => out.flows.push(flow),
            Err(error) => {
                out.errors.insert(id, error);
            }
        }
    }
    Ok(out)
}

async fn request(
    client: &reqwest::Client,
    symbols: &[super::Symbol],
) -> Result<FundFlowBatch, String> {
    if symbols.is_empty()
        || symbols.len() > 50
        || symbols
            .iter()
            .any(|s| !super::valid_symbol(&s.market, &s.code))
    {
        return Err("一次只允许1至50只范围内证券".into());
    }
    let secids = symbols
        .iter()
        .map(|s| format!("{}.{}", if s.market == "sh" { 1 } else { 0 }, s.code))
        .collect::<Vec<_>>()
        .join(",");
    let mut response = client
        .get("https://push2.eastmoney.com/api/qt/ulist.np/get")
        .header("Referer", "https://data.eastmoney.com/")
        .query(&[
            ("secids", secids.as_str()),
            ("fltt", "2"),
            ("fields", "f12,f13,f14,f62,f66,f72,f124"),
        ])
        .send()
        .await
        .map_err(|_| "东方财富资金流连接失败或超时")?
        .error_for_status()
        .map_err(|_| "东方财富资金流服务暂不可用")?;
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| "资金流读取失败")? {
        if bytes.len() + chunk.len() > 262144 {
            return Err("资金流响应过大".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    parse(&bytes, symbols)
}
#[tauri::command]
pub async fn fetch_fund_flows(
    client: tauri::State<'_, reqwest::Client>,
    window: tauri::WebviewWindow,
    symbols: Vec<super::Symbol>,
) -> Result<FundFlowBatch, String> {
    if !window.is_visible().unwrap_or(false) || window.is_minimized().unwrap_or(true) {
        return Err("窗口隐藏，资金流已暂停".into());
    }
    request(&client, &symbols).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn symbols() -> Vec<super::super::Symbol> {
        vec![super::super::Symbol {
            market: "sh".into(),
            code: "510300".into(),
        }]
    }
    fn row() -> Value {
        json!({"f12":"510300","f13":1,"f62":-1234.56,"f66":-1000,"f72":-234.56,"f124":1788163200})
    }
    fn run(rows: Value) -> Result<FundFlowBatch, String> {
        parse(
            json!({"rc":0,"data":{"diff":rows}}).to_string().as_bytes(),
            &symbols(),
        )
    }
    #[test]
    fn signed_decimal_zero_missing_and_identity() {
        assert_eq!(run(json!([row()])).unwrap().flows[0].main_net, "-1234.56");
        let mut r = row();
        r["f62"] = json!(0);
        r["f66"] = json!(0);
        r["f72"] = json!(0);
        assert_eq!(run(json!([r])).unwrap().flows[0].main_net, "0.00");
        assert_eq!(run(json!([])).unwrap().errors.len(), 1);
        let mut r = row();
        r["f12"] = json!("600519");
        assert!(run(json!([r])).is_err());
        assert!(run(json!([row(), row()])).is_err());
    }
    #[test]
    fn reject_field_changes_and_invalid_times() {
        for field in ["f62", "f66", "f72", "f124"] {
            let mut r = row();
            r[field] = json!("-");
            assert!(run(json!([r])).unwrap().flows.is_empty());
        }
        let mut r = row();
        r["f62"] = json!(2);
        assert!(run(json!([r])).unwrap().flows.is_empty());
        let mut r = row();
        r["f124"] = json!(0);
        assert!(run(json!([r])).unwrap().flows.is_empty());
        assert!(parse(b"invalid", &symbols()).is_err());
        assert!(parse(br#"{"rc":0,"data":null}"#, &symbols()).is_err());
        assert!(cents(&json!("NaN")).is_none());
        assert!(cents(&json!("1e3")).is_none());
    }
    #[test]
    #[ignore = "requires public network"]
    fn live_fund_flows() {
        tauri::async_runtime::block_on(async {
            let client = reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(8))
                .redirect(reqwest::redirect::Policy::none())
                .build()
                .unwrap();
            let symbols = vec![
                super::super::Symbol {
                    market: "sz".into(),
                    code: "002465".into(),
                },
                super::super::Symbol {
                    market: "sh".into(),
                    code: "563230".into(),
                },
            ];
            let result = request(&client, &symbols).await.unwrap();
            println!("{result:?}");
            assert_eq!(result.flows.len(), 2);
        });
    }
}
