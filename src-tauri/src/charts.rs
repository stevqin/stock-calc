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
            json!({"symbol":symbol,"mode":mode,"bars":bars,"sessions":[],"historyWindow":400,"adjustment":if d.get("qfqday").is_some(){"前复权"}else{"不复权"},"fetchedAt":updated}),
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
    background: Option<bool>,
) -> Result<Value, String> {
    if !crate::market_request_allowed(
        background.unwrap_or(false) && mode == "daily-raw",
        window.is_visible().unwrap_or(false),
        window.is_minimized().unwrap_or(true),
    ) {
        return Err("窗口隐藏，图表刷新已暂停".into());
    }
    request_chart(&client, &market, &code, &mode).await
}
pub(crate) async fn request_chart(
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
            "https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param={symbol},day,,,400,qfq"
        ),
        "daily-raw" => {
            format!("https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param={symbol},day,,,400,")
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
pub(crate) fn analysis_history_url(market: &str, code: &str, year: i32) -> Result<String, String> {
    use chrono::Datelike;
    let current_year = (chrono::Utc::now() + chrono::Duration::hours(8)).year();
    if (!super::valid_symbol(market, code) && !(market == "sh" && code == "000001"))
        || !(1990..=current_year).contains(&year)
    {
        return Err("历史行情证券或年份无效".into());
    }
    Ok(format!("https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param={market}{code},day,{}-12-01,{year}-12-31,400,", year - 1))
}
pub(crate) fn parse_analysis_history(
    value: Value,
    symbol: &str,
    year: i32,
) -> Result<Value, String> {
    let source = &value["data"][symbol];
    if source.get("qfqday").is_some() || source.get("hfqday").is_some() {
        return Err("历史分析需要不复权行情".into());
    }
    let mut result = parse_chart(value, symbol, "daily-raw")?;
    let bars = result["bars"].as_array_mut().ok_or("历史行情缺失")?;
    if bars.is_empty() || bars.len() > 400 {
        return Err("历史行情为空或条数超限".into());
    }
    let start = format!("{}-12-01", year - 1);
    let end = format!("{year}-12-31");
    let mut seen = std::collections::HashSet::new();
    for bar in bars.iter() {
        let date = bar["date"].as_str().ok_or("历史行情日期缺失")?;
        if date < start.as_str() || date > end.as_str() || !seen.insert(date.to_owned()) {
            return Err("历史行情日期超出请求范围或重复".into());
        }
        let n = |key: &str| bar[key].as_str().unwrap().parse::<f64>().unwrap();
        if n("open") < n("low")
            || n("open") > n("high")
            || n("close") < n("low")
            || n("close") > n("high")
        {
            return Err("历史行情价格超出高低范围".into());
        }
    }
    bars.sort_by(|a, b| a["date"].as_str().cmp(&b["date"].as_str()));
    Ok(result)
}
fn eastmoney_history_url(market: &str, code: &str, year: i32) -> Result<String, String> {
    // Reuse the same narrow symbol/year validation as the primary source.
    analysis_history_url(market, code, year)?;
    let exchange = if market == "sh" { 1 } else { 0 };
    Ok(format!("https://push2his.eastmoney.com/api/qt/stock/kline/get?secid={exchange}.{code}&klt=101&fqt=0&beg={}1201&end={year}1231&lmt=400&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56", year - 1))
}
fn parse_eastmoney_history(value: Value, symbol: &str, year: i32) -> Result<Value, String> {
    let data = &value["data"];
    let exchange = if symbol.starts_with("sh") { 1 } else { 0 };
    if value["rc"].as_i64() != Some(0)
        || data["code"].as_str() != symbol.get(2..)
        || data["market"].as_i64() != Some(exchange)
    {
        return Err("备用历史行情证券不匹配或暂无数据".into());
    }
    let lines = data["klines"].as_array().ok_or("备用历史行情日线缺失")?;
    if lines.is_empty() || lines.len() > 400 {
        return Err("备用历史行情为空或条数超限".into());
    }
    let mut rows = Vec::new();
    for line in lines {
        let fields: Vec<&str> = line
            .as_str()
            .ok_or("备用历史行情格式异常")?
            .split(',')
            .collect();
        if fields.len() != 6 {
            return Err("备用历史行情字段缺失".into());
        }
        rows.push(json!(fields));
    }
    // The request explicitly uses fqt=0. Normalize raw OHLCV and apply the same
    // strict identity, date, bounds and price validation as the primary source.
    parse_analysis_history(json!({"code":0,"data":{symbol:{"day":rows}}}), symbol, year)
}
fn sina_history_url(market: &str, code: &str, year: i32) -> Result<String, String> {
    analysis_history_url(market, code, year)?;
    // This endpoint serves raw daily OHLCV, capped at 1023 sessions.
    Ok(format!("https://quotes.sina.cn/cn/api/json_v2.php/CN_MarketDataService.getKLineData?symbol={market}{code}&scale=240&ma=no&datalen=1023"))
}
fn parse_sina_history(value: Value, symbol: &str, year: i32) -> Result<Value, String> {
    let rows = value.as_array().ok_or("新浪历史日线缺失")?;
    if rows.is_empty() || rows.len() > 1023 {
        return Err("新浪历史日线为空或条数超限".into());
    }
    let start = format!("{}-12-01", year - 1);
    let end = format!("{year}-12-31");
    let mut normalized = Vec::new();
    let mut earliest = "9999-12-31";
    for row in rows {
        let date = row["day"].as_str().ok_or("新浪日线日期缺失")?;
        if date.len() != 10 || chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d").is_err() {
            return Err("新浪日线日期无效".into());
        }
        earliest = earliest.min(date);
        if date < start.as_str() || date > end.as_str() {
            continue;
        }
        // Sina reports shares; ChartData uses lots of 100 shares.
        let volume = required(&row["volume"])?;
        let lots = volume.parse::<f64>().map_err(|_| "新浪成交量无效")? / 100.0;
        normalized.push(json!([
            date,
            row["open"],
            row["close"],
            row["high"],
            row["low"],
            lots.to_string()
        ]));
    }
    if rows.len() == 1023 && earliest > start.as_str() {
        return Err("新浪日线覆盖范围不足，不能作为完整年度行情".into());
    }
    parse_analysis_history(
        json!({"code":0,"data":{symbol:{"day":normalized}}}),
        symbol,
        year,
    )
}
async fn history_json(client: &reqwest::Client, url: &str) -> Result<Value, String> {
    let mut response = client
        .get(url)
        .send()
        .await
        .map_err(|_| "历史行情请求超时或网络不可用")?;
    if !response.status().is_success() {
        return Err(format!(
            "历史行情服务返回 HTTP {}",
            response.status().as_u16()
        ));
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| "读取历史行情失败")? {
        if bytes.len() + chunk.len() > 2 * 1024 * 1024 {
            return Err("历史行情响应过大".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    serde_json::from_slice(&bytes).map_err(|_| "历史行情响应不是 JSON（可能被服务端拦截）".into())
}
async fn request_analysis_history(
    client: &reqwest::Client,
    market: &str,
    code: &str,
    year: i32,
) -> Result<Value, String> {
    let primary = analysis_history_url(market, code, year)?;
    let backup = eastmoney_history_url(market, code, year)?;
    let symbol = format!("{market}{code}");
    let primary_result = match history_json(client, &primary).await {
        Ok(value) => parse_analysis_history(value, &symbol, year),
        Err(error) => Err(error),
    };
    match primary_result {
        Ok(data) => Ok(data),
        Err(primary_error) => {
            let fallback = match history_json(client, &backup).await {
                Ok(value) => parse_eastmoney_history(value, &symbol, year),
                Err(error) => Err(error),
            };
            match fallback {
                Ok(data) => Ok(data),
                Err(backup_error) => {
                    let url = sina_history_url(market, code, year)?;
                    let result = match history_json(client, &url).await {
                        Ok(value) => parse_sina_history(value, &symbol, year),
                        Err(error) => Err(error),
                    };
                    result.map_err(|error| {
                        format!("腾讯：{primary_error}；东方财富：{backup_error}；新浪：{error}")
                    })
                }
            }
        }
    }
}
#[tauri::command]
pub async fn fetch_analysis_history(
    client: tauri::State<'_, reqwest::Client>,
    window: tauri::WebviewWindow,
    market: String,
    code: String,
    year: i32,
) -> Result<Value, String> {
    if !window.is_visible().unwrap_or(false) || window.is_minimized().unwrap_or(true) {
        return Err("窗口隐藏，历史行情刷新已暂停".into());
    }
    request_analysis_history(&client, &market, &code, year).await
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn empty_primary_history_is_an_error_so_fallback_runs() {
        assert!(parse_analysis_history(
            json!({"code":0,"data":{"sh510300":{"day":[]}}}),
            "sh510300",
            2025
        )
        .is_err());
    }
    #[test]
    fn sina_history_filters_year_and_normalizes_unadjusted_bars() {
        let data = json!([
            {"day":"2026-01-05","open":"12","close":"12","high":"12","low":"12","volume":"100"},
            {"day":"2025-01-03","open":"10","close":"11","high":"12","low":"9","volume":"12300"},
            {"day":"2024-12-02","open":"10","close":"10","high":"12","low":"9","volume":"100"},
            {"day":"2024-11-29","open":"10","close":"10","high":"12","low":"9","volume":"100"}
        ]);
        let result = parse_sina_history(data, "sh510300", 2025).unwrap();
        assert_eq!(result["bars"].as_array().unwrap().len(), 2);
        assert_eq!(result["bars"][0]["date"], "2024-12-02");
        assert_eq!(result["bars"][1]["close"], "11");
        assert_eq!(result["bars"][1]["volume"], "123");
        assert_eq!(result["adjustment"], "不复权");
        assert!(parse_sina_history(json!(null), "sh510300", 2025).is_err());
        assert!(parse_sina_history(json!([]), "sh510300", 2025).is_err());
        let truncated = json!(vec![
            json!({"day":"2025-06-01","open":"10","close":"10","high":"10","low":"10","volume":"100"});
            1023
        ]);
        assert!(parse_sina_history(truncated, "sh510300", 2025)
            .unwrap_err()
            .contains("覆盖"));
        assert!(parse_sina_history(json!([{"day":"2025-01-03","open":"10","close":"99","high":"12","low":"9","volume":"100"}]), "sh510300", 2025).is_err());
    }
    #[test]
    fn fallback_annual_parser_checks_identity_range_and_raw_prices() {
        let data = json!({"rc":0,"data":{"code":"510300","market":1,"klines":["2026-09-07,4.635,4.634,4.649,4.612,9930783","2025-12-01,4.646,4.687,4.688,4.639,5783014"]}});
        let result = parse_eastmoney_history(data.clone(), "sh510300", 2026).unwrap();
        assert_eq!(result["bars"][0]["date"], "2025-12-01");
        assert_eq!(result["bars"][1]["close"], "4.634");
        assert_eq!(result["adjustment"], "不复权");
        assert!(parse_eastmoney_history(data.clone(), "sz510300", 2026).is_err());
        assert!(parse_eastmoney_history(data.clone(), "sh600519", 2026).is_err());
        assert!(parse_eastmoney_history(data, "sh510300", 2025).is_err());
        assert!(parse_eastmoney_history(json!({"rc":0,"data":null}), "sh510300", 2026).is_err());
        assert!(parse_eastmoney_history(
            json!({"rc":0,"data":{"code":"510300","market":1,"klines":["2026-09-07,4,9,5,3,100"]}}),
            "sh510300",
            2026
        )
        .is_err());
    }
    #[test]
    fn fallback_url_requests_unadjusted_bounded_history() {
        let url = eastmoney_history_url("sh", "510300", 2026).unwrap();
        assert!(url.contains("secid=1.510300"));
        assert!(url.contains("fqt=0"));
        assert!(url.contains("beg=20251201&end=20261231"));
        assert!(eastmoney_history_url("xx", "510300", 2026).is_err());
    }
    #[test]
    fn annual_request_is_bounded_and_unadjusted() {
        let url = analysis_history_url("sh", "000001", 2025).unwrap();
        assert!(url.ends_with("param=sh000001,day,2024-12-01,2025-12-31,400,"));
        assert!(!url.contains("qfq"));
        assert!(analysis_history_url("sh", "000001", 1980).is_err());
    }
    #[test]
    fn annual_parser_rejects_adjusted_and_outside_range_and_sorts() {
        let data = json!({"code":0,"data":{"sh000001":{"day":[["2025-01-03","10","11","12","9","100"],["2024-12-31","10","10","12","9","100"]]}}});
        let result = parse_analysis_history(data, "sh000001", 2025).unwrap();
        assert_eq!(result["bars"][0]["date"], "2024-12-31");
        assert_eq!(result["adjustment"], "不复权");
        assert!(parse_analysis_history(
            json!({"code":0,"data":{"sh000001":{"qfqday":[]}}}),
            "sh000001",
            2025
        )
        .is_err());
        assert!(parse_analysis_history(
            json!({"code":0,"data":{"sh000001":{"day":[["2023-12-31","10","11","12","9","100"]]}}}),
            "sh000001",
            2025
        )
        .is_err());
    }
    #[test]
    #[ignore = "manual public-network annual history smoke test"]
    fn live_analysis_history() {
        tauri::async_runtime::block_on(async {
            let client = reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(8))
                .redirect(reqwest::redirect::Policy::none())
                .user_agent("TCalculator/0.4 (personal ledger)")
                .build()
                .unwrap();
            for (market, code, year) in [
                ("sh", "510300", 2026),
                ("sz", "159915", 2025),
                ("sh", "000001", 2026),
            ] {
                let result = request_analysis_history(&client, market, code, year)
                    .await
                    .unwrap();
                let bars = result["bars"].as_array().unwrap();
                assert!(!bars.is_empty());
                assert_eq!(result["adjustment"], "不复权");
                println!(
                    "{market}{code} {year}: {} raw bars, {} to {}",
                    bars.len(),
                    bars[0]["date"],
                    bars.last().unwrap()["date"]
                );
            }
        });
    }
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
