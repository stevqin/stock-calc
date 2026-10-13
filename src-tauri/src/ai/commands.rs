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
    pub secrets: SystemSecrets,
    pub gateway: Gateway,
}
pub fn initialize(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    app.manage(AiServices {
        secrets: SystemSecrets::new(
            std::env::var("TCALCULATOR_QA_PROFILE").ok().as_deref() == Some("1"),
        ),
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
    services: tauri::State<'_, AiServices>,
    input: ModelConfigInput,
    replacement_secret: Option<String>,
) -> AiResult<ModelConfig> {
    config::save_model(
        &mut *lock(&store)?,
        &services.secrets,
        input,
        replacement_secret,
    )
}
#[tauri::command]
pub fn ai_delete_model(
    store: tauri::State<'_, Store>,
    services: tauri::State<'_, AiServices>,
    id: String,
) -> AiResult<()> {
    config::delete_model(&mut *lock(&store)?, &services.secrets, &id)
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
        config::secret_for_model(&db, &services.secrets, &id)?
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
                max_tokens: 16,
            },
            &CallContext {
                cancel: CancellationToken::new(),
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
