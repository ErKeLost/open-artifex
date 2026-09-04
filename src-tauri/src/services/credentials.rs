use std::env;

use keyring::{Entry, Error};

use crate::state::CredentialState;
use crate::types::CredentialStatus;

const SERVICE: &str = "Open Artifex";
const ACCOUNT: &str = "openrouter-api-key";

pub fn status(state: &CredentialState) -> CredentialStatus {
    // Prefer the submitted session credential. A keychain read immediately
    // after set_password can block or lag on macOS and is not needed to report
    // the state of the current process.
    let source = if state.session_key.is_some() {
        "session"
    } else if read_secure().ok().flatten().is_some() {
        "safe-storage"
    } else if environment_key().is_some() {
        "environment"
    } else {
        "missing"
    };
    CredentialStatus {
        configured: source != "missing",
        // A successful secure read proves availability. For session and
        // environment credentials, storage availability is intentionally not
        // probed synchronously.
        secure_storage_available: source == "safe-storage" || source == "session",
        source: source.into(),
    }
}

/// Returns the status that can be computed without touching the OS credential
/// provider. Save and clear commands use this variant so a slow Keychain never
/// blocks an interactive request.
fn session_status(state: &CredentialState) -> CredentialStatus {
    let source = if state.session_key.is_some() {
        "session"
    } else if environment_key().is_some() {
        "environment"
    } else {
        "missing"
    };
    CredentialStatus {
        configured: source != "missing",
        // A session credential is immediately usable; secure persistence is
        // attempted in the background and must not delay this response.
        secure_storage_available: state.session_key.is_some(),
        source: source.into(),
    }
}

pub fn resolve(state: &CredentialState) -> Option<String> {
    state
        .session_key
        .clone()
        .or_else(|| read_secure().ok().flatten())
        .or_else(environment_key)
}

pub fn set_session(state: &mut CredentialState, api_key: String) -> CredentialStatus {
    // Keep the submitted key in process before any best-effort secure-storage
    // work. This keeps verification responsive when macOS Keychain is slow.
    state.session_key = Some(api_key);
    session_status(state)
}

pub fn clear_session(state: &mut CredentialState) -> CredentialStatus {
    state.session_key = None;
    session_status(state)
}

pub fn persist_secure(api_key: &str) {
    let _ = entry().and_then(|entry| entry.set_password(api_key).map_err(keyring_error));
}

pub fn clear_secure() -> Result<(), String> {
    let entry = entry()?;
    match entry.delete_credential() {
        Ok(()) | Err(Error::NoEntry) => Ok(()),
        Err(error) => Err(keyring_error(error)),
    }
}

fn entry() -> Result<Entry, String> {
    Entry::new(SERVICE, ACCOUNT).map_err(keyring_error)
}

fn read_secure() -> Result<Option<String>, String> {
    let entry = entry()?;
    match entry.get_password() {
        Ok(value) if !value.trim().is_empty() => Ok(Some(value)),
        Ok(_) | Err(Error::NoEntry) => Ok(None),
        Err(error) => Err(keyring_error(error)),
    }
}

fn environment_key() -> Option<String> {
    env::var("OPENROUTER_API_KEY")
        .ok()
        .filter(|value| !value.trim().is_empty())
}

fn keyring_error(error: Error) -> String {
    format!("System credential storage is unavailable: {error}")
}
