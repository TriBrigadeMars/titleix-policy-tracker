use crate::constants::{LOCAL_APP_URL, LOCAL_HOST, LOCAL_SCHEME};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum UrlAction {
    Allow,
    OpenExternal,
    Block,
}

pub fn classify_url(
    raw_url: &str,
    app_origin: &str,
    auth_origins: &[String],
    auth_active: bool,
) -> UrlAction {
    if raw_url.is_empty() {
        return UrlAction::Block;
    }

    let parsed = match url::Url::parse(raw_url) {
        Ok(u) => u,
        Err(_) => return UrlAction::Block,
    };

    if parsed.scheme() == LOCAL_SCHEME {
        if parsed.host_str() == Some(LOCAL_HOST)
            && parsed.port().is_none()
            && app_origin == LOCAL_APP_URL
        {
            return UrlAction::Allow;
        }
        return UrlAction::Block;
    }

    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return UrlAction::Block;
    }

    let origin = match parsed.host_str() {
        Some(host) => match parsed.port() {
            Some(port) => format!("{}://{}:{}", parsed.scheme(), host, port),
            None => format!("{}://{}", parsed.scheme(), host),
        },
        None => return UrlAction::Block,
    };

    if origin == app_origin {
        return UrlAction::Allow;
    }

    if auth_active && auth_origins.iter().any(|allowed| allowed == &origin) {
        return UrlAction::Allow;
    }

    if parsed.scheme() == "https" {
        return UrlAction::OpenExternal;
    }

    UrlAction::Block
}

pub fn is_safe_external_url(raw_url: &str) -> bool {
    match url::Url::parse(raw_url) {
        Ok(parsed) => parsed.scheme() == "https" && parsed.host_str().is_some(),
        Err(_) => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allows_in_app_local_scheme_and_blocks_foreign_schemes() {
        assert_eq!(
            classify_url("app://tracker/heatmap", "app://tracker", &[], false),
            UrlAction::Allow
        );
        assert_eq!(
            classify_url("app://other/heatmap", "app://tracker", &[], false),
            UrlAction::Block
        );
        assert_eq!(
            classify_url("javascript:alert(1)", "app://tracker", &[], false),
            UrlAction::Block
        );
        assert_eq!(
            classify_url("file:///etc/passwd", "app://tracker", &[], false),
            UrlAction::Block
        );
    }

    #[test]
    fn opens_external_https_sources_and_blocks_plain_http() {
        assert_eq!(
            classify_url("https://www.congress.gov/bill/119", "app://tracker", &[], false),
            UrlAction::OpenExternal
        );
        assert_eq!(
            classify_url("http://localhost:3000", "app://tracker", &[], false),
            UrlAction::Block
        );
        assert!(is_safe_external_url("https://legiscan.com/TX/bill/SB15/2023"));
        assert!(!is_safe_external_url("app://tracker/admin"));
    }
}
