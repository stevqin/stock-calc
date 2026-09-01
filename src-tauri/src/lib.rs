use serde::{Deserialize, Serialize};
use std::time::Duration;
mod charts;
mod fund_flows;
mod search;
mod storage;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Quote {
    market: String,
    code: String,
    name: String,
    latest: String,
    bid: Option<String>,
    ask: Option<String>,
    quote_time: String,
    fetched_at: String,
    kind: String,
    previous_close: Option<String>,
    open: Option<String>,
    high: Option<String>,
    low: Option<String>,
    change: Option<String>,
    volume_ratio: Option<String>,
    turnover: Option<String>,
    amplitude: Option<String>,
    pe_ratio: Option<String>,
    pb_ratio: Option<String>,
    float_cap: Option<String>,
    volume: Option<String>,
    source: String,
}
fn metric(fields: &[&str], i: usize, signed: bool) -> Option<String> {
    let s = fields.get(i)?.trim();
    if s.is_empty()
        || !s
            .bytes()
            .all(|c| c.is_ascii_digit() || c == b'.' || (signed && c == b'-'))
    {
        return None;
    }
    let n = s.parse::<f64>().ok()?;
    (n.is_finite() && (signed || n >= 0.0)).then(|| s.to_string())
}

fn valid_symbol(market: &str, code: &str) -> bool {
    if code.len() != 6 || !code.bytes().all(|b| b.is_ascii_digit()) {
        return false;
    }
    let prefixes: &[&str] = match market {
        "sh" => &["600", "601", "603", "605", "51", "52", "56", "58"],
        "sz" => &["000", "001", "002", "003", "300", "301", "159"],
        _ => return false,
    };
    prefixes.iter().any(|prefix| code.starts_with(prefix))
}

fn positive_price(value: &str) -> Option<String> {
    // Keep decimal wire values as strings; floating point is used only for input bounds.
    if value.is_empty() || !value.bytes().all(|b| b.is_ascii_digit() || b == b'.') {
        return None;
    }
    let price = value.parse::<f64>().ok()?;
    if price.is_finite() && price > 0.0 && price <= 1_000_000.0 {
        Some(value.to_owned())
    } else {
        None
    }
}

fn parse_quote(bytes: &[u8], market: &str, code: &str) -> Result<Quote, String> {
    let (decoded, _, malformed) = encoding_rs::GBK.decode(bytes);
    if malformed {
        return Err("行情文字编码异常".into());
    }
    let expected = format!("v_{}{}=\"", market, code);
    let payload = decoded
        .trim()
        .strip_prefix(&expected)
        .and_then(|s| s.strip_suffix("\";"))
        .ok_or("接口格式变化或证券代码不存在")?;
    let fields: Vec<&str> = payload.split('~').collect();
    if fields.len() < 46 || fields[2] != code || fields[1].trim().is_empty() {
        return Err("行情字段缺失或代码不匹配".into());
    }
    let latest = positive_price(fields[3]).ok_or("暂无有效成交价")?;
    let time = fields[30];
    if time.len() != 14
        || !time.bytes().all(|b| b.is_ascii_digit())
        || chrono::NaiveDateTime::parse_from_str(time, "%Y%m%d%H%M%S").is_err()
    {
        return Err("行情时间格式异常".into());
    }
    let kind = match fields.get(61).copied() {
        Some("ETF") => "etf",
        Some("GP-A") => "stock",
        _ => "unknown",
    };
    Ok(Quote {
        market: market.into(),
        code: code.into(),
        name: fields[1].into(),
        latest,
        bid: positive_price(fields[9]),
        ask: positive_price(fields[19]),
        quote_time: time.into(),
        fetched_at: chrono::Utc::now().to_rfc3339(),
        kind: kind.into(),
        previous_close: positive_price(fields[4]),
        open: positive_price(fields[5]),
        high: positive_price(fields[33]),
        low: positive_price(fields[34]),
        change: metric(&fields, 32, true),
        volume_ratio: metric(&fields, 49, false),
        turnover: metric(&fields, 38, false),
        amplitude: metric(&fields, 43, false),
        pe_ratio: (kind == "stock")
            .then(|| metric(&fields, 39, true))
            .flatten(),
        pb_ratio: (kind == "stock")
            .then(|| metric(&fields, 46, true))
            .flatten(),
        float_cap: metric(&fields, 44, false),
        volume: metric(&fields, 6, false),
        source: "腾讯公开行情".into(),
    })
}

