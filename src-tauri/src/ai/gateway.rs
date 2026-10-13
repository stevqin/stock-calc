use super::{scheduler::Scheduler, types::*};
use serde::{Deserialize, Serialize};
use std::time::Duration;
use tokio_util::sync::CancellationToken;
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Message {
    pub role: String,
    pub content: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompletionRequest {
    pub messages: Vec<Message>,
    pub max_tokens: u32,
    #[serde(default)]
    pub disable_thinking: bool,
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompletionResponse {
    pub content: String,
    pub usage: Option<serde_json::Value>,
    pub attempts: u32,
}
#[derive(Clone, Copy, Debug)]
pub enum CallEvent {
    AttemptStarting(u32),
    HeadersReceived(u32),
}
pub struct CallContext {
    pub cancel: CancellationToken,
    pub allow_transient_retry: bool,
    pub on_event: Option<std::sync::Arc<dyn Fn(CallEvent) -> AiResult<()> + Send + Sync>>,
}
impl CallContext {
    fn record(&self, event: CallEvent) -> AiResult<()> {
        if let Some(record) = &self.on_event {
            record(event)?;
        }
        Ok(())
    }
}

pub struct Gateway {
    client: reqwest::Client,
    scheduler: Scheduler,
}
fn retry_delay(value: Option<&str>, now: i64) -> Duration {
    let Some(value) = value else {
        return Duration::from_secs(1);
    };
    if let Ok(seconds) = value.parse::<u64>() {
        return Duration::from_secs(seconds);
    }
    if let Ok(date) = chrono::DateTime::parse_from_rfc2822(value) {
        return Duration::from_secs(date.timestamp().saturating_sub(now).max(0) as u64);
    }
    Duration::from_secs(1)
}
fn is_mimo(config: &ModelConfig) -> bool {
    config.provider == "xiaomi-mimo"
        || reqwest::Url::parse(&config.base_url)
            .ok()
            .and_then(|url| url.host_str().map(str::to_owned))
            .is_some_and(|host| {
                matches!(
                    host.as_str(),
                    "api.xiaomimimo.com" | "token-plan-cn.xiaomimimo.com"
                )
            })
}
fn error(code: &str, message: &str) -> AiError {
    AiError::new(code, message)
}
pub fn normalize_endpoint(base: &str) -> AiResult<String> {
    if base.len() > 2048 {
        return Err(error("invalidAddress", "API 地址过长"));
    }
    let mut url =
        reqwest::Url::parse(base.trim()).map_err(|_| error("invalidAddress", "API 地址无效"))?;
    let local = url.host_str().is_some_and(|h| {
        h == "localhost"
            || h.trim_matches(['[', ']'])
                .parse::<std::net::IpAddr>()
                .is_ok_and(|ip| ip.is_loopback())
    });
    if (url.scheme() != "https" && !(url.scheme() == "http" && local))
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(error(
            "invalidAddress",
            "请使用 HTTPS 基础地址；仅本机服务允许 HTTP，地址不能包含凭证、查询或片段",
        ));
    }
    let path = url.path().trim_end_matches('/');
    if path.ends_with("/chat/completions") {
        return Err(error(
            "invalidAddress",
            "请填写基础地址，不要包含 /chat/completions",
        ));
    }
    let path = format!("{path}/chat/completions");
    url.set_path(&path);
    Ok(url.to_string())
}
impl Gateway {
    pub fn new() -> AiResult<Self> {
        Ok(Self {
            client: reqwest::Client::builder()
                .timeout(Duration::from_secs(120))
                .connect_timeout(Duration::from_secs(15))
                .redirect(reqwest::redirect::Policy::none())
                .user_agent("TCalculator/0.6 AI")
                .build()
                .map_err(|_| error("connection", "无法初始化模型连接"))?,
            scheduler: Scheduler::new(),
        })
    }
    pub async fn list_model_versions(
        &self,
        config: &ModelConfig,
        secret: &str,
    ) -> AiResult<Vec<String>> {
        if secret.is_empty() || secret.contains(['\r', '\n']) {
            return Err(error("invalidSecret", "密钥无效"));
        }
        let endpoint = normalize_endpoint(&config.base_url)?;
        let endpoint = endpoint
            .strip_suffix("chat/completions")
            .unwrap()
            .to_owned()
            + "models";
        let origin = reqwest::Url::parse(&endpoint)
            .unwrap()
            .origin()
            .ascii_serialization();
        let cancel = CancellationToken::new();
        let _permit = self.scheduler.acquire(&origin, &cancel).await?;
        let mut response = self
            .client
            .get(endpoint)
            .bearer_auth(secret)
            .send()
            .await
            .map_err(|_| error("connection", "获取模型列表失败，请检查地址或网络"))?;
        if !response.status().is_success() {
            let status = response.status().as_u16();
            return Err(error("modelListUnavailable", &format!("无法获取模型列表（HTTP {status}），接口可能不支持列表或当前密钥没有权限；可手动选择或填写模型版本")));
        }
        let mut bytes = Vec::new();
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|_| error("responseRead", "模型列表读取失败"))?
        {
            if bytes.len() + chunk.len() > 2 * 1024 * 1024 {
                return Err(error("responseTooLarge", "模型列表超过2MB"));
            }
            bytes.extend_from_slice(&chunk);
        }
        let value: serde_json::Value = serde_json::from_slice(&bytes)
            .map_err(|_| error("protocol", "模型列表格式不兼容，请手动填写模型版本"))?;
        let data = value
            .get("data")
            .and_then(|v| v.as_array())
            .filter(|v| v.len() <= 10000)
            .ok_or_else(|| error("protocol", "模型列表格式不兼容，请手动填写模型版本"))?;
        let mut versions = Vec::new();
        for item in data {
            let id = item
                .get("id")
                .and_then(|v| v.as_str())
                .filter(|v| !v.is_empty() && v.len() <= 256 && !v.chars().any(char::is_control))
                .ok_or_else(|| error("protocol", "模型列表包含无效标识，请手动填写模型版本"))?;
            versions.push(id.to_owned());
        }
        versions.sort();
        versions.dedup();
        Ok(versions)
    }
    pub async fn complete(
        &self,
        config: &ModelConfig,
        secret: &str,
        request: &CompletionRequest,
        context: &CallContext,
    ) -> AiResult<CompletionResponse> {
        if context.cancel.is_cancelled() {
            return Err(error("cancelled", "分析已取消"));
        }
        if !config.enabled {
            return Err(error("disabled", "模型已禁用"));
        }
        if secret.is_empty() || secret.contains(['\r', '\n']) {
            return Err(error("invalidSecret", "密钥无效"));
        }
        if request.messages.is_empty() || request.max_tokens == 0 {
            return Err(error("invalidRequest", "模型请求缺失"));
        }
        let endpoint = normalize_endpoint(&config.base_url)?;
        let origin = reqwest::Url::parse(&endpoint)
            .unwrap()
            .origin()
            .ascii_serialization();
        let mut payload =
            serde_json::json!({"model":config.model,"messages":request.messages,"stream":false});
        payload[if is_mimo(config) {
            "max_completion_tokens"
        } else {
            "max_tokens"
        }] = request.max_tokens.into();
        if is_mimo(config) && request.disable_thinking {
            payload["thinking"] = serde_json::json!({"type":"disabled"});
        }
        if serde_json::to_vec(&payload)
            .map_err(|_| error("invalidRequest", "模型请求无效"))?
            .len()
            > 2 * 1024 * 1024
        {
            return Err(error("requestTooLarge", "模型资料超过2MB，请减少分析资料"));
        }
        let mut attempts = 0;
        'attempt: loop {
            let permit = self.scheduler.acquire(&origin, &context.cancel).await?;
            attempts += 1;
            context.record(CallEvent::AttemptStarting(attempts))?;
            let response = tokio::select! {biased;_=context.cancel.cancelled()=>return Err(error("cancelled","分析已取消")),r=self.client.post(&endpoint).bearer_auth(secret).json(&payload).send()=>r};
            let mut response = match response {
                Ok(r) => r,
                Err(e) => {
                    drop(permit);
                    if attempts == 1
                        && context.allow_transient_retry
                        && (e.is_connect() || e.is_timeout())
                    {
                        tokio::select! {_=context.cancel.cancelled()=>return Err(error("cancelled","分析已取消")),_=tokio::time::sleep(Duration::from_secs(1))=>{}}
                        continue;
                    }
                    let mut err = error(
                        if e.is_timeout() {
                            "timeout"
                        } else {
                            "connection"
                        },
                        if e.is_timeout() {
                            "模型请求超时"
                        } else {
                            "模型连接失败，请检查地址或网络"
                        },
                    );
                    err.retryable = e.is_connect() || e.is_timeout();
                    return Err(err);
                }
            };
            context.record(CallEvent::HeadersReceived(attempts))?;
            let status = response.status();
            if status.as_u16() == 429 || status.is_server_error() {
                let delay = retry_delay(
                    response
                        .headers()
                        .get(reqwest::header::RETRY_AFTER)
                        .and_then(|h| h.to_str().ok()),
                    chrono::Utc::now().timestamp(),
                );
                drop(permit);
                if attempts == 1 && context.allow_transient_retry {
                    if delay > Duration::from_secs(120) {
                        let mut err = error("serviceUnavailable", "服务商要求较长等待，请稍后重试");
                        err.retryable = true;
                        return Err(err);
                    }
                    tokio::select! {_=context.cancel.cancelled()=>return Err(error("cancelled","分析已取消")),_=tokio::time::sleep(delay)=>{}}
                    continue;
                }
                let mut err = error("serviceUnavailable", "模型服务限流或暂时不可用");
                err.retryable = true;
                return Err(err);
            }
            if status.is_redirection() {
                return Err(error(
                    "redirect",
                    "API 地址发生重定向，请直接配置目标基础地址",
                ));
            }
            if status.as_u16() == 401 || status.as_u16() == 403 {
                return Err(error("authentication", "密钥或访问权限无效"));
            }
            if status.as_u16() == 404 {
                return Err(error(
                    "modelNotFound",
                    "模型或接口不存在，请核对地址和模型标识",
                ));
            }
            if !status.is_success() {
                return Err(error(
                    "protocol",
                    &format!(
                        "模型拒绝请求（HTTP {}），请核对模型版本、套餐权限和兼容参数",
                        status.as_u16()
                    ),
                ));
            }
            let mut bytes = Vec::new();
            loop {
                let chunk = tokio::select! {biased;_=context.cancel.cancelled()=>return Err(error("cancelled","分析已取消")),r=response.chunk()=>r};
                let chunk = match chunk {
                    Ok(chunk) => chunk,
                    Err(e) => {
                        drop(permit);
                        if e.is_timeout() && attempts == 1 && context.allow_transient_retry {
                            tokio::select! {_=context.cancel.cancelled()=>return Err(error("cancelled","分析已取消")),_=tokio::time::sleep(Duration::from_secs(1))=>{}}
                            continue 'attempt;
                        }
                        let mut err = error(
                            if e.is_timeout() {
                                "timeout"
                            } else {
                                "responseRead"
                            },
                            if e.is_timeout() {
                                "模型请求超时"
                            } else {
                                "模型响应读取失败"
                            },
                        );
                        err.retryable = e.is_timeout();
                        return Err(err);
                    }
                };
                let Some(chunk) = chunk else {
                    break;
                };
                if bytes.len() + chunk.len() > 2 * 1024 * 1024 {
                    return Err(error("responseTooLarge", "模型响应超过2MB"));
                }
                bytes.extend_from_slice(&chunk);
            }
            drop(permit);
            let value: serde_json::Value = serde_json::from_slice(&bytes)
                .map_err(|_| error("protocol", "模型响应不是兼容的 JSON 格式"))?;
            let content = value
                .pointer("/choices/0/message/content")
                .and_then(|v| v.as_str())
                .filter(|s| !s.trim().is_empty())
                .ok_or_else(|| error("protocol", "模型未返回可用文本，请核对兼容接口"))?;
            return Ok(CompletionResponse {
                content: content.into(),
                usage: value.get("usage").filter(|v| v.is_object()).cloned(),
                attempts,
            });
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ai::test_server::serve;
    fn config(url: String) -> ModelConfig {
        ModelConfig {
            id: "m".into(),
            display_name: "M".into(),
            provider: "custom".into(),
            base_url: url,
            model: "test".into(),
            enabled: true,
        }
    }
    fn request() -> CompletionRequest {
        CompletionRequest {
            messages: vec![Message {
                role: "user".into(),
                content: "连接测试".into(),
            }],
            max_tokens: 16,
            disable_thinking: false,
        }
    }
    fn context() -> CallContext {
        CallContext {
            cancel: CancellationToken::new(),
            allow_transient_retry: true,
            on_event: None,
        }
    }
    #[tokio::test]
    async fn mimo_uses_completion_tokens_and_disables_thinking_only_for_test() {
        let (url, seen, server) = serve(vec![(
            200,
            r#"{"choices":[{"message":{"content":"OK"}}]}"#.into(),
        )])
        .await;
        let mut c = config(url);
        c.provider = "xiaomi-mimo".into();
        let mut r = request();
        r.disable_thinking = true;
        Gateway::new()
            .unwrap()
            .complete(&c, "fixture-key", &r, &context())
            .await
            .unwrap();
        server.await.unwrap();
        let requests = seen.lock().unwrap();
        let body: serde_json::Value =
            serde_json::from_str(requests[0].split("\r\n\r\n").nth(1).unwrap()).unwrap();
        assert_eq!(body["max_completion_tokens"], 16);
        assert!(body.get("max_tokens").is_none());
        assert_eq!(body["thinking"]["type"], "disabled");
    }
    #[tokio::test]
    async fn model_versions_use_saved_endpoint_and_bounded_parsing() {
        let (url, seen, server) = serve(vec![(
            200,
            r#"{"data":[{"id":"z"},{"id":"a"},{"id":"z"}]}"#.into(),
        )])
        .await;
        let versions = Gateway::new()
            .unwrap()
            .list_model_versions(&config(url), "fixture-key")
            .await
            .unwrap();
        assert_eq!(versions, vec!["a", "z"]);
        server.await.unwrap();
        assert!(seen.lock().unwrap()[0].starts_with("GET /v1/models "));
        for (status, body) in [
            (401, "{}"),
            (302, "{}"),
            (200, "{}"),
            (200, "{\"data\":[{\"id\":\"bad\\nmodel\"}]}"),
        ] {
            let (url, _, server) = serve(vec![(status, body.into())]).await;
            assert!(Gateway::new()
                .unwrap()
                .list_model_versions(&config(url), "fixture-key")
                .await
                .is_err());
            server.await.unwrap();
        }
    }
    #[test]
    fn mimo_legacy_configuration_is_detected_by_exact_host() {
        assert!(is_mimo(&config(
            "https://token-plan-cn.xiaomimimo.com/v1".into()
        )));
        assert!(is_mimo(&config("https://api.xiaomimimo.com/v1".into())));
        assert!(!is_mimo(&config(
            "https://api.xiaomimimo.com.example.com/v1".into()
        )));
    }
    #[tokio::test]
    async fn analysis_keeps_thinking_default_and_generic_token_parameter() {
        for provider in ["xiaomi-mimo", "custom"] {
            let (url, seen, server) = serve(vec![(
                200,
                r#"{"choices":[{"message":{"content":"OK"}}]}"#.into(),
            )])
            .await;
            let mut c = config(url);
            c.provider = provider.into();
            Gateway::new()
                .unwrap()
                .complete(&c, "fixture-key", &request(), &context())
                .await
                .unwrap();
            server.await.unwrap();
            let seen = seen.lock().unwrap();
            let body: serde_json::Value =
                serde_json::from_str(seen[0].split("\r\n\r\n").nth(1).unwrap()).unwrap();
            assert!(body.get("thinking").is_none());
            assert_eq!(
                body[if provider == "custom" {
                    "max_tokens"
                } else {
                    "max_completion_tokens"
                }],
                16
            );
        }
    }
    #[test]
    fn endpoint_preserves_v1_and_rejects_query_or_credentials() {
        assert_eq!(
            normalize_endpoint("https://example.com/api/v1/").unwrap(),
            "https://example.com/api/v1/chat/completions"
        );
        assert!(normalize_endpoint("https://user:pass@example.com/v1").is_err());
        assert!(normalize_endpoint("https://example.com/v1?q=x").is_err());
        assert!(normalize_endpoint("http://example.com/v1").is_err());
        assert!(normalize_endpoint("https://example.com/v1/chat/completions").is_err());
        assert!(normalize_endpoint("https://example.com/v1#x").is_err());
        assert!(normalize_endpoint("http://127.0.0.1:1234/v1").is_ok());
    }
    #[tokio::test]
    async fn compatible_response_and_single_transient_retry() {
        let body = r#"{"choices":[{"message":{"content":"ok"}}],"usage":{"total_tokens":4}}"#;
        let (url, seen, server) = serve(vec![(503, "{}".into()), (200, body.into())]).await;
        let result = Gateway::new()
            .unwrap()
            .complete(&config(url), "test-secret", &request(), &context())
            .await;
        assert!(result.is_ok());
        let result = result.unwrap();
        assert_eq!(result.content, "ok");
        assert_eq!(result.attempts, 2);
        assert_eq!(result.usage.unwrap()["total_tokens"], 4);
        server.await.unwrap();
        assert_eq!(seen.lock().unwrap().len(), 2);
    }
    #[tokio::test]
    async fn cross_host_redirect_is_rejected_and_auth_is_not_retried() {
        for status in [302, 401] {
            let (url, seen, server) =
                serve(vec![(status, "{\"secret\":\"test-secret\"}".into())]).await;
            let err = Gateway::new()
                .unwrap()
                .complete(&config(url), "test-secret", &request(), &context())
                .await
                .unwrap_err();
            assert!(if status == 302 {
                err.code == "redirect"
            } else {
                err.code == "authentication"
            });
            assert!(!err.message.contains("test-secret"));
            server.await.unwrap();
            assert_eq!(seen.lock().unwrap().len(), 1);
        }
    }
    #[tokio::test]
    async fn cancel_before_send_does_not_call_server() {
        let c = context();
        c.cancel.cancel();
        let error = Gateway::new()
            .unwrap()
            .complete(
                &config("http://127.0.0.1:1/v1".into()),
                "key",
                &request(),
                &c,
            )
            .await
            .unwrap_err();
        assert_eq!(error.code, "cancelled");
    }

    #[tokio::test]
    async fn repeated_transient_failure_stops_after_two_attempts() {
        let (url, seen, server) = serve(vec![(503, "{}".into()), (503, "{}".into())]).await;
        let err = Gateway::new()
            .unwrap()
            .complete(&config(url), "key", &request(), &context())
            .await
            .unwrap_err();
        assert_eq!(err.code, "serviceUnavailable");
        server.await.unwrap();
        assert_eq!(seen.lock().unwrap().len(), 2);
    }
    #[tokio::test(start_paused = true)]
    async fn timeout_120s_and_retry_once() {
        use std::sync::{
            atomic::{AtomicU32, Ordering},
            Arc,
        };
        use tokio::sync::Notify;
        use tokio::{io::AsyncReadExt, net::TcpListener};
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}/v1", listener.local_addr().unwrap());
        let count = Arc::new(AtomicU32::new(0));
        let notify = Arc::new(Notify::new());
        let n = notify.clone();
        let c = count.clone();
        let server = tokio::spawn(async move {
            loop {
                let (mut socket, _) = listener.accept().await.unwrap();
                let c = c.clone();
                let n = n.clone();
                tokio::spawn(async move {
                    let mut b = [0; 4096];
                    let _ = socket.read(&mut b).await;
                    c.fetch_add(1, Ordering::SeqCst);
                    n.notify_one();
                    tokio::time::sleep(Duration::from_secs(1000)).await;
                    drop(socket);
                });
            }
        });
        let run = tokio::spawn(async move {
            Gateway::new()
                .unwrap()
                .complete(&config(url), "key", &request(), &context())
                .await
        });
        notify.notified().await;
        tokio::time::advance(Duration::from_secs(119)).await;
        assert!(!run.is_finished());
        tokio::time::advance(Duration::from_secs(2)).await;
        notify.notified().await;
        tokio::time::advance(Duration::from_secs(121)).await;
        let err = run.await.unwrap().unwrap_err();
        assert_eq!(err.code, "timeout");
        assert_eq!(count.load(Ordering::SeqCst), 2);
        server.abort();
    }

    #[test]
    fn retry_after_http_date_is_respected() {
        assert_eq!(retry_delay(Some("120"), 0), Duration::from_secs(120));
        assert_eq!(
            retry_delay(Some("Wed, 21 Oct 2015 07:28:00 GMT"), 1445412420),
            Duration::from_secs(60)
        );
        assert_eq!(retry_delay(Some("invalid"), 0), Duration::from_secs(1));
        assert_eq!(
            retry_delay(Some("Wed, 21 Oct 2015 07:28:00 GMT"), 1445412481),
            Duration::ZERO
        );
    }

    #[tokio::test]
    async fn body_timeout_retries_once_and_reports_timeout() {
        use std::sync::{
            atomic::{AtomicU32, Ordering},
            Arc,
        };
        use tokio::sync::Notify;
        use tokio::{
            io::{AsyncReadExt, AsyncWriteExt},
            net::TcpListener,
        };
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}/v1", listener.local_addr().unwrap());
        let count = Arc::new(AtomicU32::new(0));
        let notify = Arc::new(Notify::new());
        let c = count.clone();
        let n = notify.clone();
        let server = tokio::spawn(async move {
            loop {
                let (mut socket, _) = listener.accept().await.unwrap();
                let c = c.clone();
                let n = n.clone();
                tokio::spawn(async move {
                    let mut b = [0; 4096];
                    let _ = socket.read(&mut b).await;
                    socket
                        .write_all(
                            b"HTTP/1.1 200 OK\r\nContent-Length: 1000\r\nConnection: close\r\n\r\n",
                        )
                        .await
                        .unwrap();
                    c.fetch_add(1, Ordering::SeqCst);
                    n.notify_one();
                    tokio::time::sleep(Duration::from_secs(1000)).await;
                    drop(socket);
                });
            }
        });
        let headers = Arc::new(Notify::new());
        let event = headers.clone();
        let ctx = CallContext {
            cancel: CancellationToken::new(),
            allow_transient_retry: true,
            on_event: Some(Arc::new(move |e| {
                if matches!(e, CallEvent::HeadersReceived(_)) {
                    event.notify_one();
                }
                Ok(())
            })),
        };
        let gateway = Gateway {
            client: reqwest::Client::builder()
                .timeout(Duration::from_millis(100))
                .redirect(reqwest::redirect::Policy::none())
                .build()
                .unwrap(),
            scheduler: Scheduler::new(),
        };
        let run = tokio::spawn(async move {
            gateway
                .complete(&config(url), "key", &request(), &ctx)
                .await
        });
        tokio::time::timeout(Duration::from_secs(2), headers.notified())
            .await
            .unwrap();
        let err = run.await.unwrap().unwrap_err();
        assert_eq!(err.code, "timeout");
        assert!(err.retryable);
        assert_eq!(count.load(Ordering::SeqCst), 2);
        server.abort();
    }

    #[tokio::test]
    async fn format_repair_call_does_not_retry_transient_failure() {
        let (url, seen, server) = serve(vec![(503, "{}".into())]).await;
        let mut ctx = context();
        ctx.allow_transient_retry = false;
        let err = Gateway::new()
            .unwrap()
            .complete(&config(url), "key", &request(), &ctx)
            .await
            .unwrap_err();
        assert_eq!(err.code, "serviceUnavailable");
        server.await.unwrap();
        assert_eq!(seen.lock().unwrap().len(), 1);
    }
}
