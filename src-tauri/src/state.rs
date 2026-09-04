use crate::services::agent::AgentBridge;
use portable_pty::{Child as PtyChild, MasterPty};
use std::collections::{HashMap, HashSet};
use std::io::Write;
use std::path::PathBuf;
use std::sync::atomic::AtomicU64;
use std::sync::{Arc, Mutex};

#[derive(Default)]
pub struct WorkspaceState {
    pub default_path: PathBuf,
    pub allowed: HashSet<PathBuf>,
    pub recent: Vec<PathBuf>,
    pub storage_path: PathBuf,
}

#[derive(Default)]
pub struct CredentialState {
    pub session_key: Option<String>,
}

pub struct TerminalRecord {
    pub child: Box<dyn PtyChild + Send + Sync>,
    pub master: Box<dyn MasterPty + Send>,
    pub writer: Box<dyn Write + Send>,
    pub output: Arc<Mutex<String>>,
    pub sequence: Arc<AtomicU64>,
    pub cols: u16,
    pub rows: u16,
}

pub struct AppState {
    pub workspace: Mutex<WorkspaceState>,
    pub credentials: Mutex<CredentialState>,
    pub agent: AgentBridge,
    pub terminals: Mutex<HashMap<String, TerminalRecord>>,
}