#[derive(Deserialize)]
pub struct Symbol {
    market: String,
    code: String,
}
#[derive(Serialize)]
pub struct QuoteBatch {
    quotes: Vec<Quote>,
    errors: std::collections::BTreeMap<String, String>,
}
fn parse_batch(bytes: &[u8], symbols: &[Symbol]) -> QuoteBatch {
    let (text, _, malformed) = encoding_rs::GBK.decode(bytes);
    let mut out = QuoteBatch {
        quotes: vec![],
        errors: std::collections::BTreeMap::new(),
    };
    for s in symbols {
        let id = format!("{}{}", s.market, s.code);
        let prefix = format!("v_{id}=\"");
        let result = if malformed {
            Err("行情文字编码异常".into())
        } else {
            text.lines()
                .find(|l| l.trim().starts_with(&prefix))
                .ok_or_else(|| "该证券报价缺失".to_string())
                .and_then(|l| {
                    let (encoded, _, _) = encoding_rs::GBK.encode(l.trim());
                    parse_quote(&encoded, &s.market, &s.code)
                })
        };
        match result {
            Ok(q) => out.quotes.push(q),
            Err(e) => {
                out.errors.insert(id, e);
            }
        }
    }
    out
}
#[tauri::command]
async fn fetch_quotes(
    client: tauri::State<'_, reqwest::Client>,
    window: tauri::WebviewWindow,
    symbols: Vec<Symbol>,
) -> Result<QuoteBatch, String> {
    if symbols.is_empty()
        || symbols.len() > 50
        || symbols.iter().any(|s| !valid_symbol(&s.market, &s.code))
    {
        return Err("一次只允许1至50只范围内证券".into());
    }
    if !window.is_visible().unwrap_or(false) || window.is_minimized().unwrap_or(true) {
        return Err("窗口隐藏，行情已暂停".into());
    }
    let joined = symbols
        .iter()
        .map(|s| format!("{}{}", s.market, s.code))
        .collect::<Vec<_>>()
        .join(",");
    let mut response = client
        .get(format!("https://qt.gtimg.cn/q={joined}"))
        .send()
        .await
        .map_err(|_| "批量行情连接失败")?
        .error_for_status()
        .map_err(|_| "批量行情不可用")?;
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| "行情读取失败")? {
        if bytes.len() + chunk.len() > 2 * 1024 * 1024 {
            return Err("行情响应过大".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(parse_batch(&bytes, &symbols))
}

#[tauri::command]
async fn fetch_quote(
    client: tauri::State<'_, reqwest::Client>,
    window: tauri::WebviewWindow,
    market: String,
    code: String,
) -> Result<Quote, String> {
    if !valid_symbol(&market, &code) {
        return Err("仅支持范围内的沪深股票及ETF六位代码".into());
    }
    // Also gate network access natively: WKWebView visibility events can lag minimize/hide.
    if !window.is_visible().unwrap_or(false) || window.is_minimized().unwrap_or(true) {
        return Err("窗口隐藏，行情已暂停".into());
    }
    // Fixed host + validated digits; never accept arbitrary URLs or follow redirects.
    let url = format!("https://qt.gtimg.cn/q={}{}", market, code);
    let mut response = client
        .get(url)
        .send()
        .await
        .map_err(|e| {
            if e.is_timeout() {
                "请求超时"
            } else {
                "网络连接失败"
            }
        })?
        .error_for_status()
        .map_err(|_| "行情服务暂不可用")?;
    let mut data = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| "行情响应读取失败")? {
        if data.len() + chunk.len() > 65536 {
            return Err("行情响应过大".into());
        }
        data.extend_from_slice(&chunk);
    }
    parse_quote(&data, &market, &code)
}

pub fn run() {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(8))
        .connect_timeout(Duration::from_secs(5))
        .redirect(reqwest::redirect::Policy::none())
        .user_agent("TCalculator/0.4 (personal ledger)")
        .build()
        .expect("HTTP client");
    tauri::Builder::default()
        .manage(client)
        .setup(storage::initialize)
        .invoke_handler(tauri::generate_handler![
            fetch_quote,
            fetch_quotes,
            fund_flows::fetch_fund_flows,
            search::search_securities,
            charts::fetch_chart,
            storage::load_account,
            storage::save_account,
            storage::export_account,
            storage::read_backup,
            storage::list_recovery,
            storage::read_recovery,
            storage::load_market_cache,
            storage::write_market_cache,
            storage::clear_market_cache,
            storage::load_drafts,
            storage::save_drafts
        ])
        .run(tauri::generate_context!())
        .expect("desktop runtime");
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture(code: &str, name: &str, latest: &str, kind: &str) -> Vec<u8> {
        let mut fields = vec![""; 63];
        fields[1] = name;
        fields[2] = code;
        fields[3] = latest;
        fields[9] = "0";
        fields[19] = latest;
        fields[30] = "20260831100632";
        fields[39] = "19.97";
        fields[46] = "6.47";
        fields[61] = kind;
        let text = format!("v_sh{}=\"{}\";", code, fields.join("~"));
        let (bytes, _, _) = encoding_rs::GBK.encode(&text);
        bytes.into_owned()
    }
    #[test]
    fn stock_and_etf_gbk_quotes() {
        for (code, name, price, kind) in [
            ("600519", "贵州茅台", "1286.98", "GP-A"),
            ("510300", "沪深300ETF", "4.644", "ETF"),
            ("513100", "纳指ETF", "1.234", "ETF"),
            ("518880", "黄金ETF", "7.123", "ETF"),
            ("511010", "国债ETF", "120.123", "ETF"),
        ] {
            let q = parse_quote(&fixture(code, name, price, kind), "sh", code).unwrap();
            assert_eq!(q.name, name);
            assert_eq!(q.latest, price);
            assert!(q.bid.is_none());
            assert_eq!(q.ask.unwrap(), price);
            assert_eq!(q.kind, if kind == "ETF" { "etf" } else { "stock" });
            assert_eq!(q.pe_ratio.as_deref(), (kind == "GP-A").then_some("19.97"));
            assert_eq!(q.pb_ratio.as_deref(), (kind == "GP-A").then_some("6.47"));
        }
    }
    #[test]
    fn rejects_invalid_or_changed_response() {
        assert!(parse_quote(b"v_pv_none_match=\"1\";", "sh", "600519").is_err());
        assert!(parse_quote(&fixture("600519", "股票", "0", "GP-A"), "sh", "600519").is_err());
        assert!(parse_quote(&fixture("600519", "股票", "10", "GP-A"), "sh", "600000").is_err());
        assert!(parse_quote(b"<html>error</html>", "sh", "600519").is_err());
        assert!(parse_quote(b"v_sh600519=\"\xff\";", "sh", "600519").is_err());
    }
    #[test]
    fn symbol_allowlist() {
        for (market, code) in [
            ("sh", "600519"),
            ("sz", "000001"),
            ("sz", "300750"),
            ("sh", "510300"),
            ("sz", "159915"),
        ] {
            assert!(valid_symbol(market, code));
        }
        for (market, code) in [
            ("sh", "688001"),
            ("bj", "830001"),
            ("sh", "113001"),
            ("https://evil", "600519"),
            ("sh", "600519&x=1"),
            ("sh", "１２３４５６"),
        ] {
            assert!(!valid_symbol(market, code));
        }
    }
    #[test]
    #[ignore = "manual public-network smoke test"]
    fn live_quotes() {
        tauri::async_runtime::block_on(async {
            let client = reqwest::Client::builder()
                .timeout(Duration::from_secs(10))
                .build()
                .unwrap();
            for (market, code) in [
                ("sh", "600519"),
                ("sz", "000001"),
                ("sh", "510300"),
                ("sh", "513100"),
                ("sh", "518880"),
                ("sh", "511010"),
            ] {
                let bytes = client
                    .get(format!("https://qt.gtimg.cn/q={}{}", market, code))
                    .send()
                    .await
                    .unwrap()
                    .bytes()
                    .await
                    .unwrap();
                let quote = parse_quote(&bytes, market, code).unwrap();
                assert_ne!(quote.kind, "unknown");
                println!(
                    "{} {} {} {}",
                    quote.code, quote.name, quote.latest, quote.quote_time
                );
            }
        });
    }
}
