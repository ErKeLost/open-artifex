use std::env;

use rfd::FileDialog;
use serde_json::{json, Value};
use tauri::{AppHandle, State};

use crate::services::agent::AgentBridge;
use crate::services::terminal;
use crate::services::workspace::{
    activate as activate_workspace, canonical_directory, list as list_workspaces,
    remember_selection, resolve_workspace, selection_for,
};
use crate::services::{credentials, inventory, openrouter};
use crate::services::{err, new_id, ok, timestamp};
use crate::state::AppState;
use crate::types::{
    AgentCancelInput, AgentRunAccepted, AgentRunInput, AppInfo, ApprovalResolution,
    ConversationCreateInput, ConversationMessage, ConversationMessagesInput,
    ConversationScopeInput, ConversationThread, CreateScheduledTaskInput, CredentialStatus,
    CredentialVerification, DeleteScheduledTaskInput, DesktopResult, GitOverview,
    OpenRouterModelCatalog, PluginSummary, ScheduleListInput, ScheduledTask, TerminalCreateInput,
    TerminalKillInput, TerminalResizeInput, TerminalSession, TerminalSessionInput,
    TerminalSnapshot, TerminalWriteInput, UpdateScheduledTaskInput, WorkspacePathInput,
    WorkspaceSelection, WorkspaceSelectionOptions,
};

const DEFAULT_MODEL: &str = "anthropic/claude-sonnet-4";

#[tauri::command]
pub async fn app_info<R: tauri::Runtime>(app: AppHandle<R>) -> DesktopResult<AppInfo> {
    ok(AppInfo {
        name: "Open Artifex".into(),
        version: app.package_info().version.to_string(),
        platform: env::consts::OS.into(),
        default_model: env::var("OPENROUTER_MODEL").unwrap_or_else(|_| DEFAULT_MODEL.into()),
    })
}

#[tauri::command]
pub fn credential_status(state: State<'_, AppState>) -> DesktopResult<CredentialStatus> {
    let credentials = state.credentials.lock().unwrap();
    ok(credentials::status(&credentials))
}

#[tauri::command]
pub fn credential_set(
    api_key: String,
    state: State<'_, AppState>,
) -> DesktopResult<CredentialStatus> {
    if api_key.trim().len() < 20 || api_key.len() > 16_384 {
        return err("INVALID_ARGUMENT", "OpenRouter API key is invalid");
    }
    match credentials::set(&mut state.credentials.lock().unwrap(), api_key) {
        Ok(status) => ok(status),
        Err(error) => err("SECURE_STORAGE_UNAVAILABLE", error),
    }
}

#[tauri::command]
pub fn credential_clear(state: State<'_, AppState>) -> DesktopResult<CredentialStatus> {
    match credentials::clear(&mut state.credentials.lock().unwrap()) {
        Ok(status) => ok(status),
        Err(error) => err("SECURE_STORAGE_UNAVAILABLE", error),
    }
}

#[tauri::command]
pub async fn credential_verify(
    state: State<'_, AppState>,
) -> Result<DesktopResult<CredentialVerification>, ()> {
    let api_key = match credentials::resolve(&state.credentials.lock().unwrap()) {
        Some(api_key) => api_key,
        None => {
            return Ok(err(
                "CREDENTIAL_MISSING",
                "Configure an OpenRouter API key first",
            ))
        }
    };
    let response = match reqwest::Client::new()
        .get("https://openrouter.ai/api/v1/auth/key")
        .bearer_auth(api_key)
        .send()
        .await
    {
        Ok(response) => response,
        Err(error) => return Ok(err("CREDENTIAL_UNAVAILABLE", error.to_string())),
    };
    if !response.status().is_success() {
        return Ok(err(
            "CREDENTIAL_INVALID",
            format!("OpenRouter rejected the API key ({})", response.status()),
        ));
    }
    Ok(ok(CredentialVerification { verified: true }))
}

