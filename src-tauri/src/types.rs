use serde::{Deserialize, Serialize};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub name: String,
    pub version: String,
    pub platform: String,
    pub default_model: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CredentialStatus {
    pub configured: bool,
    pub secure_storage_available: bool,
    pub source: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CredentialVerification {
    pub verified: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenRouterModelReasoning {
    pub mandatory: bool,
    pub supported_efforts: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_effort: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenRouterModel {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context_length: Option<u64>,
    pub input_modalities: Vec<String>,
    pub output_modalities: Vec<String>,
    pub supported_parameters: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reasoning: Option<OpenRouterModelReasoning>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenRouterModelCatalog {
    pub models: Vec<OpenRouterModel>,
    pub fetched_at: u64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSelection {
    pub path: String,
    pub name: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRunAccepted {
    pub run_id: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalSession {
    pub session_id: String,
    pub workspace_path: String,
    pub shell: String,
    pub pid: u32,
    pub cols: u16,
    pub rows: u16,
    pub status: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalSnapshot {
    pub session_id: String,
    pub data: String,
    pub sequence: u64,
    pub status: String,
}

#[derive(Clone, Serialize)]
pub struct ApiError {
    pub code: String,
    pub message: String,
}

#[derive(Clone, Serialize)]
#[serde(untagged)]
pub enum DesktopResult<T: Serialize> {
    Ok { ok: bool, value: T },
    Err { ok: bool, error: ApiError },
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSelectionOptions {
    pub default_path: Option<String>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduledTask {
    pub id: String,
    pub prompt: String,
    pub workspace_path: String,
    pub thread_id: String,
    pub model: Option<String>,
    pub reasoning_effort: Option<String>,
    pub cadence: String,
    pub status: String,
    pub created_at: u64,
    pub next_run_at: u64,
    pub last_run_at: Option<u64>,
    pub last_error: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateScheduledTaskInput {
    pub prompt: String,
    pub workspace_path: String,
    pub thread_id: String,
    pub model: Option<String>,
    pub reasoning_effort: Option<String>,
    pub cadence: String,
    pub run_at: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateScheduledTaskInput {
    pub id: String,
    pub status: String,
    pub workspace_path: String,
    pub model: Option<String>,
    pub reasoning_effort: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteScheduledTaskInput {
    pub id: String,
    pub workspace_path: String,
    pub model: Option<String>,
    pub reasoning_effort: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduleListInput {
    pub workspace_path: String,
    pub model: Option<String>,
    pub reasoning_effort: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PullRequestSummary {
    pub number: u64,
    pub title: String,
    pub url: String,
    pub state: String,
    pub branch: String,
    pub updated_at: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitOverview {
    pub is_repository: bool,
    pub branch: Option<String>,
    pub remote: Option<String>,
    pub changes: Vec<String>,
    pub pull_requests: Vec<PullRequestSummary>,
    pub pull_requests_message: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginSummary {
    pub name: String,
    pub version: Option<String>,
    pub path: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspacePathInput {
    pub workspace_path: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationScopeInput {
    pub workspace_path: String,
    pub model: Option<String>,
    pub reasoning_effort: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationMessagesInput {
    pub workspace_path: String,
    pub model: Option<String>,
    pub reasoning_effort: Option<String>,
    pub thread_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationCreateInput {
    pub workspace_path: String,
    pub model: Option<String>,
    pub reasoning_effort: Option<String>,
    pub thread_id: String,
    pub title: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImprovementScopeInput {
    pub workspace_path: String,
    pub model: Option<String>,
    pub reasoning_effort: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImprovementFeedbackInput {
    #[serde(flatten)]
    pub scope: ImprovementScopeInput,
    pub trace_id: String,
    pub rating: i8,
    pub comment: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImprovementCandidateInput {
    #[serde(flatten)]
    pub scope: ImprovementScopeInput,
    pub trace_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImprovementCandidateActionInput {
    #[serde(flatten)]
    pub scope: ImprovementScopeInput,
    pub candidate_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImprovementPublicationDecisionInput {
    #[serde(flatten)]
    pub scope: ImprovementScopeInput,
    pub candidate_id: String,
    pub approved: bool,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationThread {
    pub id: String,
    pub title: String,
    pub updated_at: u64,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationMessage {
    pub id: String,
    pub role: String,
    pub text: String,
    pub created_at: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRunInput {
    pub thread_id: String,
    pub prompt: String,
    pub workspace_path: Option<String>,
    pub model: Option<String>,
    pub reasoning_effort: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentCancelInput {
    pub run_id: String,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApprovalResolution {
    pub run_id: String,
    pub approval_id: String,
    pub tool_call_id: String,
    pub decision: String,
    pub message: Option<String>,
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalCreateInput {
    pub session_id: Option<String>,
    pub workspace_path: Option<String>,
    pub cols: Option<u16>,
    pub rows: Option<u16>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalSessionInput {
    pub session_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalWriteInput {
    pub session_id: String,
    pub data: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalResizeInput {
    pub session_id: String,
    pub cols: u16,
    pub rows: u16,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalKillInput {
    pub session_id: String,
    pub signal: Option<String>,
}
