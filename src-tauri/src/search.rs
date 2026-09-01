use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    market: String,
    code: String,
    name: String,
    asset: String,
    initials: String,
}

fn valid_query(query: &str) -> bool {
    !query.is_empty()
        && query.chars().count() <= 64
        && query.chars().all(|c| {
            c.is_ascii_alphanumeric()
                || matches!(c, '*' | '.' | '_' | '-')
                || ('\u{3400}'..='\u{9fff}').contains(&c)
        })
}

fn parse_search(bytes: &[u8]) -> Result<Vec<SearchHit>, String> {
    let (text, _, malformed) = encoding_rs::GBK.decode(bytes);
    if malformed {
        return Err("证券搜索文字编码异常".into());
    }
    // The endpoint returns a JS assignment, not executable code. Decode only
    // its JSON string literal (including escaped Chinese); reject any suffix.
    let literal = text
        .trim()
        .trim_end_matches(';')
        .trim()
        .strip_prefix("v_hint=")
        .ok_or("证券搜索接口格式变化")?;
    let payload: String = serde_json::from_str(literal).map_err(|_| "证券搜索接口内容异常")?;
    if payload == "N" || payload.is_empty() {
        return Ok(vec![]);
    }
    let mut hits = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for row in payload.split('^') {
        let fields: Vec<_> = row.split('~').collect();
        if fields.len() < 5 {
            return Err("证券搜索字段缺失".into());
        }
        let market = fields[0];
        let code = fields[1];
        if !super::valid_symbol(market, code) {
            continue;
        }
        let asset = match fields[4] {
            "GP-A" => "stock",
            "ETF" => "etf",
            _ => continue,
        };
        let name = fields[2].trim();
        if name.is_empty() || name.chars().count() > 60 || name.chars().any(char::is_control) {
            return Err("证券搜索名称异常".into());
        }
        if !seen.insert(format!("{market}{code}")) {
            continue;
        }
        hits.push(SearchHit {
            market: market.into(),
            code: code.into(),
            name: name.into(),
            asset: asset.into(),
            initials: fields[3].into(),
        });
        if hits.len() == 20 {
            break;
        }
    }
    Ok(hits)
}

async fn request_search(client: &reqwest::Client, query: &str) -> Result<Vec<SearchHit>, String> {
    if !valid_query(query) {
        return Err("请输入1～64位名称、拼音或代码".into());
    }
    let mut response = client
        .get("https://smartbox.gtimg.cn/s3/")
        .query(&[("q", query), ("t", "all")])
        .send()
        .await
        .map_err(|_| "证券搜索连接失败或超时")?
        .error_for_status()
        .map_err(|_| "证券搜索服务暂不可用")?;
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| "证券搜索响应读取失败")? {
        if bytes.len() + chunk.len() > 65_536 {
            return Err("证券搜索响应超出限制".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    parse_search(&bytes)
}

#[tauri::command]
pub async fn search_securities(
    client: tauri::State<'_, reqwest::Client>,
    query: String,
) -> Result<Vec<SearchHit>, String> {
    request_search(&client, &query).await
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn chinese_escapes_etfs_and_supported_markets() {
        let hits = parse_search(br#"v_hint="sh~600519~\u8d35\u5dde\u8305\u53f0~gzmt~GP-A^sz~159915~ETF~cybetf~ETF^hk~02318~PA~zgpa~GP^sh~688001~KC~kc~GP-A^jj~005103~Fund~f~KJ^sz~000001~Index~i~ZS";"#).unwrap();
        assert_eq!(hits.len(), 2);
        assert_eq!(hits[0].name, "贵州茅台");
        assert_eq!(hits[1].asset, "etf");
    }
    #[test]
    fn gbk_empty_duplicate_and_changed_fields() {
        let (bytes, _, _) = encoding_rs::GBK.encode(
            "v_hint=\"sh~510300~沪深300ETF~hs300etf~ETF^sh~510300~沪深300ETF~hs300etf~ETF\"",
        );
        assert_eq!(parse_search(&bytes).unwrap().len(), 1);
        assert!(parse_search(b"v_hint=\"N\";").unwrap().is_empty());
        assert!(parse_search(b"v_hint=\"\"").unwrap().is_empty());
        assert!(parse_search(b"v_hint=\"sh~600519\"").is_err());
        assert!(parse_search(b"v_hint=\"N\";alert(1)").is_err());
        assert!(parse_search(b"v_other=\"N\"").is_err());
    }
    #[test]
    fn query_is_text_not_an_arbitrary_url() {
        for q in ["贵州茅", "guizhoumaotai", "gzmt", "5103", "maotai"] {
            assert!(valid_query(q));
        }
        for q in ["", "https://example.com", "gzmt&t=hk", "a\nb"] {
            assert!(!valid_query(q));
        }
        assert!(!valid_query(&"a".repeat(65)));
    }
    #[test]
    #[ignore = "manual verification against the public search endpoint"]
    fn live_security_search() {
        tauri::async_runtime::block_on(async {
            let client = reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(8))
                .redirect(reqwest::redirect::Policy::none())
                .build()
                .unwrap();
            for query in ["贵州茅", "guizhoumaotai", "gzmt", "maotai", "600519"] {
                let hits = request_search(&client, query).await.unwrap();
                assert!(
                    hits.iter()
                        .any(|h| h.code == "600519" && h.name == "贵州茅台"),
                    "{query}"
                );
            }
            assert!(request_search(&client, "5103")
                .await
                .unwrap()
                .iter()
                .any(|h| h.code == "510300" && h.asset == "etf"));
        });
    }
}