#[tauri::command]
pub async fn openrouter_models(
    state: State<'_, AppState>,
) -> Result<DesktopResult<OpenRouterModelCatalog>, ()> {
    let api_key = credentials::resolve(&state.credentials.lock().unwrap());
    match openrouter::models(api_key).await {
        Ok(models) => Ok(ok(OpenRouterModelCatalog {
            models,
            fetched_at: timestamp(),
        })),
        Err(error) => Ok(err("CREDENTIAL_UNAVAILABLE", error)),
    }
}

#[tauri::command]
pub fn workspace_default(state: State<'_, AppState>) -> DesktopResult<WorkspaceSelection> {
    let mut workspaces = state.workspace.lock().unwrap();
    if let Err(error) = std::fs::create_dir_all(&workspaces.default_path) {
        return err("INTERNAL_ERROR", error.to_string());
    }
    match canonical_directory(&workspaces.default_path) {
        Ok(path) => {
            workspaces.allowed.insert(path.clone());
            let _ = remember_selection(&mut workspaces, path.clone());
            ok(selection_for(&path))
        }
        Err(error) => err("INTERNAL_ERROR", error),
    }
}

#[tauri::command]
pub fn workspace_select(
    options: Option<WorkspaceSelectionOptions>,
    state: State<'_, AppState>,
) -> DesktopResult<Option<WorkspaceSelection>> {
    let default_path = options.and_then(|value| value.default_path).or_else(|| {
        state
            .workspace
            .lock()
            .ok()
            .map(|value| value.default_path.to_string_lossy().into_owned())
    });
    let mut dialog = FileDialog::new();
    if let Some(path) = default_path {
        dialog = dialog.set_directory(path);
    }
    let Some(path) = dialog.pick_folder() else {
        return ok(None);
    };
    let canonical = match canonical_directory(path) {
        Ok(path) => path,
        Err(error) => return err("INVALID_ARGUMENT", error),
    };
    let mut workspaces = state.workspace.lock().unwrap();
    workspaces.default_path = canonical.clone();
    if let Err(error) = remember_selection(&mut workspaces, canonical.clone()) {
        return err("INTERNAL_ERROR", error);
    }
    ok(Some(selection_for(&canonical)))
}

#[tauri::command]
pub fn workspace_list(state: State<'_, AppState>) -> DesktopResult<Vec<WorkspaceSelection>> {
    ok(list_workspaces(&state))
}

#[tauri::command]
pub fn workspace_activate(
    path: String,
    state: State<'_, AppState>,
) -> DesktopResult<WorkspaceSelection> {
    match activate_workspace(&state, &path) {
        Ok(selection) => ok(selection),
        Err(error) => err("NOT_AUTHORIZED", error),
    }
}

#[tauri::command]
pub fn workspace_git_overview(
    input: WorkspacePathInput,
    state: State<'_, AppState>,
) -> DesktopResult<GitOverview> {
    match resolve_workspace(&state, Some(&input.workspace_path)) {
        Ok(workspace) => ok(inventory::git_overview(&workspace)),
        Err(error) => err("NOT_AUTHORIZED", error),
    }
}

#[tauri::command]
pub fn plugin_list(
    input: WorkspacePathInput,
    state: State<'_, AppState>,
) -> DesktopResult<Vec<PluginSummary>> {
    match resolve_workspace(&state, Some(&input.workspace_path)) {
        Ok(workspace) => ok(inventory::plugins(&workspace)),
        Err(error) => err("NOT_AUTHORIZED", error),
    }
}

