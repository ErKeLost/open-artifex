use std::env;
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::state::{AppState, WorkspaceState};
use crate::types::WorkspaceSelection;

pub fn initial_state() -> WorkspaceState {
    let default_path = project_root();
    let legacy_default_path = dirs::document_dir().map(|path| path.join("Open Artifex Workspace"));

    let storage_path = workspace_storage_path();
    let persisted = fs::read_to_string(&storage_path)
        .ok()
        .and_then(|value| serde_json::from_str::<PersistedWorkspaceState>(&value).ok());
    let persisted_default_is_legacy = persisted
        .as_ref()
        .and_then(|value| value.default_path.as_ref())
        .is_some_and(|path| {
            legacy_default_path
                .as_ref()
                .map(|legacy| Path::new(path) == legacy)
                .unwrap_or(false)
        });
    let default_path = persisted
        .as_ref()
        .and_then(|value| value.default_path.as_ref())
        .filter(|path| {
            legacy_default_path
                .as_ref()
                .map(|legacy| Path::new(path) != legacy)
                .unwrap_or(true)
        })
        .map(PathBuf::from)
        .unwrap_or(default_path);
    let mut state = WorkspaceState {
        default_path,
        allowed: Default::default(),
        recent: Vec::new(),
        storage_path,
    };
    let mut migrated_legacy_workspace = persisted_default_is_legacy;
    let _ = std::fs::create_dir_all(&state.default_path);
    if let Ok(path) = canonical_directory(&state.default_path) {
        state.allowed.insert(path);
    }
    for path in persisted
        .map(|value| value.recent_paths)
        .unwrap_or_default()
    {
        if legacy_default_path
            .as_ref()
            .map(|legacy| Path::new(&path) == legacy)
            .unwrap_or(false)
        {
            migrated_legacy_workspace = true;
            continue;
        }
        if let Ok(path) = canonical_directory(path) {
            remember(&mut state, path, false);
        }
    }
    if let Ok(path) = canonical_directory(&state.default_path) {
        remember(&mut state, path, false);
    }
    if migrated_legacy_workspace {
        // Migrate app state only. The legacy directory remains untouched on disk.
        let _ = persist(&state);
    }
    state
}

fn project_root() -> PathBuf {
    let current = env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    if current.file_name().is_some_and(|name| name == "src-tauri") {
        return current.parent().unwrap_or(&current).to_path_buf();
    }
    current
}

pub fn canonical_directory(path: impl AsRef<Path>) -> Result<PathBuf, String> {
    let path = std::fs::canonicalize(path).map_err(|error| error.to_string())?;
    if !path.is_dir() {
        return Err("Workspace path is not a directory".into());
    }
    if path.parent().is_none() {
        return Err("The filesystem root cannot be used as a workspace".into());
    }
    Ok(path)
}

pub fn resolve_workspace(state: &AppState, path: Option<&str>) -> Result<PathBuf, String> {
    let requested = path
        .map(PathBuf::from)
        .unwrap_or_else(|| state.workspace.lock().unwrap().default_path.clone());
    let canonical = canonical_directory(requested)?;
    if !state.workspace.lock().unwrap().allowed.contains(&canonical) {
        return Err("Select the workspace with the native directory picker before using it".into());
    }
    Ok(canonical)
}

pub fn activate(state: &AppState, path: &str) -> Result<WorkspaceSelection, String> {
    let canonical = canonical_directory(path)?;
    let mut workspaces = state.workspace.lock().unwrap();
    if !workspaces.allowed.contains(&canonical) {
        return Err("Workspace is not authorized".into());
    }
    workspaces.default_path = canonical.clone();
    remember_selection(&mut workspaces, canonical.clone())?;
    Ok(selection_for(&canonical))
}

pub fn selection_for(path: &Path) -> WorkspaceSelection {
    WorkspaceSelection {
        path: path.to_string_lossy().into(),
        name: path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("Workspace")
            .into(),
    }
}

pub fn list(state: &AppState) -> Vec<WorkspaceSelection> {
    state
        .workspace
        .lock()
        .unwrap()
        .recent
        .iter()
        .map(|path| selection_for(path))
        .collect()
}

pub fn remember_selection(state: &mut WorkspaceState, path: PathBuf) -> Result<(), String> {
    remember(state, path, true);
    persist(state)
}

fn remember(state: &mut WorkspaceState, path: PathBuf, allow: bool) {
    if allow {
        state.allowed.insert(path.clone());
    }
    state.recent.retain(|existing| existing != &path);
    state.recent.insert(0, path);
    state.recent.truncate(12);
}

fn workspace_storage_path() -> PathBuf {
    dirs::data_local_dir()
        .or_else(dirs::config_dir)
        .unwrap_or_else(|| PathBuf::from("."))
        .join("Open Artifex")
        .join("workspaces.json")
}

fn persist(state: &WorkspaceState) -> Result<(), String> {
    let directory = state
        .storage_path
        .parent()
        .ok_or_else(|| "Workspace storage path is invalid".to_string())?;
    fs::create_dir_all(directory).map_err(|error| error.to_string())?;
    let value = PersistedWorkspaceState {
        default_path: Some(state.default_path.to_string_lossy().into()),
        recent_paths: state
            .recent
            .iter()
            .map(|path| path.to_string_lossy().into())
            .collect(),
    };
    let temporary = state.storage_path.with_extension("json.tmp");
    fs::write(
        &temporary,
        serde_json::to_vec_pretty(&value).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;
    fs::rename(&temporary, &state.storage_path).map_err(|error| error.to_string())
}

#[derive(Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct PersistedWorkspaceState {
    default_path: Option<String>,
    recent_paths: Vec<String>,
}
