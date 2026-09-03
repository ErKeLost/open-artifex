pub mod agent;
pub mod credentials;
pub mod inventory;
pub mod openrouter;
pub mod terminal;
pub mod workspace;

use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;

use crate::types::{ApiError, DesktopResult};

pub fn ok<T: Serialize>(value: T) -> DesktopResult<T> {
    DesktopResult::Ok { ok: true, value }
}

pub fn err<T: Serialize>(code: &str, message: impl Into<String>) -> DesktopResult<T> {
    DesktopResult::Err {
        ok: false,
        error: ApiError {
            code: code.into(),
            message: message.into(),
        },
    }
}

pub fn timestamp() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_millis() as u64)
        .unwrap_or(0)
}

pub fn new_id(prefix: &str) -> String {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    format!(
        "{prefix}-{}-{}",
        timestamp(),
        COUNTER.fetch_add(1, Ordering::Relaxed)
    )
}