#[tauri::command]
pub fn agent_run<R: tauri::Runtime>(
    app: AppHandle<R>,
    input: AgentRunInput,
    state: State<'_, AppState>,
) -> DesktopResult<AgentRunAccepted> {
    let workspace_path = match resolve_workspace(&state, input.workspace_path.as_deref()) {
        Ok(path) => path,
        Err(error) => return err("NOT_AUTHORIZED", error),
    };
    let api_key = credentials::resolve(&state.credentials.lock().unwrap());
    let Some(api_key) = api_key else {
        return err(
            "CREDENTIAL_MISSING",
            "Configure an OpenRouter API key before starting an agent run",
        );
    };
    let (model, reasoning_effort) =
        match resolve_model_selection(input.model, input.reasoning_effort) {
            Ok(selection) => selection,
            Err(error) => return err("INVALID_ARGUMENT", error),
        };

    let run_id = new_id("run");
    let request = json!({
        "runId": run_id,
        "threadId": input.thread_id,
        "prompt": input.prompt,
        "workspacePath": workspace_path.to_string_lossy(),
        "model": model,
        "reasoningEffort": reasoning_effort,
        "provider": {"kind": "openrouter", "apiKey": api_key, "model": model}
    });
    if let Err(error) = state.agent.send(
        &app,
        json!({"version": 1, "type": "agent.run", "request": request}),
    ) {
        return err("AGENT_UNAVAILABLE", error);
    }
    ok(AgentRunAccepted { run_id })
}

#[tauri::command]
pub fn agent_cancel<R: tauri::Runtime>(
    app: AppHandle<R>,
    input: AgentCancelInput,
    state: State<'_, AppState>,
) -> DesktopResult<()> {
    send_agent_message(
        &state.agent,
        &app,
        json!({"version": 1, "type": "agent.cancel", "runId": input.run_id}),
    )
}

#[tauri::command]
pub fn agent_resolve_approval<R: tauri::Runtime>(
    app: AppHandle<R>,
    input: ApprovalResolution,
    state: State<'_, AppState>,
) -> DesktopResult<()> {
    send_agent_message(
        &state.agent,
        &app,
        json!({"version": 1, "type": "agent.approval.resolve", "resolution": input}),
    )
}

fn send_agent_message<R: tauri::Runtime>(
    bridge: &AgentBridge,
    app: &AppHandle<R>,
    message: Value,
) -> DesktopResult<()> {
    match bridge.send(app, message) {
        Ok(()) => ok(()),
        Err(error) => err("AGENT_UNAVAILABLE", error),
    }
}

fn valid_model_id(model: &str) -> bool {
    model.len() <= 256
        && model
            .chars()
            .all(|value| value.is_ascii_alphanumeric() || "._:@/+\\-".contains(value))
}

fn valid_reasoning_effort(effort: &str) -> bool {
    effort.len() <= 32
        && !effort.is_empty()
        && effort
            .chars()
            .all(|value| value.is_ascii_alphanumeric() || value == '-' || value == '_')
}

fn resolve_model_selection(
    requested_model: Option<String>,
    requested_effort: Option<String>,
) -> Result<(String, Option<String>), String> {
    let model = requested_model
        .filter(|value| !value.trim().is_empty())
        .or_else(|| env::var("OPENROUTER_MODEL").ok())
        .unwrap_or_else(|| DEFAULT_MODEL.into());
    if !valid_model_id(&model) {
        return Err("OpenRouter model ID is invalid".into());
    }
    let reasoning_effort = requested_effort.filter(|value| !value.trim().is_empty());
    if let Some(effort) = reasoning_effort.as_deref() {
        if !valid_reasoning_effort(effort) {
            return Err("OpenRouter reasoning effort is invalid".into());
        }
    }
    Ok((model, reasoning_effort))
}

#[tauri::command]
pub fn terminal_create<R: tauri::Runtime>(
    app: AppHandle<R>,
    input: Option<TerminalCreateInput>,
    state: State<'_, AppState>,
) -> DesktopResult<TerminalSession> {
    terminal::create(app, input, state)
}

#[tauri::command]
pub fn terminal_write(input: TerminalWriteInput, state: State<'_, AppState>) -> DesktopResult<()> {
    terminal::write(input, state)
}

#[tauri::command]
pub fn terminal_resize(
    input: TerminalResizeInput,
    state: State<'_, AppState>,
) -> DesktopResult<()> {
    terminal::resize(input, state)
}

#[tauri::command]
pub fn terminal_kill(input: TerminalKillInput, state: State<'_, AppState>) -> DesktopResult<()> {
    terminal::kill(input, state)
}

