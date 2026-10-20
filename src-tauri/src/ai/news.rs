#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Value};
    fn cutoff() -> chrono::DateTime<chrono::Utc> {
        "2026-10-19T04:00:00Z".parse().unwrap()
    }
    fn security() -> super::super::types::SecurityRef {
        super::super::types::SecurityRef {
            id: "sh600519".into(),
            market: "sh".into(),
            code: "600519".into(),
            name: "贵州茅台".into(),
            asset: super::super::types::Asset::Stock,
        }
    }
    fn row() -> Value {
        json!({"title":"贵州茅台动态","content":"<b>600519</b> 发布业绩 &amp; 经营信息","date":"2026-10-18 12:00:00","mediaName":"公开媒体","code":"202610183123456789"})
    }
    fn parse(rows: Vec<Value>) -> Vec<NewsArticle> {
        parse_articles(
            &format!("tkeNews({});", json!({"result":{"cmsArticleWebOld":rows}})),
            &security(),
            cutoff(),
        )
        .unwrap()
    }
    #[tokio::test]
    #[ignore = "explicit public news source smoke; no account data, keys or model requests"]
    async fn public_news_smoke() {
        let rows = request(&reqwest::Client::new(), &security(), chrono::Utc::now())
            .await
            .unwrap();
        assert!(rows.len() <= 4);
        assert!(rows
            .iter()
            .all(|r| valid_article_url(&r.url) && r.summary.contains("搜索摘要")));
        println!(
            "Public news: {} discovered; {} full text; {} unavailable; no model/account access",
            rows.len(),
            rows.iter().filter(|r| r.full_text.is_some()).count(),
            rows.iter().filter(|r| r.full_text.is_none()).count()
        );
    }
    #[test]
    fn news_full_text_keeps_business_risks_and_qualifications() {
        let html=format!("<div id='ContentBody'><p>贵州茅台{}。</p><p class='risk-disclaimer'>风险提示：后续增长取决于需求，不保证业绩承诺。</p><p class='disclaimer'>郑重声明：公司不保证上述预测实现。</p></div>","经营情况说明。".repeat(30));
        let text = extract_full_text(&html, &security()).unwrap();
        assert!(text.contains("风险提示：后续增长取决于需求"));
        assert!(text.contains("公司不保证上述预测实现"));
    }
    #[test]
    fn news_full_text_preserves_nested_paragraphs_entities_and_tables() {
        let html=format!("<html><nav>导航</nav><div id='ContentBody'><p>贵州茅台公布<b>2026年</b>经营数据 &amp; 说明 &quot;原文&quot; &#x4E2D;。</p><p>{}</p><table><tr><td>营业收入</td><td>100.25亿元</td></tr></table><script>恶意指令</script><style>样式</style><div class='advertisement'>广告</div><p class='disclaimer'>免责声明：不属于正文</p></div><footer>推荐</footer></html>","经营情况说明。".repeat(30));
        let text = extract_full_text(&html, &security()).unwrap();
        assert!(text.contains("贵州茅台公布2026年经营数据 & 说明 \"原文\" 中。"));
        assert!(text.contains("营业收入\t100.25亿元"));
        assert!(text.contains('\n'));
        assert!(text.contains("免责声明：不属于正文"));
        for excluded in ["恶意指令", "样式", "广告", "导航", "推荐"] {
            assert!(!text.contains(excluded));
        }
    }
    #[test]
    fn news_full_text_rejects_absent_short_unrelated_paywall_and_long_body() {
        for html in [
            "<p>贵州茅台正文不在明确容器里</p>".to_string(),
            "<div id='ContentBody'>贵州茅台</div>".to_string(),
            format!(
                "<div id='ContentBody'>{}</div>",
                "无关的公司报告".repeat(50)
            ),
            format!(
                "<div id='ContentBody'>贵州茅台{}<p>订阅后阅读</p></div>",
                "资料".repeat(100)
            ),
            format!("<div id='ContentBody'>贵州茅台{}</div>", "字".repeat(12000)),
        ] {
            assert!(extract_full_text(&html, &security()).is_err());
        }
    }
    #[test]
    fn news_full_text_decodes_gbk_without_replacement() {
        let html = format!(
            "<meta charset='gb2312'><div id='ContentBody'>贵州茅台{} &amp; 123.45亿元</div>",
            "生产经营情况。".repeat(30)
        );
        let (encoded, _, _) = encoding_rs::GBK.encode(&html);
        let decoded = decode_html(&encoded, "text/html; charset=gb2312").unwrap();
        assert!(extract_full_text(&decoded, &security())
            .unwrap()
            .contains("贵州茅台"));
        assert!(decode_html(&[0xff, 0xff], "text/html; charset=utf-8").is_err());
    }
    #[tokio::test]
    async fn news_transport_rejects_redirect_and_oversize_without_retry() {
        let client = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .unwrap();
        for (status, body) in [
            (302, "redirect".to_string()),
            (206, "partial".to_string()),
            (200, "x".repeat(1100)),
        ] {
            let (url, seen, handle) = super::super::test_server::serve(vec![(status, body)]).await;
            assert!(read_body(client.get(url), 1024).await.is_err());
            handle.await.unwrap();
            assert_eq!(seen.lock().unwrap().len(), 1);
        }
    }
    #[tokio::test]
    async fn news_transport_rejects_content_range_even_with_status_ok() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let server = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut b = [0; 2048];
            socket.read(&mut b).await.unwrap();
            socket.write_all(b"HTTP/1.1 200 OK\r\nContent-Range: bytes 0-3/100\r\nContent-Length: 4\r\nConnection: close\r\n\r\npart").await.unwrap();
        });
        let error = read_body(reqwest::Client::new().get(url), 1024)
            .await
            .unwrap_err();
        assert!(error.contains("仅返回部分内容"));
        server.await.unwrap();
    }
    #[tokio::test]
    async fn news_full_text_timeout_degrades_and_does_not_retry() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let server = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut b = [0; 2048];
            socket.read(&mut b).await.unwrap();
            socket
                .write_all(
                    b"HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: 999\r\n\r\n<p>",
                )
                .await
                .unwrap();
            tokio::time::sleep(std::time::Duration::from_millis(200)).await;
        });
        let result = fetch_full_text_request(
            reqwest::Client::new().get(url),
            &security(),
            tokio::time::Instant::now() + std::time::Duration::from_millis(50),
        )
        .await;
        assert!(result.unwrap_err().contains("超时"));
        server.abort();
    }
    #[tokio::test]
    async fn news_two_article_bodies_can_progress_concurrently() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let barrier = std::sync::Arc::new(tokio::sync::Barrier::new(2));
        let server = tokio::spawn(async move {
            let mut handles = Vec::new();
            for _ in 0..2 {
                let (mut socket, _) = listener.accept().await.unwrap();
                let barrier = barrier.clone();
                handles.push(tokio::spawn(async move {let mut b=[0;2048];socket.read(&mut b).await.unwrap();barrier.wait().await;let body=format!("<div id='ContentBody'>贵州茅台{}</div>","生产经营情况。".repeat(30));let response=format!("HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",body.len());socket.write_all(response.as_bytes()).await.unwrap();}));
            }
            for handle in handles {
                handle.await.unwrap();
            }
        });
        let client = reqwest::Client::new();
        let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(2);
        let security = security();
        let (a, b) = tokio::join!(
            fetch_full_text_request(client.get(&url), &security, deadline),
            fetch_full_text_request(client.get(&url), &security, deadline)
        );
        assert!(a.is_ok());
        assert!(b.is_ok());
        server.await.unwrap();
    }
    #[test]
    #[ignore = "manual extraction of already downloaded public article; no network"]
    fn news_saved_public_article_full_text() {
        let bytes = std::fs::read("/tmp/stock-calc-news-full-probe.html").unwrap();
        let html = decode_html(&bytes, "text/html; charset=utf-8").unwrap();
        let text = extract_full_text(&html, &security()).unwrap();
        println!(
            "Saved public article: fullText, {} characters, {} paragraphs",
            text.chars().count(),
            text.lines().count()
        );
        assert!(!text.contains("文章来源"));
    }
    #[test]
    fn news_rejects_bad_jsonp() {
        for text in [
            "other({})",
            "tkeNews({});evil()",
            "tkeNews(not json)",
            "tkeNews({})",
        ] {
            assert!(parse_articles(text, &security(), cutoff()).is_err());
        }
    }
    #[test]
    fn news_filters_dates_duplicates_and_unrelated() {
        let a = row();
        let mut old = row();
        old["date"] = json!("2026-10-01 12:00:00");
        let mut future = row();
        future["date"] = json!("2026-10-19 13:00:00");
        let mut unrelated = row();
        unrelated["title"] = json!("其他公司");
        unrelated["content"] = json!("16005190相关新闻");
        let mut missing = row();
        missing["date"] = json!("");
        assert_eq!(
            parse(vec![a.clone(), a, old, future, unrelated, missing]).len(),
            1
        );
    }
    #[test]
    fn news_requires_real_summary_and_media() {
        let mut title = row();
        title["content"] = title["title"].clone();
        let mut empty = row();
        empty["content"] = json!("<b></b>");
        let mut media = row();
        media["mediaName"] = json!("");
        assert!(parse(vec![title, empty, media]).is_empty());
    }
    #[test]
    fn news_cleans_html_and_labels_summary() {
        let a = parse(vec![row()]);
        assert!(a[0].summary.contains("搜索摘要"));
        assert!(a[0].summary.contains("600519 发布业绩 & 经营信息"));
        assert!(!a[0].summary.contains("<b>"));
        assert_eq!(a[0].published_at, "2026-10-18T04:00:00+00:00");
        assert!(a[0].relevance.contains("代码"));
    }
    #[test]
    fn news_rejects_untrusted_links() {
        for url in [
            "https://finance.eastmoney.com.evil/a/123.html",
            "https://user@finance.eastmoney.com/a/123.html",
            "https://finance.eastmoney.com:443/a/123.html",
            "https://finance.eastmoney.com/a/no.html",
            "https://finance.eastmoney.com/a/123.html?next=evil",
        ] {
            let mut r = row();
            r["url"] = json!(url);
            assert!(parse(vec![r]).is_empty(), "{url}");
        }
    }
    #[test]
    fn news_upgrades_only_exact_public_http_article_urls() {
        let mut r = row();
        r["url"] = json!("http://stock.eastmoney.com/a/123.html");
        let a = parse(vec![r]);
        assert_eq!(a.len(), 1);
        assert_eq!(a[0].url, "https://stock.eastmoney.com/a/123.html");
        for url in [
            "http://user@stock.eastmoney.com/a/123.html",
            "http://stock.eastmoney.com:80/a/123.html",
        ] {
            let mut r = row();
            r["url"] = json!(url);
            assert!(parse(vec![r]).is_empty());
        }
    }
    #[test]
    fn news_sorts_limits_and_truncates() {
        let rows = (1..=10)
            .map(|n| {
                let mut r = row();
                r["code"] = json!(format!("202610180000{n}"));
                r["date"] = json!(format!("2026-10-18 12:00:{n:02}"));
                r["title"] = json!(format!("贵州茅台{n}{}", "字".repeat(200)));
                r["content"] = json!(format!("600519{}", "字".repeat(800)));
                r
            })
            .collect();
        let a = parse(rows);
        assert_eq!(a.len(), 4);
        assert!(a[0].published_at > a[1].published_at);
        assert!(a[0].title.chars().count() <= 160);
        assert!(a[0].summary.chars().count() <= 400);
    }
}

