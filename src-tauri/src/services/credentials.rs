use std::env;

use keyring::{Entry, Error};

use crate::state::CredentialState;
use crate::types::CredentialStatus;

const SERVICE: &str = "Open Artifex";
const ACCOUNT: &str = "openrouter-api-key";

pub fn status(state: &CredentialState) -> CredentialStatus {
    let secure_storage_available = entry().is_ok();
    let source = if read_secure().ok().flatten().is_some() {
        "safe-storage"
    } else if state.session_key.is_some() {
        "session"
    } else if environment_key().is_some() {
        "environment"
    } else {
        "missing"
    };
    CredentialStatus {
        configured: source != "missing",
        secure_storage_available,
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

pub fn set(state: &mut CredentialState, api_key: String) -> Result<CredentialStatus, String> {
    // Keychain reads can lag behind a successful write. Keep the submitted key
    // for this session so the immediate verification always has a credential.
    let _ = entry().and_then(|entry| entry.set_password(&api_key).map_err(keyring_error));
    state.session_key = Some(api_key);
    Ok(status(state))
}

pub fn clear(state: &mut CredentialState) -> Result<CredentialStatus, String> {
    state.session_key = None;
    let entry = entry()?;
    match entry.delete_credential() {
        Ok(()) | Err(Error::NoEntry) => Ok(status(state)),
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