#[tauri::command]
pub fn terminal_subscribe(
    input: TerminalSessionInput,
    state: State<'_, AppState>,
) -> DesktopResult<TerminalSnapshot> {
    terminal::subscribe(input, state)
}

#[tauri::command]
pub fn conversation_list<R: tauri::Runtime>(
    app: AppHandle<R>,
    input: ConversationScopeInput,
    state: State<'_, AppState>,
) -> DesktopResult<Vec<ConversationThread>> {
    let value = match conversation_request(
        &app,
        &state,
        &input.workspace_path,
        input.model,
        input.reasoning_effort,
        "conversation-control",
        json!({"operation":"list"}),
    ) {
        Ok(value) => value,
        Err(error) => return err("AGENT_UNAVAILABLE", error),
    };
    match value
        .get("threads")
        .cloned()
        .and_then(|threads| serde_json::from_value(threads).ok())
    {
        Some(threads) => ok(threads),
        None => err("AGENT_UNAVAILABLE", "Conversation response is invalid"),
    }
}

#[tauri::command]
pub fn conversation_messages<R: tauri::Runtime>(
    app: AppHandle<R>,
    input: ConversationMessagesInput,
    state: State<'_, AppState>,
) -> DesktopResult<Vec<ConversationMessage>> {
    let value = match conversation_request(
        &app,
        &state,
        &input.workspace_path,
        input.model,
        input.reasoning_effort,
        &input.thread_id,
        json!({"operation":"messages", "threadId": input.thread_id}),
    ) {
        Ok(value) => value,
        Err(error) => return err("AGENT_UNAVAILABLE", error),
    };
    match value
        .get("messages")
        .cloned()
        .and_then(|messages| serde_json::from_value(messages).ok())
    {
        Some(messages) => ok(messages),
        None => err("AGENT_UNAVAILABLE", "Conversation response is invalid"),
    }
}

#[tauri::command]
pub fn conversation_create<R: tauri::Runtime>(
    app: AppHandle<R>,
    input: ConversationCreateInput,
    state: State<'_, AppState>,
) -> DesktopResult<ConversationThread> {
    let thread_id = input.thread_id.clone();
    let title = input.title.clone();
    let value = match conversation_request(
        &app,
        &state,
        &input.workspace_path,
        input.model,
        input.reasoning_effort,
        &thread_id,
        json!({"operation":"create", "threadId": thread_id, "title": title}),
    ) {
        Ok(value) => value,
        Err(error) => return err("AGENT_UNAVAILABLE", error),
    };
    match value
        .get("thread")
        .cloned()
        .and_then(|thread| serde_json::from_value(thread).ok())
    {
        Some(thread) => ok(thread),
        None => err("AGENT_UNAVAILABLE", "Conversation response is invalid"),
    }
}

#[tauri::command]
pub fn schedule_list<R: tauri::Runtime>(
    app: AppHandle<R>,
    input: ScheduleListInput,
    state: State<'_, AppState>,
) -> DesktopResult<Vec<ScheduledTask>> {
    let value = match schedule_request(
        &app,
        &state,
        &input.workspace_path,
        input.model,
        input.reasoning_effort,
        "schedule-control",
        json!({"operation":"list"}),
    ) {
        Ok(value) => value,
        Err(error) => return err("SCHEDULE_UNAVAILABLE", error),
    };
    match value
        .get("tasks")
        .cloned()
        .and_then(|tasks| serde_json::from_value(tasks).ok())
    {
        Some(tasks) => ok(tasks),
        None => err("SCHEDULE_UNAVAILABLE", "Schedule response is invalid"),
    }
}

#[tauri::command]
pub fn schedule_create<R: tauri::Runtime>(
    app: AppHandle<R>,
    input: CreateScheduledTaskInput,
    state: State<'_, AppState>,
) -> DesktopResult<ScheduledTask> {
    let command = json!({
        "operation":"create",
        "prompt": input.prompt,
        "cadence": input.cadence,
        "runAt": input.run_at,
        "timezone": "Asia/Shanghai",
    });
    let value = match schedule_request(
        &app,
        &state,
        &input.workspace_path,
        input.model,
        input.reasoning_effort,
        &input.thread_id,
        command,
    ) {
        Ok(value) => value,
        Err(error) => return err("SCHEDULE_UNAVAILABLE", error),
    };
    match value
        .get("task")
        .cloned()
        .and_then(|task| serde_json::from_value(task).ok())
    {
        Some(task) => ok(task),
        None => err("SCHEDULE_UNAVAILABLE", "Schedule response is invalid"),
    }
}

