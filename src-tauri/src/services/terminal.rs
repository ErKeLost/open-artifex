use std::io::{Read, Write};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;

use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use serde_json::json;
use tauri::{AppHandle, Emitter, State};

use crate::services::workspace::resolve_workspace;
use crate::services::{err, ok};
use crate::state::{AppState, TerminalRecord};
use crate::types::{
    DesktopResult, TerminalCreateInput, TerminalKillInput, TerminalResizeInput, TerminalSession,
    TerminalSessionInput, TerminalSnapshot, TerminalWriteInput,
};

const TERMINAL_EVENT: &str = "terminal:event";
const MAX_OUTPUT_BYTES: usize = 512 * 1024;
const MAX_INPUT_BYTES: usize = 1_000_000;

pub fn create<R: tauri::Runtime>(
    app: AppHandle<R>,
    input: Option<TerminalCreateInput>,
    state: State<'_, AppState>,
) -> DesktopResult<TerminalSession> {
    let input = input.unwrap_or_default();
    let workspace_path = match resolve_workspace(&state, input.workspace_path.as_deref()) {
        Ok(path) => path,
        Err(error) => return err("NOT_AUTHORIZED", error),
    };
    let session_id = input
        .session_id
        .unwrap_or_else(|| crate::services::new_id("terminal"));
    let cols = input.cols.unwrap_or(120).clamp(1, 1_000);
    let rows = input.rows.unwrap_or(32).clamp(1, 1_000);
    let shell = default_shell();

    let pty_system = native_pty_system();
    let pair = match pty_system.openpty(PtySize {
        rows,
        cols,
        pixel_width: 0,
        pixel_height: 0,
    }) {
        Ok(pair) => pair,
        Err(error) => return err("TERMINAL_UNAVAILABLE", error.to_string()),
    };
    let mut command = CommandBuilder::new(&shell);
    command.args(shell_arguments(&shell));
    command.cwd(&workspace_path);
    command.env("TERM", "xterm-256color");
    command.env("COLORTERM", "truecolor");
    let child = match pair.slave.spawn_command(command) {
        Ok(child) => child,
        Err(error) => return err("TERMINAL_UNAVAILABLE", error.to_string()),
    };
    let pid = child.process_id().unwrap_or_default();
    let reader = match pair.master.try_clone_reader() {
        Ok(reader) => reader,
        Err(error) => return err("TERMINAL_UNAVAILABLE", error.to_string()),
    };
    let writer = match pair.master.take_writer() {
        Ok(writer) => writer,
        Err(error) => return err("TERMINAL_UNAVAILABLE", error.to_string()),
    };
    let master = pair.master;
    let output = Arc::new(Mutex::new(String::new()));
    let sequence = Arc::new(AtomicU64::new(0));
    spawn_reader(
        app.clone(),
        session_id.clone(),
        reader,
        output.clone(),
        sequence.clone(),
    );

    state.terminals.lock().unwrap().insert(
        session_id.clone(),
        TerminalRecord {
            child,
            master,
            writer,
            output,
            sequence,
            cols,
            rows,
        },
    );

    ok(TerminalSession {
        session_id,
        workspace_path: workspace_path.to_string_lossy().into(),
        shell,
        pid,
        cols,
        rows,
        status: "running".into(),
    })
}

pub fn write(input: TerminalWriteInput, state: State<'_, AppState>) -> DesktopResult<()> {
    if input.data.len() > MAX_INPUT_BYTES {
        return err("INVALID_ARGUMENT", "Terminal input is too large");
    }
    let mut terminals = state.terminals.lock().unwrap();
    let Some(record) = terminals.get_mut(&input.session_id) else {
        return err("TERMINAL_UNAVAILABLE", "Terminal session is unavailable");
    };
    match record
        .writer
        .write_all(input.data.as_bytes())
        .and_then(|_| record.writer.flush())
    {
        Ok(()) => ok(()),
        Err(error) => err("TERMINAL_UNAVAILABLE", error.to_string()),
    }
}