use super::types::SecurityRef;
use chrono::{DateTime, Duration, FixedOffset, NaiveDateTime, TimeZone, Utc};
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::HashSet;

const MAX_BODY: usize = 512 * 1024;
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NewsArticle {
    pub title: String,
    pub summary: String,
    pub published_at: String,
    pub source: String,
    pub url: String,
    pub relevance: String,
    pub full_text: Option<String>,
    pub content_status: String,
}

/// Only public security identifiers are sent. Search excerpts are never represented as full articles.
pub async fn request(
    _client: &reqwest::Client,
    security: &SecurityRef,
    cutoff: DateTime<Utc>,
) -> Result<Vec<NewsArticle>, String> {
    let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(8);
    // Redirect policy is client-wide; do not inherit model gateway credentials or redirects.
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| "新闻采集客户端初始化失败".to_string())?;
    let keyword = format!("{} {}", security.code.trim(), security.name.trim());
    let param = json!({"uid":"", "keyword":keyword.trim(), "type":["cmsArticleWebOld"], "client":"web", "clientType":"web", "clientVersion":"curr", "param":{"cmsArticleWebOld":{"searchScope":"default","sort":"default","pageIndex":1,"pageSize":20,"preTag":"","postTag":""}}});
    let search_deadline =
        deadline.min(tokio::time::Instant::now() + std::time::Duration::from_secs(4));
    let search = client
        .get("https://search-api-web.eastmoney.com/search/jsonp")
        .header(reqwest::header::ACCEPT_ENCODING, "identity")
        .query(&[("cb", "tkeNews"), ("param", param.to_string().as_str())]);
    let (body, _) = tokio::time::timeout_at(search_deadline, read_body(search, MAX_BODY))
        .await
        .map_err(|_| "新闻搜索超时".to_string())??;
    let mut articles = parse_articles(
        std::str::from_utf8(&body).map_err(|_| "新闻响应格式无效".to_string())?,
        security,
        cutoff,
    )?;
    enrich_articles(&client, &mut articles, security, deadline).await;
    Ok(articles)
}