#[tauri::command]
pub fn schedule_update<R: tauri::Runtime>(
    app: AppHandle<R>,
    input: UpdateScheduledTaskInput,
    state: State<'_, AppState>,
) -> DesktopResult<ScheduledTask> {
    let command = json!({"operation":"set-status", "id":input.id, "status":input.status});
    let value = match schedule_request(
        &app,
        &state,
        &input.workspace_path,
        input.model,
        input.reasoning_effort,
        "schedule-control",
        command,
    ) {
        Ok(value) => value,
        Err(error) => return err("SCHEDULE_UNAVAILABLE", error),
    };
    match value
        .get("task")
        .cloned()
        .and_then(|task| serde_json::from_value(task).ok())
    {
        Some(task) => ok(task),
        None => err("SCHEDULE_UNAVAILABLE", "Schedule response is invalid"),
    }
}

#[tauri::command]
pub fn schedule_delete<R: tauri::Runtime>(
    app: AppHandle<R>,
    input: DeleteScheduledTaskInput,
    state: State<'_, AppState>,
) -> DesktopResult<()> {
    let command = json!({"operation":"delete", "id":input.id});
    match schedule_request(
        &app,
        &state,
        &input.workspace_path,
        input.model,
        input.reasoning_effort,
        "schedule-control",
        command,
    ) {
        Ok(_) => ok(()),
        Err(error) => err("SCHEDULE_UNAVAILABLE", error),
    }
}

fn schedule_request<R: tauri::Runtime>(
    app: &AppHandle<R>,
    state: &State<'_, AppState>,
    workspace_path: &str,
    requested_model: Option<String>,
    requested_effort: Option<String>,
    thread_id: &str,
    schedule: Value,
) -> Result<Value, String> {
    let workspace = resolve_workspace(state, Some(workspace_path))?;
    let api_key = credentials::resolve(&state.credentials.lock().unwrap())
        .ok_or_else(|| "Configure an OpenRouter API key before managing schedules".to_string())?;
    let (model, reasoning_effort) = resolve_model_selection(requested_model, requested_effort)?;
    let response = state.agent.request_schedule(
        app,
        json!({
            "workspacePath": workspace.to_string_lossy(),
            "threadId": thread_id,
            "model": model,
            "reasoningEffort": reasoning_effort,
            "provider": {"kind":"openrouter", "apiKey":api_key, "model":model},
            "schedule": schedule,
        }),
    )?;
    if response.get("ok").and_then(Value::as_bool) != Some(true) {
        return Err(response
            .get("error")
            .and_then(|error| error.get("message"))
            .and_then(Value::as_str)
            .unwrap_or("Schedule operation failed")
            .into());
    }
    response
        .get("value")
        .cloned()
        .ok_or_else(|| "Schedule response is invalid".into())
}

fn conversation_request<R: tauri::Runtime>(
    app: &AppHandle<R>,
    state: &State<'_, AppState>,
    workspace_path: &str,
    requested_model: Option<String>,
    requested_effort: Option<String>,
    thread_id: &str,
    conversation: Value,
) -> Result<Value, String> {
    let workspace = resolve_workspace(state, Some(workspace_path))?;
    let api_key = credentials::resolve(&state.credentials.lock().unwrap()).ok_or_else(|| {
        "Configure an OpenRouter API key before loading conversations".to_string()
    })?;
    let (model, reasoning_effort) = resolve_model_selection(requested_model, requested_effort)?;
    let response = state.agent.request_conversation(
        app,
        json!({
            "workspacePath": workspace.to_string_lossy(),
            "threadId": thread_id,
            "model": model,
            "reasoningEffort": reasoning_effort,
            "provider": {"kind":"openrouter", "apiKey":api_key, "model":model},
            "conversation": conversation,
        }),
    )?;
    if response.get("ok").and_then(Value::as_bool) != Some(true) {
        return Err(response
            .get("error")
            .and_then(|error| error.get("message"))
            .and_then(Value::as_str)
            .unwrap_or("Conversation operation failed")
            .into());
    }
    response
        .get("value")
        .cloned()
        .ok_or_else(|| "Conversation response is invalid".into())
}

