use std::collections::HashMap;
use std::env;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, Command, Stdio};
use std::sync::mpsc::{self, Sender};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};

const AGENT_EVENT: &str = "agent:event";
const BROWSER_EVENT: &str = "browser:event";

/// Owns the long-running Node/Bun Mastra host and its browser request replies.
pub struct AgentBridge {
    child: Mutex<Option<Child>>,
    pending_browser: Arc<Mutex<HashMap<String, Sender<Value>>>>,
    pending_schedule: Arc<Mutex<HashMap<String, Sender<Value>>>>,
    pending_conversation: Arc<Mutex<HashMap<String, Sender<Value>>>>,
}

impl Default for AgentBridge {
    fn default() -> Self {
        Self {
            child: Mutex::new(None),
            pending_browser: Arc::new(Mutex::new(HashMap::new())),
            pending_schedule: Arc::new(Mutex::new(HashMap::new())),
            pending_conversation: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

impl AgentBridge {
    pub fn send<R: tauri::Runtime>(
        &self,
        app: &AppHandle<R>,
        message: Value,
    ) -> Result<(), String> {
        self.ensure_started(app)?;
        let mut guard = self
            .child
            .lock()
            .map_err(|_| "Agent bridge lock poisoned".to_string())?;
        let child = guard
            .as_mut()
            .ok_or_else(|| "Agent process is unavailable".to_string())?;
        let stdin = child
            .stdin
            .as_mut()
            .ok_or_else(|| "Agent process stdin is unavailable".to_string())?;

        serde_json::to_writer(&mut *stdin, &message).map_err(|error| error.to_string())?;
        stdin
            .write_all(b"\n")
            .and_then(|_| stdin.flush())
            .map_err(|error| error.to_string())
    }

    pub fn request_browser<R: tauri::Runtime>(
        &self,
        app: &AppHandle<R>,
        command: Value,
    ) -> Result<Value, String> {
        let request_id = crate::services::new_id("browser");
        let (sender, receiver) = mpsc::channel();
        self.pending_browser
            .lock()
            .map_err(|_| "Browser request lock poisoned".to_string())?
            .insert(request_id.clone(), sender);

        let message = json!({
            "version": 1,
            "type": "browser.command",
            "requestId": request_id,
            "command": command,
        });
        if let Err(error) = self.send(app, message) {
            self.pending_browser
                .lock()
                .ok()
                .and_then(|mut pending| pending.remove(&request_id));
            return Err(error);
        }

        receiver
            .recv_timeout(Duration::from_secs(60))
            .map_err(|_| "Browser operation timed out".to_string())
    }

    pub fn request_schedule<R: tauri::Runtime>(
        &self,
        app: &AppHandle<R>,
        command: Value,
    ) -> Result<Value, String> {
        let request_id = crate::services::new_id("schedule");
        let (sender, receiver) = mpsc::channel();
        self.pending_schedule
            .lock()
            .map_err(|_| "Schedule request lock poisoned".to_string())?
            .insert(request_id.clone(), sender);
        let message = json!({
            "version": 1,
            "type": "schedule.command",
            "requestId": request_id,
            "command": command,
        });
        if let Err(error) = self.send(app, message) {
            self.pending_schedule
                .lock()
                .ok()
                .and_then(|mut pending| pending.remove(&request_id));
            return Err(error);
        }
        receiver
            .recv_timeout(Duration::from_secs(60))
            .map_err(|_| "Schedule operation timed out".to_string())
    }

    pub fn request_conversation<R: tauri::Runtime>(
        &self,
        app: &AppHandle<R>,
        command: Value,
    ) -> Result<Value, String> {
        let request_id = crate::services::new_id("conversation");
        let (sender, receiver) = mpsc::channel();
        self.pending_conversation
            .lock()
            .map_err(|_| "Conversation request lock poisoned".to_string())?
            .insert(request_id.clone(), sender);
        let message = json!({
            "version": 1,
            "type": "conversation.command",
            "requestId": request_id,
            "command": command,
        });
        if let Err(error) = self.send(app, message) {
            self.pending_conversation
                .lock()
                .ok()
                .and_then(|mut pending| pending.remove(&request_id));
            return Err(error);
        }
        receiver
            .recv_timeout(Duration::from_secs(60))
            .map_err(|_| "Conversation operation timed out".to_string())
    }

    pub fn stop(&self) {
        if let Ok(mut guard) = self.child.lock() {
            if let Some(mut child) = guard.take() {
                let _ = child.kill();
            }
        }
    }

    fn ensure_started<R: tauri::Runtime>(&self, app: &AppHandle<R>) -> Result<(), String> {
        let mut guard = self
            .child
            .lock()
            .map_err(|_| "Agent bridge lock poisoned".to_string())?;

        if guard
            .as_mut()
            .and_then(|child| child.try_wait().ok())
            .flatten()
            .is_none()
            && guard.is_some()
        {
            return Ok(());
        }

        let (program, args) = agent_command()?;
        let mut command = Command::new(program);
        command
            .args(args)
            .current_dir(env::current_dir().map_err(|error| error.to_string())?)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());

        let mut child = command
            .spawn()
            .map_err(|error| format!("Unable to start agent process: {error}"))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "Agent process stdout is unavailable".to_string())?;
        let app_handle = app.clone();
        let pending_browser = self.pending_browser.clone();
        let pending_schedule = self.pending_schedule.clone();
        let pending_conversation = self.pending_conversation.clone();

        thread::spawn(move || {
            for line in BufReader::new(stdout).lines().flatten() {
                let Ok(value) = serde_json::from_str::<Value>(&line) else {
                    continue;
                };

                match value.get("type").and_then(Value::as_str) {
                    Some("agent.event") => {
                        if let Some(event) = value.get("event") {
                            let _ = app_handle.emit(AGENT_EVENT, event);
                        }
                    }
                    Some("browser.event") => {
                        if let Some(event) = value.get("event") {
                            let _ = app_handle.emit(BROWSER_EVENT, event);
                        }
                    }
                    Some("browser.response") => {
                        let response = value.get("response").cloned().unwrap_or(Value::Null);
                        if let Some(id) = response.get("requestId").and_then(Value::as_str) {
                            if let Ok(mut pending) = pending_browser.lock() {
                                if let Some(sender) = pending.remove(id) {
                                    let _ = sender.send(response);
                                }
                            }
                        }
                    }
                    Some("schedule.response") => {
                        if let Some(id) = value.get("requestId").and_then(Value::as_str) {
                            if let Ok(mut pending) = pending_schedule.lock() {
                                if let Some(sender) = pending.remove(id) {
                                    let _ = sender.send(value);
                                }
                            }
                        }
                    }
                    Some("conversation.response") => {
                        if let Some(id) = value.get("requestId").and_then(Value::as_str) {
                            if let Ok(mut pending) = pending_conversation.lock() {
                                if let Some(sender) = pending.remove(id) {
                                    let _ = sender.send(value);
                                }
                            }
                        }
                    }
                    Some("agent.worker.error") => {
                        if let Some(run_id) = value.get("runId").and_then(Value::as_str) {
                            let event = json!({
                                "id": crate::services::new_id("event"),
                                "runId": run_id,
                                "sequence": crate::services::timestamp(),
                                "timestamp": crate::services::timestamp(),
                                "type": "run.failed",
                                "payload": {"error": value.get("error").cloned().unwrap_or_else(|| json!({
                                    "code": "AGENT_WORKER_ERROR",
                                    "message": "Agent worker failed",
                                    "retryable": true
                                }))}
                            });
                            let _ = app_handle.emit(AGENT_EVENT, event);
                        }
                    }
                    _ => {}
                }
            }
        });

        *guard = Some(child);
        Ok(())
    }
}

fn agent_command() -> Result<(String, Vec<String>), String> {
    if let Ok(command) = env::var("OPEN_ARTIFEX_AGENT_COMMAND") {
        let mut parts = command.split_whitespace();
        let program = parts.next().unwrap_or("bun").to_string();
        return Ok((program, parts.map(str::to_string).collect()));
    }

    if cfg!(debug_assertions) {
        return Ok((
            "bun".into(),
            vec!["run".into(), "src/agent/stdio-worker.ts".into()],
        ));
    }

    let executable = env::current_exe().map_err(|error| error.to_string())?;
    let directory = executable
        .parent()
        .ok_or_else(|| "Application executable path is invalid".to_string())?;
    let sidecar = directory.join(format!("open-artifex-agent{}", env::consts::EXE_SUFFIX));
    if sidecar.is_file() {
        return Ok((sidecar.to_string_lossy().into_owned(), Vec::new()));
    }
    Err("The bundled agent process is missing from this application package".into())
}
