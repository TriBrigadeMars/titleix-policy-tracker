use std::collections::HashMap;

use crate::constants::APP_ID;

pub const INGEST_KEYRING_KEYS: [&str; 4] = [
    "CONGRESS_GOV_API_KEY",
    "OPEN_STATES_API_KEY",
    "LEGISCAN_API_KEY",
    "LEGISCAN_SESSION_ID",
];

/// Read ingest API keys stored under service `org.titleixpolicytracker.desktop`
/// from the OS keyring (Freedesktop Secret Service on Arch/Ubuntu/Fedora,
/// Keychain on macOS, Credential Manager on Windows). Missing keys are omitted.
pub fn read_ingest_keys_from_keyring() -> HashMap<String, String> {
    let mut env_map = HashMap::new();
    for key_name in INGEST_KEYRING_KEYS {
        if let Ok(entry) = keyring::Entry::new(APP_ID, key_name) {
            if let Ok(secret) = entry.get_password() {
                let trimmed = secret.trim();
                if !trimmed.is_empty() {
                    env_map.insert(key_name.to_string(), trimmed.to_string());
                }
            }
        }
    }
    env_map
}