macro_rules! browser_command {
    ($name:ident, $kind:literal) => {
        #[tauri::command]
        pub fn $name<R: tauri::Runtime>(
            app: AppHandle<R>,
            input: Value,
            state: State<'_, AppState>,
        ) -> DesktopResult<Value> {
            browser_request(&app, &state, input, $kind)
        }
    };
}

browser_command!(browser_state, "state");
browser_command!(browser_start, "start");
browser_command!(browser_navigate, "navigate");
browser_command!(browser_back, "back");
browser_command!(browser_forward, "forward");
browser_command!(browser_reload, "reload");
browser_command!(browser_mouse, "mouse");
browser_command!(browser_key, "key");
browser_command!(browser_close, "close");

fn browser_request<R: tauri::Runtime>(
    app: &AppHandle<R>,
    state: &State<'_, AppState>,
    input: Value,
    kind: &str,
) -> DesktopResult<Value> {
    let Some(object) = input.as_object() else {
        return err("INVALID_ARGUMENT", "Browser request is invalid");
    };
    let Some(thread_id) = object
        .get("threadId")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty() && value.len() <= 256)
    else {
        return err("INVALID_ARGUMENT", "Browser thread ID is invalid");
    };
    let Some(workspace_value) = object.get("workspacePath").and_then(Value::as_str) else {
        return err("INVALID_ARGUMENT", "Browser workspace is invalid");
    };
    let workspace = match resolve_workspace(state, Some(workspace_value)) {
        Ok(path) => path,
        Err(error) => return err("NOT_AUTHORIZED", error),
    };
    let Some(requested_model) = object
        .get("model")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty() && value.len() <= 256)
    else {
        return err("INVALID_ARGUMENT", "Browser model is invalid");
    };
    let requested_effort = object
        .get("reasoningEffort")
        .and_then(Value::as_str)
        .map(str::to_owned);
    let (model, reasoning_effort) =
        match resolve_model_selection(Some(requested_model.to_owned()), requested_effort) {
            Ok(selection) => selection,
            Err(error) => return err("INVALID_ARGUMENT", error),
        };
    let api_key = state
        .credentials
        .lock()
        .unwrap()
        .session_key
        .clone()
        .or_else(|| env::var("OPENROUTER_API_KEY").ok())
        .filter(|value| !value.trim().is_empty());
    let Some(api_key) = api_key else {
        return err(
            "CREDENTIAL_MISSING",
            "Configure an OpenRouter API key before starting browser automation",
        );
    };
    let request = json!({
        "threadId": thread_id,
        "workspacePath": workspace.to_string_lossy(),
        "model": model,
        "reasoningEffort": reasoning_effort,
        "provider": {"kind": "openrouter", "apiKey": api_key, "model": model}
    });
    let mut command = json!({"type": kind, "request": request});
    if let Some(value) = object.get("url") {
        command["url"] = value.clone();
    }
    if let Some(value) = object.get("action") {
        command["action"] = value.clone();
    }

    let response = match state.agent.request_browser(app, command) {
        Ok(value) => value,
        Err(error) => return err("BROWSER_UNAVAILABLE", error),
    };
    if response.get("ok").and_then(Value::as_bool) != Some(true) {
        let message = response
            .get("error")
            .and_then(|value| value.get("message"))
            .and_then(Value::as_str)
            .unwrap_or("The browser operation failed");
        return err("BROWSER_UNAVAILABLE", message);
    }
    ok(response.get("state").cloned().unwrap_or(Value::Null))
}
