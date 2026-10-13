use super::{
    config,
    credentials::SystemSecrets,
    gateway::{CallContext, CompletionRequest, Gateway, Message},
    repository,
    types::*,
};
use crate::storage::Store;
use tauri::Manager;
use tokio_util::sync::CancellationToken;
pub struct AiServices {
    pub gateway: Gateway,
    pub runs: std::sync::Mutex<std::collections::HashMap<String, CancellationToken>>,
}
pub fn initialize(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let legacy =
        SystemSecrets::new(std::env::var("TCALCULATOR_QA_PROFILE").ok().as_deref() == Some("1"));
    {
        let store = app.state::<Store>();
        let mut db = lock(&store).map_err(|e| std::io::Error::other(e.message))?;
        config::migrate_legacy_keys(&mut db, &legacy)
            .map_err(|e| std::io::Error::other(e.message))?;
    }
    {
        let store = app.state::<Store>();
        let db = lock(&store).map_err(|e| std::io::Error::other(e.message))?;
        db.execute("UPDATE ai_tasks SET status='\"interrupted\"' WHERE status IN ('\"pending\"','\"collecting\"','\"analyzing\"','\"summarizing\"')",[])?;
    }
    app.manage(AiServices {
        runs: std::sync::Mutex::new(std::collections::HashMap::new()),
        gateway: Gateway::new().map_err(|e| std::io::Error::other(e.message))?,
    });
    Ok(())
}
fn lock(store: &Store) -> AiResult<std::sync::MutexGuard<'_, rusqlite::Connection>> {
    store.0.lock().map_err(|_| AiError::storage())
}
#[tauri::command]
pub fn ai_list_models(store: tauri::State<'_, Store>) -> AiResult<Vec<ModelConfig>> {
    config::list_models(&*lock(&store)?)
}
#[tauri::command]
pub fn ai_get_defaults(store: tauri::State<'_, Store>) -> AiResult<ModelDefaults> {
    config::get_defaults(&*lock(&store)?)
}
#[tauri::command]
pub fn ai_save_defaults(store: tauri::State<'_, Store>, defaults: ModelDefaults) -> AiResult<()> {
    config::save_defaults(&*lock(&store)?, &defaults)
}
#[tauri::command]
pub fn ai_save_model(
    store: tauri::State<'_, Store>,
    input: ModelConfigInput,
    replacement_secret: Option<String>,
) -> AiResult<ModelConfig> {
    config::save_model(&mut *lock(&store)?, input, replacement_secret)
}
#[tauri::command]
pub fn ai_delete_model(store: tauri::State<'_, Store>, id: String) -> AiResult<()> {
    config::delete_model(&mut *lock(&store)?, &id)
}
#[tauri::command]
pub async fn ai_list_model_versions(
    store: tauri::State<'_, Store>,
    services: tauri::State<'_, AiServices>,
    id: String,
) -> AiResult<Vec<String>> {
    let (model, key) = {
        let db = lock(&store)?;
        config::secret_for_model(&db, &id)?
    };
    services.gateway.list_model_versions(&model, &key).await
}
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelTestResult {
    model_id: String,
    attempts: u32,
    usage: Option<serde_json::Value>,
}
#[tauri::command]
pub async fn ai_test_model(
    store: tauri::State<'_, Store>,
    services: tauri::State<'_, AiServices>,
    id: String,
) -> AiResult<ModelTestResult> {
    let (model, key) = {
        let db = lock(&store)?;
        config::secret_for_model(&db, &id)?
    };
    let response = services
        .gateway
        .complete(
            &model,
            &key,
            &CompletionRequest {
                messages: vec![Message {
                    role: "user".into(),
                    content: "Reply with OK to confirm this connection.".into(),
                }],
                max_tokens: 64,
                disable_thinking: true,
            },
            &CallContext {
                cancel: CancellationToken::new(),
                allow_transient_retry: true,
                on_event: None,
            },
        )
        .await?;
    Ok(ModelTestResult {
        model_id: id,
        attempts: response.attempts,
        usage: response.usage,
    })
}
#[tauri::command]
pub fn ai_get_task(store: tauri::State<'_, Store>, task_id: String) -> AiResult<TaskDetail> {
    repository::get_task(&*lock(&store)?, &task_id)
}
#[tauri::command]
pub fn ai_list_history(
    store: tauri::State<'_, Store>,
    query: HistoryQuery,
) -> AiResult<HistoryPage> {
    repository::list_history(&*lock(&store)?, &query)
}
#[tauri::command]
pub fn ai_delete_task(store: tauri::State<'_, Store>, task_id: String) -> AiResult<()> {
    repository::delete_task(&mut *lock(&store)?, &task_id)
}

fn public_source_url(raw: &str) -> AiResult<String> {
    let url =
        reqwest::Url::parse(raw).map_err(|_| AiError::new("invalidSource", "来源地址无效"))?;
    if raw.len() > 2048
        || url.scheme() != "https"
        || !url.username().is_empty()
        || url.password().is_some()
        || !matches!(
            url.host_str(),
            Some(
                "so.eastmoney.com"
                    | "www.cninfo.com.cn"
                    | "static.cninfo.com.cn"
                    | "www.sse.com.cn"
            )
        )
    {
        return Err(AiError::new(
            "invalidSource",
            "只允许打开已核验的公开新闻和公告来源",
        ));
    }
    Ok(url.to_string())
}
#[tauri::command]
pub fn ai_open_public_source(url: String) -> AiResult<()> {
    let url = public_source_url(&url)?;
    #[cfg(target_os = "macos")]
    let result = std::process::Command::new("open").arg(&url).spawn();
    #[cfg(target_os = "windows")]
    let result = std::process::Command::new("rundll32.exe")
        .args(["url.dll,FileProtocolHandler", &url])
        .spawn();
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let result = std::process::Command::new("xdg-open").arg(&url).spawn();
    result
        .map(|_| ())
        .map_err(|_| AiError::new("openSource", "无法打开浏览器，请手动复制来源地址"))
}
#[cfg(test)]
mod source_tests {
    use super::*;
    #[test]
    fn public_links_require_https_exact_domain_and_no_credentials() {
        assert!(public_source_url("https://so.eastmoney.com/web/s?keyword=600519").is_ok());
        for url in [
            "javascript:alert(1)",
            "http://so.eastmoney.com",
            "https://so.eastmoney.com.evil.test/x",
            "https://user:pass@www.cninfo.com.cn/x",
        ] {
            assert!(public_source_url(url).is_err());
        }
    }
}
