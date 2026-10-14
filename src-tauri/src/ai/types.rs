use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiError {
    pub code: String,
    pub message: String,
    pub retryable: bool,
}
impl AiError {
    pub fn new(code: &str, message: &str) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
            retryable: false,
        }
    }
    pub fn storage() -> Self {
        Self::new("storage", "AI 本地数据读取或写入失败")
    }
}
pub type AiResult<T> = Result<T, AiError>;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Asset {
    Stock,
    Etf,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SecurityRef {
    pub id: String,
    pub market: String,
    pub code: String,
    pub name: String,
    pub asset: Asset,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ModelConfig {
    pub id: String,
    pub display_name: String,
    pub provider: String,
    pub base_url: String,
    pub model: String,
    pub enabled: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ModelConfigInput {
    pub id: Option<String>,
    pub display_name: String,
    pub provider: String,
    pub base_url: String,
    pub model: String,
    pub enabled: bool,
}
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ModelDefaults {
    pub participant_ids: Vec<String>,
    pub summary_model_id: Option<String>,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GroupRef {
    pub id: String,
    pub name: String,
    pub member_ids: Vec<String>,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StartRequest {
    pub request_id: String,
    pub securities: Vec<SecurityRef>,
    pub group: Option<GroupRef>,
    pub participant_ids: Vec<String>,
    pub summary_model_id: String,
    #[serde(default)]
    pub execution_policy: Option<super::execution::Policy>,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TaskStatus {
    Pending,
    Collecting,
    Analyzing,
    Summarizing,
    Completed,
    Partial,
    Failed,
    Cancelled,
    Interrupted,
}
impl TaskStatus {
    pub fn active(&self) -> bool {
        matches!(
            self,
            Self::Pending | Self::Collecting | Self::Analyzing | Self::Summarizing
        )
    }
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Evidence {
    pub id: String,
    pub security_id: String,
    pub kind: String,
    pub source: String,
    pub url: Option<String>,
    pub published_at: Option<String>,
    pub time_precision: String,
    pub event_at: Option<String>,
    pub collected_at: String,
    pub content: String,
    pub content_hash: String,
    pub availability: String,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Snapshot {
    pub id: String,
    pub security: SecurityRef,
    pub cutoff_at: String,
    pub frozen_at: String,
    pub reference_price: Option<String>,
    pub windows: Value,
    pub series: Value,
    pub indicators: Value,
    pub evidence: Vec<Evidence>,
    pub source_states: Value,
    pub rule_versions: Value,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct IndependentReport {
    pub id: String,
    pub snapshot_id: String,
    pub model_snapshot: ModelConfig,
    pub windows: Value,
    pub claims: Value,
    pub raw_output: String,
    #[serde(default)]
    pub execution_plan: Option<Value>,
    #[serde(default)]
    pub outputs: Vec<Value>,
    pub validation: Value,
    pub usage: Option<Value>,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SummaryVersion {
    pub id: String,
    pub snapshot_id: String,
    pub version: u32,
    pub input_report_ids: Vec<String>,
    pub summary_model_snapshot: ModelConfig,
    pub windows: Value,
    pub key_claims: Value,
    pub disagreements: Value,
    pub validation: Value,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TaskDetail {
    pub id: String,
    pub parent_id: Option<String>,
    #[serde(default)]
    pub deleted_at: Option<String>,
    pub created_at: String,
    pub status: TaskStatus,
    pub security_snapshots: Vec<Snapshot>,
    pub request_snapshot: StartRequest,
    pub progress: Value,
    pub call_attempts: Vec<Value>,
    pub reports: Vec<IndependentReport>,
    pub summary_versions: Vec<SummaryVersion>,
    pub group_summary_versions: Vec<Value>,
    pub errors: Vec<AiError>,
}
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HistoryQuery {
    #[serde(default)]
    pub trashed: bool,
    pub security_id: Option<String>,
    pub date_from: Option<String>,
    pub date_to: Option<String>,
    pub status: Option<TaskStatus>,
    pub cursor: Option<String>,
    pub limit: Option<u32>,
}
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryPage {
    pub items: Vec<TaskDetail>,
    pub next_cursor: Option<String>,
}