pub fn resize(input: TerminalResizeInput, state: State<'_, AppState>) -> DesktopResult<()> {
    if input.cols == 0 || input.rows == 0 || input.cols > 1_000 || input.rows > 1_000 {
        return err("INVALID_ARGUMENT", "Terminal dimensions are invalid");
    }
    let mut terminals = state.terminals.lock().unwrap();
    let Some(record) = terminals.get_mut(&input.session_id) else {
        return err("TERMINAL_UNAVAILABLE", "Terminal session is unavailable");
    };
    record.cols = input.cols;
    record.rows = input.rows;
    if let Err(error) = record.master.resize(PtySize {
        rows: input.rows,
        cols: input.cols,
        pixel_width: 0,
        pixel_height: 0,
    }) {
        return err("TERMINAL_UNAVAILABLE", error.to_string());
    }
    ok(())
}

pub fn kill(input: TerminalKillInput, state: State<'_, AppState>) -> DesktopResult<()> {
    let mut terminals = state.terminals.lock().unwrap();
    if let Some(mut record) = terminals.remove(&input.session_id) {
        let _ = input.signal;
        let _ = record.child.kill();
    }
    ok(())
}

pub fn subscribe(
    input: TerminalSessionInput,
    state: State<'_, AppState>,
) -> DesktopResult<TerminalSnapshot> {
    let mut terminals = state.terminals.lock().unwrap();
    let Some(record) = terminals.get_mut(&input.session_id) else {
        return err("TERMINAL_UNAVAILABLE", "Terminal session is unavailable");
    };
    let status = match record.child.try_wait() {
        Ok(Some(_)) => "exited",
        _ => "running",
    };
    let data = record.output.lock().unwrap().clone();
    ok(TerminalSnapshot {
        session_id: input.session_id,
        data,
        sequence: record.sequence.load(Ordering::Relaxed).saturating_sub(1),
        status: status.into(),
    })
}

fn default_shell() -> String {
    if cfg!(target_os = "windows") {
        std::env::var("ComSpec").unwrap_or_else(|_| "cmd.exe".into())
    } else {
        std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".into())
    }
}

fn shell_arguments(shell: &str) -> &'static [&'static str] {
    if cfg!(target_os = "windows") {
        return &[];
    }
    match std::path::Path::new(shell)
        .file_name()
        .and_then(|name| name.to_str())
    {
        Some("zsh") => &["-f", "-i"],
        Some("bash") => &["--noprofile", "--norc", "-i"],
        Some("fish") => &["--no-config", "-i"],
        _ => &["-i"],
    }
}

fn spawn_reader<R: tauri::Runtime>(
    app: AppHandle<R>,
    session_id: String,
    stream: impl Read + Send + 'static,
    output: Arc<Mutex<String>>,
    sequence: Arc<AtomicU64>,
) {
    thread::spawn(move || {
        let mut reader = stream;
        let mut buffer = [0_u8; 8 * 1024];
        loop {
            let bytes_read = match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(bytes_read) => bytes_read,
                Err(_) => break,
            };
            // Read raw chunks instead of lines. Shell prompts do not end with
            // a newline, and waiting for one makes an interactive terminal
            // appear blank until the first command is submitted.
            let data = String::from_utf8_lossy(&buffer[..bytes_read]).into_owned();
            {
                let mut previous = output.lock().unwrap();
                previous.push_str(&data);
                if previous.len() > MAX_OUTPUT_BYTES {
                    let start = previous.len() - MAX_OUTPUT_BYTES;
                    previous.drain(..start);
                }
            }
            let next = sequence.fetch_add(1, Ordering::Relaxed);
            let _ = app.emit(
                TERMINAL_EVENT,
                json!({"type":"data","sessionId":session_id,"data":data,"sequence":next,"timestamp":crate::services::timestamp()}),
            );
        }
    });
}