async fn read_body(
    request: reqwest::RequestBuilder,
    limit: usize,
) -> Result<(Vec<u8>, String), String> {
    let mut response = request
        .send()
        .await
        .map_err(|_| "新闻连接失败".to_string())?;
    if response.status().is_redirection() {
        return Err("来源要求跳转，未取得全文".into());
    }
    if response.status() == reqwest::StatusCode::PARTIAL_CONTENT
        || response
            .headers()
            .contains_key(reqwest::header::CONTENT_RANGE)
    {
        return Err("来源仅返回部分内容，未取得全文".into());
    }
    if !response.status().is_success() {
        return Err("来源拒绝访问或暂不可用".into());
    }
    if response.content_length().is_some_and(|n| n > limit as u64) {
        return Err("响应超过大小限制".into());
    }
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|s| s.to_str().ok())
        .unwrap_or("")
        .to_string();
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "新闻响应读取失败".to_string())?
    {
        if bytes.len().saturating_add(chunk.len()) > limit {
            return Err("响应超过大小限制".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok((bytes, content_type))
}
async fn enrich_articles(
    client: &reqwest::Client,
    articles: &mut [NewsArticle],
    security: &SecurityRef,
    deadline: tokio::time::Instant,
) {
    let first = articles.first().map(|a| a.url.as_str());
    let second = articles.get(1).map(|a| a.url.as_str());
    let (first, second) = tokio::join!(
        fetch_full_text(client, first, security, deadline),
        fetch_full_text(client, second, security, deadline)
    );
    let mut total = 0;
    for (article, result) in articles.iter_mut().take(2).zip([first, second]) {
        match result {
            Ok(text) if total + text.chars().count() <= 20000 => {
                total += text.chars().count();
                article.full_text = Some(text);
                article.content_status = "fullText".into();
            }
            Ok(_) => {
                article.content_status = "unavailable：全文合计超过20000字，未收录，未截断".into()
            }
            Err(reason) => article.content_status = format!("unavailable：{reason}"),
        }
    }
    for article in articles.iter_mut().skip(2) {
        article.content_status =
            "unavailable：为控制采集量，仅抓取前两篇原文；此条只有搜索线索".into();
    }
}
async fn fetch_full_text(
    client: &reqwest::Client,
    url: Option<&str>,
    security: &SecurityRef,
    deadline: tokio::time::Instant,
) -> Result<String, String> {
    let url = url.ok_or_else(|| "没有原文地址".to_string())?;
    if !valid_article_url(url) {
        return Err("原文地址不符合来源限制".into());
    }
    fetch_full_text_request(
        client
            .get(url)
            .header(reqwest::header::ACCEPT_ENCODING, "identity"),
        security,
        deadline,
    )
    .await
}
async fn fetch_full_text_request(
    request: reqwest::RequestBuilder,
    security: &SecurityRef,
    deadline: tokio::time::Instant,
) -> Result<String, String> {
    let deadline = deadline.min(tokio::time::Instant::now() + std::time::Duration::from_secs(4));
    tokio::time::timeout_at(deadline, async {
        let (bytes, content_type) = read_body(request, 1024 * 1024).await?;
        if !content_type.to_ascii_lowercase().starts_with("text/html")
            && !content_type
                .to_ascii_lowercase()
                .starts_with("application/xhtml+xml")
        {
            return Err("来源未返回HTML正文".into());
        }
        let html = decode_html(&bytes, &content_type)?;
        extract_full_text(&html, security)
    })
    .await
    .map_err(|_| "原文采集超时，未取得全文".to_string())?
}

fn decode_html(bytes: &[u8], content_type: &str) -> Result<String, String> {
    let head = String::from_utf8_lossy(&bytes[..bytes.len().min(4096)]).to_ascii_lowercase();
    let metadata = format!("{} {head}", content_type.to_ascii_lowercase());
    let encoding = if metadata.contains("charset=gb")
        || metadata.contains("charset=\"gb")
        || metadata.contains("charset='gb")
    {
        encoding_rs::GBK
    } else {
        encoding_rs::UTF_8
    };
    let (text, _, errors) = encoding.decode(bytes);
    if errors {
        return Err("原文编码无效，未取得完整正文".into());
    }
    Ok(text.into_owned())
}
fn extract_full_text(html: &str, security: &SecurityRef) -> Result<String, String> {
    let document = scraper::Html::parse_document(html);
    let selector = scraper::Selector::parse("#ContentBody").expect("fixed selector");
    let body = document
        .select(&selector)
        .next()
        .ok_or_else(|| "页面没有可确认的原文正文容器".to_string())?;
    let raw_text = body.text().collect::<String>();
    if [
        "付费阅读",
        "订阅后阅读",
        "登录后阅读全文",
        "开通会员后",
        "剩余内容需",
        "访问受限",
        "请完成验证",
        "验证码验证",
    ]
    .iter()
    .any(|phrase| raw_text.contains(phrase))
        || body
            .descendants()
            .filter_map(scraper::ElementRef::wrap)
            .any(|element| {
                element
                    .value()
                    .attr("class")
                    .is_some_and(|class| class.to_ascii_lowercase().contains("paywall"))
            })
    {
        return Err("正文受付费、登录或访问限制，未取得全文".into());
    }
    let mut text = String::new();
    collect_article_text(body, &mut text);
    let text = text
        .lines()
        .map(|line| {
            line.split('\t')
                .map(|cell| cell.split_whitespace().collect::<Vec<_>>().join(" "))
                .collect::<Vec<_>>()
                .join("\t")
                .trim_end_matches('\t')
                .to_string()
        })
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>()
        .join("\n");
    if [
        "付费阅读",
        "订阅后阅读",
        "登录后阅读全文",
        "开通会员后",
        "剩余内容需",
        "访问受限",
        "请完成验证",
        "验证码验证",
    ]
    .iter()
    .any(|phrase| text.contains(phrase))
    {
        return Err("正文受付费、登录或访问限制，未取得全文".into());
    }
    let length = text.chars().count();
    if length < 120 {
        return Err("正文过短或内容不完整，未确认取得全文".into());
    }
    if length > 12000 {
        return Err("原文超过12000字，未收录，未截断".into());
    }
    if !matches_code(&text, &security.code)
        && (security.name.trim().is_empty() || !text.contains(security.name.trim()))
    {
        return Err("原文未匹配证券代码或名称".into());
    }
    Ok(text)
}
fn collect_article_text(element: scraper::ElementRef<'_>, out: &mut String) {
    let node = element.value();
    let tag = node.name();
    if [
        "script", "style", "nav", "footer", "aside", "noscript", "iframe", "button", "form",
    ]
    .contains(&tag)
    {
        return;
    }
    let identity = format!(
        "{} {}",
        node.attr("id").unwrap_or(""),
        node.attr("class").unwrap_or("")
    )
    .to_ascii_lowercase();
    if [
        "advert",
        "ad_context",
        "contentadv",
        "em_media",
        "recommend",
        "copyright",
        "qrcode",
        "paywall",
    ]
    .iter()
    .any(|key| identity.contains(key))
    {
        return;
    }
    let style = node
        .attr("style")
        .unwrap_or("")
        .replace(' ', "")
        .to_ascii_lowercase();
    if node.attr("hidden").is_some()
        || node.attr("aria-hidden") == Some("true")
        || style.contains("display:none")
        || style.contains("visibility:hidden")
    {
        return;
    }
    if ["p", "div"].contains(&tag) {
        let own = element.text().collect::<String>();
        let own = own.trim_start();
        if ["（文章来源", "文章来源：", "责任编辑：", "推荐阅读"]
            .iter()
            .any(|prefix| own.starts_with(prefix))
        {
            return;
        }
    }
    for child in element.children() {
        match child.value() {
            scraper::Node::Text(text) => out.push_str(text),
            scraper::Node::Element(_) => {
                if let Some(child) = scraper::ElementRef::wrap(child) {
                    collect_article_text(child, out);
                }
            }
            _ => {}
        }
    }
    if ["p", "div", "tr", "li", "h1", "h2", "h3", "blockquote", "br"].contains(&tag) {
        out.push('\n');
    }
    if ["td", "th"].contains(&tag) {
        out.push('\t');
    }
}

fn parse_articles(
    body: &str,
    security: &SecurityRef,
    cutoff: DateTime<Utc>,
) -> Result<Vec<NewsArticle>, String> {
    let body = body
        .trim()
        .strip_prefix("tkeNews(")
        .and_then(|s| s.strip_suffix(");").or_else(|| s.strip_suffix(')')))
        .ok_or_else(|| "新闻响应格式无效".to_string())?;
    let value: Value = serde_json::from_str(body).map_err(|_| "新闻响应格式无效".to_string())?;
    let rows = value
        .pointer("/result/cmsArticleWebOld")
        .and_then(Value::as_array)
        .ok_or_else(|| "新闻响应格式无效".to_string())?;
    let mut articles = Vec::new();
    for row in rows {
        let field = |key: &str| row.get(key).and_then(Value::as_str).unwrap_or("");
        let title = clean_text(field("title"));
        let content = clean_text(field("content"));
        let source = clean_text(field("mediaName"));
        if title.is_empty() || content.is_empty() || content == title || source.is_empty() {
            continue;
        }
        let date = match NaiveDateTime::parse_from_str(field("date"), "%Y-%m-%d %H:%M:%S")
            .ok()
            .and_then(|date| {
                FixedOffset::east_opt(8 * 3600)?
                    .from_local_datetime(&date)
                    .single()
            }) {
            Some(date) => date.with_timezone(&Utc),
            None => continue,
        };
        if date > cutoff || date < cutoff - Duration::days(14) {
            continue;
        }
        let text = format!("{title} {content}");
        let code_match = matches_code(&text, &security.code);
        let name_match = !security.name.trim().is_empty() && text.contains(security.name.trim());
        if !code_match && !name_match {
            continue;
        }
        let raw_url = field("url");
        let url = if raw_url.is_empty() {
            let id = field("code");
            if id.is_empty() || !id.bytes().all(|c| c.is_ascii_digit()) {
                continue;
            }
            format!("https://finance.eastmoney.com/a/{id}.html")
        } else {
            raw_url
                .strip_prefix("http://")
                .map(|path| format!("https://{path}"))
                .unwrap_or_else(|| raw_url.to_string())
        };
        if !valid_article_url(&url) {
            continue;
        }
        let relevance = match (code_match, name_match) {
            (true, true) => "标题或搜索摘要匹配证券代码和名称",
            (true, false) => "标题或搜索摘要匹配证券代码",
            _ => "标题或搜索摘要匹配证券名称",
        };
        articles.push(NewsArticle {
            title: truncate(&title, 160),
            summary: truncate(&format!("搜索摘要（非全文）：{content}"), 400),
            published_at: date.to_rfc3339(),
            source: truncate(&source, 160),
            url,
            relevance: relevance.into(),
            full_text: None,
            content_status: "unavailable：仅搜索线索，未取得全文".into(),
        });
    }
    articles.sort_by(|a, b| b.published_at.cmp(&a.published_at));
    let mut seen = HashSet::new();
    let mut seen_titles = HashSet::new();
    articles.retain(|article| {
        seen.insert(article.url.clone()) && seen_titles.insert(article.title.clone())
    });
    articles.truncate(4);
    Ok(articles)
}
fn matches_code(text: &str, code: &str) -> bool {
    if code.len() != 6 || !code.bytes().all(|c| c.is_ascii_digit()) {
        return false;
    }
    text.match_indices(code).any(|(index, _)| {
        !text[..index]
            .chars()
            .next_back()
            .is_some_and(|c| c.is_ascii_digit())
            && !text[index + code.len()..]
                .chars()
                .next()
                .is_some_and(|c| c.is_ascii_digit())
    })
}
pub(super) fn valid_article_url(url: &str) -> bool {
    // Exact spelling also rejects explicit default ports, encoded paths, query strings and credentials.
    [
        "finance.eastmoney.com",
        "stock.eastmoney.com",
        "fund.eastmoney.com",
    ]
    .iter()
    .any(|host| {
        url.strip_prefix(&format!("https://{host}/a/"))
            .and_then(|path| path.strip_suffix(".html"))
            .is_some_and(|id| !id.is_empty() && id.bytes().all(|c| c.is_ascii_digit()))
    })
}
fn truncate(text: &str, max: usize) -> String {
    text.chars().take(max).collect()
}
fn clean_text(text: &str) -> String {
    let mut stripped = String::new();
    let mut in_tag = false;
    for c in text.chars() {
        match c {
            '<' => in_tag = true,
            '>' if in_tag => {
                in_tag = false;
                stripped.push(' ');
            }
            _ if !in_tag => stripped.push(c),
            _ => {}
        }
    }
    let mut decoded = String::new();
    let mut rest = stripped.as_str();
    while let Some(start) = rest.find('&') {
        decoded.push_str(&rest[..start]);
        rest = &rest[start..];
        if let Some(end) = rest.find(';').filter(|n| *n <= 12) {
            let entity = &rest[1..end];
            let c = match entity {
                "amp" => Some('&'),
                "lt" => Some('<'),
                "gt" => Some('>'),
                "quot" => Some('"'),
                "apos" | "#39" => Some('\''),
                "nbsp" => Some(' '),
                _ => entity
                    .strip_prefix("#x")
                    .or_else(|| entity.strip_prefix("#X"))
                    .and_then(|s| u32::from_str_radix(s, 16).ok())
                    .or_else(|| entity.strip_prefix('#').and_then(|s| s.parse().ok()))
                    .and_then(char::from_u32),
            };
            if let Some(c) = c {
                decoded.push(c);
                rest = &rest[end + 1..];
                continue;
            }
        }
        decoded.push('&');
        rest = &rest[1..];
    }
    decoded.push_str(rest);
    decoded.split_whitespace().collect::<Vec<_>>().join(" ")
}
