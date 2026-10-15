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
    #[serde(default)]
    pub json_mode: bool,
    #[serde(default)]
    pub structured_tool: Option<serde_json::Value>,
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompletionResponse {
    pub content: String,
    pub usage: Option<serde_json::Value>,
    pub attempts: u32,
    pub finish_reason: Option<String>,
}
#[derive(Clone, Copy, Debug)]
pub enum CallEvent {
    AttemptStarting(u32),
    HeadersReceived(u32),
    ResponseCompleted(u32),
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
    header_timeout: Duration,
    generation_timeout: Duration,
    deepseek_wait_timeout: Duration,
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
fn is_deepseek(config: &ModelConfig) -> bool {
    config.provider == "deepseek"
        || reqwest::Url::parse(&config.base_url)
            .ok()
            .and_then(|u| u.host_str().map(str::to_owned))
            .is_some_and(|host| host == "api.deepseek.com")
}
fn elapsed_words(duration: Duration) -> String {
    let sec = duration.as_secs();
    if sec == 0 {
        "不到1秒".into()
    } else if sec < 60 {
        format!("{sec}秒")
    } else if sec % 60 == 0 {
        format!("{}分钟", sec / 60)
    } else {
        format!("{}分{}秒", sec / 60, sec % 60)
    }
}
fn report_receive_error(
    code: &str,
    elapsed: Duration,
    limit: Duration,
    has_content: bool,
    keepalive: bool,
) -> AiError {
    let progress = if has_content {
        "已经收到部分报告，但尚未接收完整，不能用于汇总"
    } else if keepalive {
        "只收到服务器保持连接的等待信号，还没收到报告内容"
    } else {
        "还没收到报告内容"
    };
    let reason = if code == "generationTimeout" {
        format!(
            "已连接到模型服务，但本阶段等待达到{}，仍未得到完整报告。",
            elapsed_words(limit)
        )
    } else {
        "已连接到模型服务，但接收报告时连接中断。".into()
    };
    let mut e=error(code,&format!("{reason}{progress}。从接口开始回应起已等待{}。可能服务繁忙、生成较慢或连接不稳定；目前无法确认具体原因。请稍后手动重新分析；本次没有再次发送请求，避免重复调用。",elapsed_words(elapsed)));
    e.retryable = code == "generationTimeout";
    e
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
                .connect_timeout(Duration::from_secs(15))
                .redirect(reqwest::redirect::Policy::none())
                .user_agent(concat!("TCalculator/", env!("CARGO_PKG_VERSION"), " AI"))
                .build()
                .map_err(|_| error("connection", "无法初始化模型连接"))?,
            scheduler: Scheduler::new(),
            header_timeout: Duration::from_secs(60),
            generation_timeout: Duration::from_secs(300),
            deepseek_wait_timeout: Duration::from_secs(660),
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
            .timeout(Duration::from_secs(120))
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
        let tool = if is_mimo(config) {
            request.structured_tool.as_ref()
        } else {
            None
        };
        if tool.is_none()
            && (is_deepseek(config)
                || (is_mimo(config)
                    && [
                        "mimo-v2.6-flash",
                        "mimo-v2.6-pro",
                        "mimo-v2.6-pro-ultraspeed",
                        "mimo-v2.5-pro",
                        "mimo-v2.5",
                    ]
                    .contains(&config.model.as_str())))
            && request.json_mode
        {
            payload["response_format"] = serde_json::json!({"type":"json_object"});
        }
        if let Some(tool) = tool {
            payload["tools"] = serde_json::json!([{"type":"function","function":tool}]);
            payload["tool_choice"] = serde_json::json!("auto");
        }
        if is_mimo(config) || is_deepseek(config) {
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
        loop {
            let permit = self.scheduler.acquire(&origin, &context.cancel).await?;
            attempts += 1;
            context.record(CallEvent::AttemptStarting(attempts))?;
            let sent = tokio::select! {biased;
                _=context.cancel.cancelled()=>return Err(error("cancelled","分析已取消")),
                r=tokio::time::timeout(self.header_timeout,self.client.post(&endpoint).bearer_auth(secret).json(&payload).send())=>r
            };
            let mut response = match sent {
                Err(_) => {
                    let mut e=error("responseStartTimeout",&format!("已发出请求，但等待{}秒后，模型服务仍未开始回应。无法确认对方是否已接收并处理；请检查网络与API地址，或稍后手动重试。本次没有再次发送请求，避免重复调用",self.header_timeout.as_secs()));
                    e.retryable = true;
                    return Err(e);
                }
                Ok(Ok(r)) => r,
                Ok(Err(e)) => {
                    drop(permit);
                    if e.is_connect() && attempts == 1 && context.allow_transient_retry {
                        tokio::select! {_=context.cancel.cancelled()=>return Err(error("cancelled","分析已取消")),_=tokio::time::sleep(Duration::from_secs(1))=>{}}
                        continue;
                    }
                    let mut err = if e.is_connect() && e.is_timeout() {
                        error(
                            "connectionTimeout",
                            "15秒内未能建立到模型服务的安全连接，尚未开始接收报告。请检查联网、代理设置和API基础地址",
                        )
                    } else if e.is_timeout() {
                        error(
                            "responseStartTimeout",
                            "请求已发出，但模型服务未及时开始回应。无法确认对方是否已处理；本次没有再次发送请求，请稍后手动重试",
                        )
                    } else {
                        error("connection", "模型连接失败，请检查地址或网络")
                    };
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
            let started = tokio::time::Instant::now();
            let deepseek = is_deepseek(config) && request.json_mode;
            let mut budget = if deepseek {
                self.deepseek_wait_timeout
            } else if request.json_mode {
                self.generation_timeout
            } else {
                self.header_timeout
            };
            let mut deadline = started + budget;
            let mut has_content = false;
            let mut keepalive = false;
            let mut total_received = 0usize;
            loop {
                let received = tokio::select! {biased;
                    _=context.cancel.cancelled()=>return Err(error("cancelled","分析已取消")),
                    r=tokio::time::timeout_at(deadline,response.chunk())=>r
                };
                let chunk = match received {
                    Err(_) => {
                        return Err(report_receive_error(
                            "generationTimeout",
                            started.elapsed(),
                            budget,
                            has_content,
                            keepalive,
                        ))
                    }
                    Ok(Ok(c)) => c,
                    Ok(Err(e)) => {
                        return Err(report_receive_error(
                            if e.is_timeout() {
                                "generationTimeout"
                            } else {
                                "responseRead"
                            },
                            started.elapsed(),
                            budget,
                            has_content,
                            keepalive,
                        ))
                    }
                };
                let Some(chunk) = chunk else { break };
                total_received = total_received.saturating_add(chunk.len());
                if total_received > 2 * 1024 * 1024 {
                    return Err(error("responseTooLarge","模型返回的数据超过本次接收上限，已停止读取。请减少手工资料或让报告更精简；本次没有再次发送请求"));
                }
                if !has_content && chunk.iter().all(u8::is_ascii_whitespace) {
                    keepalive = true;
                    continue;
                }
                if !has_content {
                    has_content = true;
                    if deepseek {
                        budget = self.generation_timeout;
                        deadline = tokio::time::Instant::now() + budget;
                    }
                }
                bytes.extend_from_slice(&chunk);
            }
            if !has_content {
                return Err(error(
                    "emptyResponse",
                    if keepalive {
                        "模型服务结束了连接，只收到保持连接的等待信号，没有报告内容。可能服务繁忙或等待被对方结束；请稍后手动重新分析。本次没有再次发送请求"
                    } else {
                        "模型服务结束了连接，但没有报告内容。请核对模型版本与接口兼容情况，或稍后手动重试。本次没有再次发送请求"
                    },
                ));
            }
            drop(permit);
            context.record(CallEvent::ResponseCompleted(attempts))?;
            let value: serde_json::Value = serde_json::from_slice(&bytes)
                .map_err(|_| error("protocol", "模型服务已经返回数据，但不是本程序能读取的完整报告格式。请核对API基础地址是否为兼容聊天接口；已停止本次读取，没有再次发送请求"))?;
            let tool_content = if let Some(calls) = value
                .pointer("/choices/0/message/tool_calls")
                .and_then(|v| v.as_array())
                .filter(|v| !v.is_empty())
            {
                let approved = tool.and_then(|t| t["name"].as_str());
                if calls.len() != 1
                    || calls[0]["type"] != "function"
                    || calls[0].pointer("/function/name").and_then(|v| v.as_str()) != approved
                    || approved.is_none()
                {
                    return Err(error(
                        "protocol",
                        "报告响应包含未知或多个工具调用，无法作为完整报告",
                    ));
                }
                Some(
                    calls[0]
                        .pointer("/function/arguments")
                        .and_then(|v| v.as_str())
                        .ok_or_else(|| error("protocol", "报告工具未返回有效参数文字"))?,
                )
            } else {
                None
            };
            let content = tool_content.or_else(||value
                .pointer("/choices/0/message/content")
                .and_then(|v| v.as_str())
                .filter(|s| !s.trim().is_empty()))
                .ok_or_else(|| {
                    let finish=value.pointer("/choices/0/finish_reason").and_then(|v|v.as_str()).filter(|s|["length","stop","content_filter","tool_calls","function_call","repetition_truncation"].contains(s)).unwrap_or("unknown");
                    let completed=value.pointer("/usage/completion_tokens").and_then(|v|v.as_u64());
                    let reasoning=value.pointer("/usage/completion_tokens_details/reasoning_tokens").and_then(|v|v.as_u64());
                    error("protocol",&format!("模型服务已完成回应，但没有给出报告正文。{}（诊断信息：结束标记={finish}，输出用量={completed:?}，思考用量={reasoning:?}）",if finish=="length"{"本次输出额度已用完，报告可能被截断或只生成了思考内容；请减少手工资料或使用支持关闭思考的型号。本次没有再次发送请求"}else{"对方未提供可读取的报告文字；请核对模型版本及接口兼容情况。本次没有再次发送请求"}))
                })?;
            return Ok(CompletionResponse {
                content: content.into(),
                usage: value.get("usage").filter(|v| v.is_object()).cloned(),
                attempts,
                finish_reason: value
                    .pointer("/choices/0/finish_reason")
                    .and_then(|v| v.as_str())
                    .map(str::to_owned),
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
            json_mode: false,
            structured_tool: None,
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
    async fn schema_tool_arguments_are_report_data_and_unexpected_calls_are_rejected() {
        let body = r#"{"choices":[{"finish_reason":"tool_calls","message":{"content":null,"tool_calls":[{"type":"function","function":{"name":"return_stock_report","arguments":"{\"overview\":\"ok\"}"}}]}}]}"#;
        let (url, seen, server) = serve(vec![(200, body.into())]).await;
        let mut cfg = config(url);
        cfg.provider = "xiaomi-mimo".into();
        cfg.model = "mimo-v2.6-flash".into();
        let mut input = serde_json::to_value(request()).unwrap();
        input["json_mode"] = serde_json::json!(true);
        input["structured_tool"] = serde_json::json!({"name":"return_stock_report","parameters":{"type":"object","properties":{"overview":{"type":"string"}},"required":["overview"]}});
        let req: CompletionRequest = serde_json::from_value(input).unwrap();
        let result = Gateway::new()
            .unwrap()
            .complete(&cfg, "fixture-key", &req, &context())
            .await
            .unwrap();
        server.await.unwrap();
        assert_eq!(result.content, r#"{"overview":"ok"}"#);
        let payload: serde_json::Value =
            serde_json::from_str(seen.lock().unwrap()[0].split("\r\n\r\n").nth(1).unwrap())
                .unwrap();
        assert_eq!(
            payload["tools"][0]["function"]["name"],
            "return_stock_report"
        );
        assert_eq!(payload["thinking"]["type"], "disabled");
        assert_eq!(payload["tool_choice"], "auto");
        assert!(payload.get("response_format").is_none());
        let (url, _, server) = serve(vec![(
            200,
            body.replace("return_stock_report", "unexpected_tool"),
        )])
        .await;
        cfg.base_url = url;
        assert!(Gateway::new()
            .unwrap()
            .complete(&cfg, "fixture-key", &req, &context())
            .await
            .is_err());
        server.await.unwrap();
    }
    #[tokio::test]
    async fn empty_body_response_reports_provider_finish_and_token_usage() {
        let(url,_,server)=serve(vec![(200,r#"{"choices":[{"finish_reason":"length","message":{"content":null,"reasoning_content":"thinking"}}],"usage":{"completion_tokens":8192,"completion_tokens_details":{"reasoning_tokens":8192}}}"#.into())]).await;
        let err = Gateway::new()
            .unwrap()
            .complete(&config(url), "fixture-key", &request(), &context())
            .await
            .unwrap_err();
        server.await.unwrap();
        assert!(
            err.message.contains("length") && err.message.contains("8192"),
            "{}",
            err.message
        );
    }
    #[tokio::test]
    async fn mimo_json_mode_and_finish_reason_are_preserved() {
        let (url,seen,server)=serve(vec![(200,r#"{"choices":[{"finish_reason":"length","message":{"content":"{\"reportVersion\":2}"}}]}"#.into())]).await;
        let mut c = config(url);
        c.provider = "xiaomi-mimo".into();
        c.model = "mimo-v2.6-flash".into();
        let mut v = serde_json::to_value(request()).unwrap();
        v["json_mode"] = serde_json::json!(true);
        let req: CompletionRequest = serde_json::from_value(v).unwrap();
        let result = Gateway::new()
            .unwrap()
            .complete(&c, "fixture-key", &req, &context())
            .await
            .unwrap();
        server.await.unwrap();
        let calls = seen.lock().unwrap();
        let body: serde_json::Value =
            serde_json::from_str(calls[0].split("\r\n\r\n").nth(1).unwrap()).unwrap();
        assert_eq!(
            body["response_format"],
            serde_json::json!({"type":"json_object"})
        );
        assert_eq!(
            serde_json::to_value(result).unwrap()["finishReason"],
            "length"
        );
    }
    #[tokio::test]
    async fn mimo_uses_completion_tokens_and_disables_thinking() {
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
    async fn deepseek_offline_request_disables_thinking_and_uses_native_json() {
        let (url, seen, server) = serve(vec![(
            200,
            r#"{"choices":[{"message":{"content":"{}"}}]}"#.into(),
        )])
        .await;
        let mut c = config(url);
        c.provider = "deepseek".into();
        c.model = "deepseek-flash".into();
        let mut r = request();
        r.json_mode = true;
        Gateway::new()
            .unwrap()
            .complete(&c, "fixture-key", &r, &context())
            .await
            .unwrap();
        server.await.unwrap();
        let raw = seen.lock().unwrap();
        let body: serde_json::Value =
            serde_json::from_str(raw[0].split("\r\n\r\n").nth(1).unwrap()).unwrap();
        assert_eq!(body["thinking"]["type"], "disabled");
        assert_eq!(body["response_format"]["type"], "json_object");
        assert_eq!(body["max_tokens"], 16);
        assert!(body.get("max_completion_tokens").is_none());
        assert!(body.get("reasoning_effort").is_none());
        assert!(body.get("tools").is_none());
        assert_eq!(raw.len(), 1);
    }
    #[tokio::test]
    async fn deepseek_offline_empty_keepalive_is_not_a_json_format_error() {
        let (url, _, server) = serve(vec![(200, "\n\n \r\n".into())]).await;
        let mut c = config(url);
        c.provider = "deepseek".into();
        let mut r = request();
        r.json_mode = true;
        let err = Gateway::new()
            .unwrap()
            .complete(&c, "fixture-key", &r, &context())
            .await
            .unwrap_err();
        server.await.unwrap();
        assert_eq!(err.code, "emptyResponse");
        assert!(err.message.contains("没有报告"));
        assert!(err.message.contains("保持连接"));
        assert!(!err.message.contains("JSON"));
    }
    #[tokio::test]
    async fn deepseek_offline_delayed_keepalive_report_remains_one_request() {
        use tokio::{
            io::{AsyncReadExt, AsyncWriteExt},
            net::TcpListener,
        };
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}/v1", listener.local_addr().unwrap());
        let server = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut buf = [0; 8192];
            socket.read(&mut buf).await.unwrap();
            socket.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nConnection: close\r\n\r\n\n\n").await.unwrap();
            tokio::time::sleep(Duration::from_millis(80)).await;
            socket
                .write_all(br#"{"choices":[{"message":{"content":"report"}}]}"#)
                .await
                .unwrap();
        });
        let mut c = config(url);
        c.provider = "deepseek".into();
        let mut r = request();
        r.json_mode = true;
        let mut gateway = Gateway::new().unwrap();
        gateway.generation_timeout = Duration::from_millis(25);
        let result = gateway
            .complete(&c, "fixture-key", &r, &context())
            .await
            .unwrap();
        server.await.unwrap();
        assert_eq!(result.content, "report");
        assert_eq!(result.attempts, 1);
    }
    #[test]
    fn deepseek_offline_detection_is_exact_and_does_not_guess_from_model_name() {
        for address in ["https://api.deepseek.com", "https://api.deepseek.com/v1"] {
            assert!(is_deepseek(&config(address.into())));
        }
        for address in [
            "https://api.deepseek.com.evil.example/v1",
            "https://other.example/deepseek",
            "http://127.0.0.1:1234/v1",
        ] {
            let mut c = config(address.into());
            c.model = "deepseek-flash".into();
            assert!(!is_deepseek(&c));
        }
        let c = config("http://127.0.0.1:1234/v1".into());
        assert!(!is_mimo(&c));
    }
    #[tokio::test]
    async fn deepseek_offline_keepalive_timeout_does_not_extend_or_resend() {
        use std::sync::{
            atomic::{AtomicU32, Ordering},
            Arc,
        };
        use tokio::{
            io::{AsyncReadExt, AsyncWriteExt},
            net::TcpListener,
        };
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}/v1", listener.local_addr().unwrap());
        let server = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut b = [0; 8192];
            socket.read(&mut b).await.unwrap();
            socket
                .write_all(b"HTTP/1.1 200 OK\r\nConnection: close\r\n\r\n")
                .await
                .unwrap();
            loop {
                if socket.write_all(b"\n").await.is_err() {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        });
        let count = Arc::new(AtomicU32::new(0));
        let c = count.clone();
        let mut ctx = context();
        ctx.on_event = Some(Arc::new(move |e| {
            if matches!(e, CallEvent::AttemptStarting(_)) {
                c.fetch_add(1, Ordering::SeqCst);
            }
            Ok(())
        }));
        let mut cfg = config(url);
        cfg.provider = "deepseek".into();
        let mut r = request();
        r.json_mode = true;
        let mut gw = Gateway::new().unwrap();
        gw.deepseek_wait_timeout = Duration::from_millis(80);
        let started = std::time::Instant::now();
        let err = gw
            .complete(&cfg, "fixture-key", &r, &ctx)
            .await
            .unwrap_err();
        assert_eq!(err.code, "generationTimeout");
        assert!(err.message.contains("保持连接"));
        assert!(err.message.contains("还没收到报告"));
        assert!(started.elapsed() < Duration::from_secs(2));
        assert_eq!(count.load(Ordering::SeqCst), 1);
        server.abort();
    }
    #[tokio::test]
    async fn deepseek_offline_partial_response_then_disconnect_has_clear_error_and_no_resend() {
        let (url, seen, server) = serve(vec![(200, "{\"choices\":".into())]).await;
        let mut cfg = config(url);
        cfg.provider = "deepseek".into();
        let mut r = request();
        r.json_mode = true;
        // A completed truncated JSON body is a protocol error; a mid-transfer cut is separately tested below.
        let err = Gateway::new()
            .unwrap()
            .complete(&cfg, "fixture-key", &r, &context())
            .await
            .unwrap_err();
        server.await.unwrap();
        assert_eq!(err.code, "protocol");
        assert!(err.message.contains("本次读取"));
        assert_eq!(seen.lock().unwrap().len(), 1);
        use tokio::{
            io::{AsyncReadExt, AsyncWriteExt},
            net::TcpListener,
        };
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}/v1", listener.local_addr().unwrap());
        let server = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut b = [0; 8192];
            socket.read(&mut b).await.unwrap();
            socket.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 1000\r\nConnection: close\r\n\r\n{\"choices\":").await.unwrap();
            tokio::time::sleep(Duration::from_millis(30)).await;
        });
        let mut cfg = config(url);
        cfg.provider = "deepseek".into();
        let err = Gateway::new()
            .unwrap()
            .complete(&cfg, "fixture-key", &r, &context())
            .await
            .unwrap_err();
        server.await.unwrap();
        assert_eq!(err.code, "responseRead");
        assert!(err.message.contains("连接中断"));
        assert!(err.message.contains("部分报告"));
        assert!(err.message.contains("没有再次发送"));
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
    async fn analysis_disables_mimo_thinking_without_sending_vendor_fields_to_custom() {
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
            if provider == "xiaomi-mimo" {
                assert_eq!(body["thinking"]["type"], "disabled");
            } else {
                assert!(body.get("thinking").is_none());
            }
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
    #[tokio::test]
    async fn headers_timeout_60s_does_not_resend() {
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
                    // An accepted socket with EOF is not a submitted model request.
                    if socket.read(&mut b).await.unwrap_or(0) == 0 {
                        return;
                    }
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
        // Keep real time during the socket handshake: paused Tokio time may
        // auto-advance while waiting for I/O and expire the header deadline early.
        tokio::time::pause();
        tokio::time::advance(Duration::from_secs(59)).await;
        assert!(!run.is_finished());
        tokio::time::advance(Duration::from_secs(2)).await;

        let err = run.await.unwrap().unwrap_err();
        assert_eq!(err.code, "responseStartTimeout");
        assert_eq!(count.load(Ordering::SeqCst), 1);
        server.abort();
    }

    #[tokio::test]
    async fn accepted_response_timeout_is_generation_timeout_without_resend() {
        use tokio::{
            io::{AsyncReadExt, AsyncWriteExt},
            net::TcpListener,
        };
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}/v1", listener.local_addr().unwrap());
        let count = std::sync::Arc::new(std::sync::atomic::AtomicU32::new(0));
        let c = count.clone();
        let server = tokio::spawn(async move {
            loop {
                let (mut socket, _) = listener.accept().await.unwrap();
                c.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                tokio::spawn(async move {
                    let mut b = [0; 4096];
                    let _ = socket.read(&mut b).await;
                    socket
                        .write_all(
                            b"HTTP/1.1 200 OK\r\nContent-Length: 1000\r\nConnection: close\r\n\r\n",
                        )
                        .await
                        .unwrap();
                    tokio::time::sleep(Duration::from_secs(10)).await;
                    drop(socket);
                });
            }
        });
        let mut gateway = Gateway::new().unwrap();
        gateway.client = reqwest::Client::builder()
            .timeout(Duration::from_millis(30))
            .build()
            .unwrap();
        let err = gateway
            .complete(&config(url), "fixture-key", &request(), &context())
            .await
            .unwrap_err();
        server.abort();
        assert_eq!(err.code, "generationTimeout");
        assert!(err.message.contains("完整"));
        assert_eq!(count.load(std::sync::atomic::Ordering::SeqCst), 1);
    }
    #[tokio::test]
    async fn structured_body_has_a_separate_longer_generation_budget() {
        use tokio::{
            io::{AsyncReadExt, AsyncWriteExt},
            net::TcpListener,
        };
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}/v1", listener.local_addr().unwrap());
        let server = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut b = [0; 4096];
            let _ = socket.read(&mut b).await;
            let body = r#"{"choices":[{"finish_reason":"stop","message":{"content":"ok"}}]}"#;
            socket
                .write_all(
                    format!(
                        "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                        body.len()
                    )
                    .as_bytes(),
                )
                .await
                .unwrap();
            tokio::time::sleep(Duration::from_millis(180)).await;
            socket.write_all(body.as_bytes()).await.unwrap();
        });
        let mut gateway = Gateway::new().unwrap();
        assert_eq!(gateway.header_timeout, Duration::from_secs(60));
        assert_eq!(gateway.generation_timeout, Duration::from_secs(300));
        gateway.header_timeout = Duration::from_millis(100);
        gateway.generation_timeout = Duration::from_secs(1);
        let mut req = request();
        req.json_mode = true;
        let result = tokio::time::timeout(
            Duration::from_secs(2),
            gateway.complete(&config(url), "fixture-key", &req, &context()),
        )
        .await
        .unwrap()
        .unwrap();
        assert_eq!(result.content, "ok");
        server.await.unwrap();
    }
    #[tokio::test]
    async fn generation_deadline_and_cancellation_are_bounded_without_retry() {
        use tokio::{
            io::{AsyncReadExt, AsyncWriteExt},
            net::TcpListener,
        };
        for cancel_at_end in [false, true] {
            let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
            let url = format!("http://{}/v1", listener.local_addr().unwrap());
            let server = tokio::spawn(async move {
                let (mut socket, _) = listener.accept().await.unwrap();
                let mut b = [0; 4096];
                let _ = socket.read(&mut b).await;
                socket
                    .write_all(
                        b"HTTP/1.1 200 OK\r\nContent-Length: 1000\r\nConnection: close\r\n\r\n",
                    )
                    .await
                    .unwrap();
                tokio::time::sleep(Duration::from_secs(5)).await;
                drop(socket);
            });
            let notify = std::sync::Arc::new(tokio::sync::Notify::new());
            let n = notify.clone();
            let token = CancellationToken::new();
            let ctx = CallContext {
                cancel: token.clone(),
                allow_transient_retry: true,
                on_event: Some(std::sync::Arc::new(move |e| {
                    if matches!(e, CallEvent::HeadersReceived(_)) {
                        n.notify_one()
                    }
                    Ok(())
                })),
            };
            let mut req = request();
            req.json_mode = true;
            let mut gateway = Gateway::new().unwrap();
            assert_eq!(gateway.generation_timeout, Duration::from_secs(300));
            gateway.generation_timeout = Duration::from_millis(60);
            let run = tokio::spawn(async move {
                gateway
                    .complete(&config(url), "fixture-key", &req, &ctx)
                    .await
            });
            tokio::time::timeout(Duration::from_secs(2), notify.notified())
                .await
                .unwrap();
            if cancel_at_end {
                token.cancel()
            }
            let err = tokio::time::timeout(Duration::from_secs(2), run)
                .await
                .unwrap()
                .unwrap()
                .unwrap_err();
            assert_eq!(
                err.code,
                if cancel_at_end {
                    "cancelled"
                } else {
                    "generationTimeout"
                }
            );
            server.abort();
        }
    }
    #[tokio::test]
    async fn tls_connection_timeout_is_distinct_from_generation_timeout() {
        use tokio::{io::AsyncReadExt, net::TcpListener};
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("https://{}/v1", listener.local_addr().unwrap());
        let server = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut b = [0; 4096];
            let _ = socket.read(&mut b).await;
            tokio::time::sleep(Duration::from_secs(5)).await;
            drop(socket);
        });
        let mut gateway = Gateway::new().unwrap();
        gateway.client = reqwest::Client::builder()
            .connect_timeout(Duration::from_millis(40))
            .build()
            .unwrap();
        let mut ctx = context();
        ctx.allow_transient_retry = false;
        let err = tokio::time::timeout(
            Duration::from_secs(2),
            gateway.complete(&config(url), "fixture-key", &request(), &ctx),
        )
        .await
        .unwrap()
        .unwrap_err();
        server.abort();
        assert_eq!(err.code, "connectionTimeout");
        assert!(err.message.contains("安全连接"));
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
    async fn body_timeout_does_not_resend_after_headers() {
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
            header_timeout: Duration::from_secs(60),
            generation_timeout: Duration::from_secs(300),
            deepseek_wait_timeout: Duration::from_secs(660),
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
        assert_eq!(err.code, "generationTimeout");
        assert!(err.retryable);
        assert_eq!(count.load(Ordering::SeqCst), 1);
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
