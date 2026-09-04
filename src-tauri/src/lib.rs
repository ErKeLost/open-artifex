mod commands;
mod services;
mod state;
mod types;

use std::sync::Mutex;

use tauri::Manager;

use crate::services::workspace;
use crate::state::{AppState, CredentialState};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let workspace_state = workspace::initial_state();
    let state = AppState {
        workspace: Mutex::new(workspace_state),
        credentials: Mutex::new(CredentialState::default()),
        agent: services::agent::AgentBridge::default(),
        terminals: Mutex::new(Default::default()),
    };

    tauri::Builder::default()
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            commands::app_info,
            commands::credential_status,
            commands::credential_set,
            commands::credential_clear,
            commands::credential_verify,
            commands::openrouter_models,
            commands::workspace_default,
            commands::workspace_select,
            commands::workspace_list,
            commands::workspace_activate,
            commands::workspace_git_overview,
            commands::plugin_list,
            commands::agent_run,
            commands::agent_cancel,
            commands::agent_resolve_approval,
            commands::browser_state,
            commands::browser_start,
            commands::browser_navigate,
            commands::browser_back,
            commands::browser_forward,
            commands::browser_reload,
            commands::browser_mouse,
            commands::browser_key,
            commands::browser_close,
            commands::terminal_create,
            commands::terminal_write,
            commands::terminal_resize,
            commands::terminal_kill,
            commands::terminal_subscribe,
            commands::conversation_list,
            commands::conversation_messages,
            commands::conversation_create,
            commands::improvement_list,
            commands::improvement_add_feedback,
            commands::improvement_create_candidate,
            commands::improvement_evaluate_candidate,
            commands::improvement_request_publication,
            commands::improvement_resolve_publication,
            commands::improvement_rollback,
            commands::schedule_list,
            commands::schedule_create,
            commands::schedule_update,
            commands::schedule_delete,
        ])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::Destroyed) {
                if let Some(state) = window.app_handle().try_state::<AppState>() {
                    state.agent.stop();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
