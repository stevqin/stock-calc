use serde_json::{json, Value};

fn value_string(v: &Value) -> Option<String> {
    match v {
        Value::String(s) => Some(s.clone()),
        Value::Number(n) => Some(n.to_string()),
        _ => None,
    }
}
fn numeric(v: &Value) -> Option<String> {
    let s = value_string(v)?;
    let n = s.parse::<f64>().ok()?;
    if n.is_finite() && n >= 0.0 {
        Some(s)
    } else {
        None
    }
}
fn required(v: &Value) -> Result<String, String> {
    numeric(v).ok_or_else(|| "行情数值格式异常".into())
}
pub fn parse_chart(v: Value, symbol: &str, mode: &str) -> Result<Value, String> {
    if v["code"].as_i64() != Some(0) {
        return Err("图表服务返回异常".into());
    }
    let d = &v["data"][symbol];
    if !d.is_object() {
        return Err("该证券暂无图表数据".into());
    }
    let updated = chrono::Utc::now().to_rfc3339();
    if mode == "daily" || mode == "daily-raw" {
        let rows = d
            .get("qfqday")
            .or_else(|| d.get("day"))
            .and_then(|v| v.as_array())
            .ok_or("暂无日K数据")?;
        let mut bars = Vec::new();
        for r in rows {
            let date = r[0].as_str().ok_or("日K日期缺失")?;
            if chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d").is_err() {
                return Err("日K日期无效".into());
            }
            let open = required(&r[1])?;
            let close = required(&r[2])?;
            let high = required(&r[3])?;
            let low = required(&r[4])?;
            if low.parse::<f64>().unwrap() > high.parse::<f64>().unwrap() {
                return Err("日K高低价异常".into());
            }
            bars.push(json!({"date":date,"open":open,"close":close,"high":high,"low":low,"volume":required(&r[5])?}));
        }
        return Ok(
            json!({"symbol":symbol,"mode":mode,"bars":bars,"sessions":[],"adjustment":if d.get("qfqday").is_some(){"前复权"}else{"不复权"},"fetchedAt":updated}),
        );
    }
    let sessions: Vec<Value> = if mode == "intraday" {
        vec![json!({"date":d["data"]["date"],"data":d["data"]["data"],"prec":d["qt"][symbol][4]})]
    } else {
        d["data"].as_array().ok_or("暂无五日分时")?.clone()
    };
    let mut result = Vec::new();
    for session in sessions.into_iter().take(5) {
        let date = session["date"].as_str().ok_or("分时日期缺失")?;
        if chrono::NaiveDate::parse_from_str(date, "%Y%m%d").is_err() {
            return Err("分时日期异常".into());
        }
        let rows = session["data"].as_array().ok_or("分时点位缺失")?;
        let mut points = std::collections::BTreeMap::new();
        for r in rows {
            let parts: Vec<&str> = r
                .as_str()
                .ok_or("分时格式异常")?
                .split_whitespace()
                .collect();
            if parts.len() < 3 {
                return Err("分时字段缺失".into());
            }
            let time = parts[0];
            if time.len() != 4 || chrono::NaiveTime::parse_from_str(time, "%H%M").is_err() {
                return Err("分时时间异常".into());
            }
            if !("0930"..="1130").contains(&time) && !("1300"..="1500").contains(&time) {
                continue;
            }
            let price = required(&json!(parts[1]))?;
            let volume = required(&json!(parts[2]))?;
            let amount = parts.get(3).and_then(|s| numeric(&json!(s)));
            points.insert(
                time.to_owned(),
                json!({"time":time,"price":price,"volume":volume,"amount":amount}),
            );
        }
        result.push(json!({"date":date,"previousClose":numeric(&session["prec"]),"points":points.into_values().collect::<Vec<_>>()}));
    }
    result.sort_by(|a, b| a["date"].as_str().cmp(&b["date"].as_str()));
    Ok(
        json!({"symbol":symbol,"mode":mode,"bars":[],"sessions":result,"adjustment":"不复权","fetchedAt":updated}),
    )
}
#[tauri::command]
pub async fn fetch_chart(
    client: tauri::State<'_, reqwest::Client>,
    window: tauri::WebviewWindow,
    market: String,
    code: String,
    mode: String,
) -> Result<Value, String> {
    if !window.is_visible().unwrap_or(false) || window.is_minimized().unwrap_or(true) {
        return Err("窗口隐藏，图表刷新已暂停".into());
    }
    request_chart(&client, &market, &code, &mode).await
}
async fn request_chart(
    client: &reqwest::Client,
    market: &str,
    code: &str,
    mode: &str,
) -> Result<Value, String> {
    if !super::valid_symbol(&market, &code) {
        return Err("证券代码无效".into());
    }
    let symbol = format!("{market}{code}");
    let url = match mode {
        "daily" => format!(
            "https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param={symbol},day,,,180,qfq"
        ),
        "daily-raw" => {
            format!("https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param={symbol},day,,,180,")
        }
        "intraday" => format!("https://web.ifzq.gtimg.cn/appstock/app/minute/query?code={symbol}"),
        "five-day" => format!("https://web.ifzq.gtimg.cn/appstock/app/day/query?code={symbol}"),
        _ => return Err("不支持的图表周期".into()),
    };
    let mut response = client
        .get(url)
        .send()
        .await
        .map_err(|_| "图表请求超时或网络不可用")?
        .error_for_status()
        .map_err(|_| "图表服务不可用")?;
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| "读取图表失败")? {
        if bytes.len() + chunk.len() > 2 * 1024 * 1024 {
            return Err("图表响应过大".into());
        }
        bytes.extend_from_slice(&chunk)
    }
    let value: Value = serde_json::from_slice(&bytes).map_err(|_| "图表响应不是JSON")?;
    parse_chart(value, &symbol, &mode)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    #[ignore = "manual public-network chart smoke test"]
    fn live_charts() {
        tauri::async_runtime::block_on(async {
            let client = reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(8))
                .redirect(reqwest::redirect::Policy::none())
                .build()
                .unwrap();
            for code in ["510300", "600519", "518880", "511010"] {
                for mode in ["daily", "daily-raw", "intraday", "five-day"] {
                    let result = request_chart(&client, "sh", code, mode).await.unwrap();
                    let count = if mode == "daily" || mode == "daily-raw" {
                        result["bars"].as_array().unwrap().len()
                    } else {
                        result["sessions"].as_array().unwrap().len()
                    };
                    assert!(count > 0);
                    if mode == "daily-raw" {
                        assert_eq!(result["adjustment"], "不复权");
                    }
                    println!("sh{code} {mode}: {count}");
                }
            }
        });
    }
    #[test]
    fn daily_ohlc() {
        let result=parse_chart(json!({"code":0,"data":{"sh510300":{"qfqday":[["2026-08-28","4.68","4.67","4.70","4.65","100"]]}}}),"sh510300","daily").unwrap();
        assert_eq!(result["bars"][0]["close"], "4.67");
        assert_eq!(result["bars"][0]["low"], "4.65");
    }
    #[test]
    fn sessions_order_and_market_hours() {
        let result=parse_chart(json!({"code":0,"data":{"sh510300":{"data":[{"date":"20260831","prec":"4.67","data":["0930 4.6 10 4600","0930 4.61 11 5071","1200 4.6 12 5500","1530 4.6 15 6000"]},{"date":"20260828","prec":"4.6","data":["0930 4.67 20 9340"]}]}}}),"sh510300","five-day").unwrap();
        assert_eq!(result["sessions"][0]["date"], "20260828");
        assert_eq!(result["sessions"][1]["points"].as_array().unwrap().len(), 1);
        assert_eq!(result["sessions"][1]["points"][0]["price"], "4.61");
    }
    #[test]
    fn invalid_data() {
        assert!(parse_chart(json!({"code":-1}), "sh510300", "daily").is_err());
        assert!(parse_chart(json!({"code":0,"data":{}}), "sh510300", "intraday").is_err());
    }
}
