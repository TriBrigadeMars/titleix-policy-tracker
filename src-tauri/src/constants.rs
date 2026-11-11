pub const APP_ID: &str = "org.titleixpolicytracker.desktop";
pub const APP_NAME: &str = "Title IX Policy Tracker";
pub const LOCAL_SCHEME: &str = "app";
pub const LOCAL_HOST: &str = "tracker";
pub const LOCAL_APP_URL: &str = "app://tracker";

pub const DESKTOP_MIN_WIDTH: f64 = 1000.0;
pub const DESKTOP_MIN_HEIGHT: f64 = 700.0;
pub const DESKTOP_DEFAULT_WIDTH: f64 = 1400.0;
pub const DESKTOP_DEFAULT_HEIGHT: f64 = 900.0;

pub fn resolve_app_url(
    is_packaged: bool,
    desktop_app_url: Option<&str>,
    desktop_mode: Option<&str>,
) -> Result<String, String> {
    if !is_packaged {
        if desktop_mode == Some("local") {
            return Ok(LOCAL_APP_URL.to_string());
        }
        return Ok("http://localhost:3000".to_string());
    }

    let trimmed = desktop_app_url.map(str::trim).unwrap_or("");
    if trimmed.is_empty() || desktop_mode == Some("local") {
        return Ok(LOCAL_APP_URL.to_string());
    }

    if !trimmed.starts_with("https://") {
        return Err(format!(
            "DESKTOP_APP_URL must use https:// when overriding local mode; got {trimmed}"
        ));
    }

    Ok(trimmed.to_string())
}

pub fn url_origin(raw_url: &str) -> Option<String> {
    let parsed = url::Url::parse(raw_url).ok()?;
    match parsed.scheme() {
        "http" | "https" => {
            let host = parsed.host_str()?;
            match parsed.port() {
                Some(port) => Some(format!("{}://{}:{}", parsed.scheme(), host, port)),
                None => Some(format!("{}://{}", parsed.scheme(), host)),
            }
        }
        LOCAL_SCHEME => {
            if parsed.host_str() == Some(LOCAL_HOST) && parsed.port().is_none() {
                Some(LOCAL_APP_URL.to_string())
            } else {
                None
            }
        }
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_packaged_to_local_app_scheme() {
        assert_eq!(resolve_app_url(true, None, None).unwrap(), "app://tracker");
        assert_eq!(
            resolve_app_url(false, Some("https://prod.example.org"), None).unwrap(),
            "http://localhost:3000"
        );
        assert!(resolve_app_url(true, Some("http://insecure.example.org"), None).is_err());
    }

    #[test]
    fn normalizes_custom_scheme_and_https_origins() {
        assert_eq!(
            url_origin("app://tracker/triage?status=PROPOSED").as_deref(),
            Some("app://tracker")
        );
        assert_eq!(url_origin("app://evil/triage"), None);
        assert_eq!(
            url_origin("https://congress.gov/bill/119").as_deref(),
            Some("https://congress.gov")
        );
    }
}
