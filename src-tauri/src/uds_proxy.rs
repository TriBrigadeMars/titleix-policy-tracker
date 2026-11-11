use std::path::Path;

use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};

const AUTH_SESSION_COOKIE: &str = "authjs.session-token";
const SECURE_AUTH_SESSION_COOKIE: &str = "__Secure-authjs.session-token";

pub fn merge_session_cookie(existing: Option<&str>, session_token: &str) -> String {
    let mut parts: Vec<String> = Vec::new();
    parts.push(format!("{AUTH_SESSION_COOKIE}={session_token}"));

    if let Some(raw) = existing {
        for piece in raw.split(';') {
            let trimmed = piece.trim();
            if trimmed.is_empty() {
                continue;
            }
            let name = trimmed
                .split_once('=')
                .map(|(n, _)| n.trim())
                .unwrap_or(trimmed);
            if name != AUTH_SESSION_COOKIE && name != SECURE_AUTH_SESSION_COOKIE {
                parts.push(trimmed.to_string());
            }
        }
    }

    parts.join("; ")
}

#[cfg(unix)]
pub async fn forward_over_unix_socket(
    socket_path: &Path,
    request: http::Request<Vec<u8>>,
    session_token: &str,
) -> Result<http::Response<Vec<u8>>, String> {
    let stream = tokio::net::UnixStream::connect(socket_path)
        .await
        .map_err(|e| format!("UDS connect error ({}): {e}", socket_path.display()))?;

    let (read_half, mut write_half) = stream.into_split();
    let path_and_query = request
        .uri()
        .path_and_query()
        .map(|pq| pq.as_str())
        .unwrap_or("/");

    let mut raw_req = format!("{} {} HTTP/1.1\r\nHost: tracker\r\nConnection: close\r\n", request.method(), path_and_query);
    let mut existing_cookie: Option<String> = None;

    for (name, val) in request.headers() {
        let lower = name.as_str().to_ascii_lowercase();
        if lower == "host" || lower == "connection" || lower == "content-length" {
            continue;
        }
        if lower == "cookie" {
            if let Ok(s) = val.to_str() {
                existing_cookie = Some(s.to_string());
            }
            continue;
        }
        if let Ok(s) = val.to_str() {
            raw_req.push_str(&format!("{}: {}\r\n", name.as_str(), s));
        }
    }

    let cookie = merge_session_cookie(existing_cookie.as_deref(), session_token);
    raw_req.push_str(&format!("Cookie: {cookie}\r\n"));

    let body = request.body();
    if !body.is_empty() {
        raw_req.push_str(&format!("Content-Length: {}\r\n", body.len()));
    }
    raw_req.push_str("\r\n");

    write_half
        .write_all(raw_req.as_bytes())
        .await
        .map_err(|e| format!("UDS write header error: {e}"))?;
    if !body.is_empty() {
        write_half
            .write_all(body)
            .await
            .map_err(|e| format!("UDS write body error: {e}"))?;
    }

    let mut reader = BufReader::new(read_half);
    let mut status_line = String::new();
    reader
        .read_line(&mut status_line)
        .await
        .map_err(|e| format!("UDS read status error: {e}"))?;

    let status_code: u16 = status_line
        .split_whitespace()
        .nth(1)
        .and_then(|s| s.parse::<u16>().ok())
        .unwrap_or(502);

    let mut builder = http::Response::builder().status(status_code);
    let mut is_chunked = false;

    loop {
        let mut line = String::new();
        let n = reader
            .read_line(&mut line)
            .await
            .map_err(|e| format!("UDS read header error: {e}"))?;
        if n == 0 || line == "\r\n" || line == "\n" {
            break;
        }
        if let Some((k, v)) = line.split_once(':') {
            let key_trim = k.trim();
            let val_trim = v.trim();
            let lower = key_trim.to_ascii_lowercase();
            if lower == "set-cookie" || lower == "connection" {
                continue;
            }
            if lower == "transfer-encoding" && val_trim.to_ascii_lowercase().contains("chunked") {
                is_chunked = true;
                continue;
            }
            builder = builder.header(key_trim, val_trim);
        }
    }

    let response_body = if is_chunked {
        decode_chunked_body(&mut reader).await?
    } else {
        let mut buf = Vec::new();
        reader
            .read_to_end(&mut buf)
            .await
            .map_err(|e| format!("UDS read body error: {e}"))?;
        buf
    };

    builder
        .body(response_body)
        .map_err(|e| format!("Response build error: {e}"))
}

#[cfg(unix)]
async fn decode_chunked_body<R: tokio::io::AsyncBufRead + Unpin>(
    reader: &mut R,
) -> Result<Vec<u8>, String> {
    let mut out = Vec::new();
    loop {
        let mut size_line = String::new();
        reader
            .read_line(&mut size_line)
            .await
            .map_err(|e| format!("Chunk size read error: {e}"))?;
        let hex_part = size_line
            .trim()
            .split(';')
            .next()
            .unwrap_or("0");
        let chunk_len = usize::from_str_radix(hex_part, 16)
            .map_err(|e| format!("Invalid chunk length '{hex_part}': {e}"))?;
        if chunk_len == 0 {
            let mut trailer = String::new();
            let _ = reader.read_line(&mut trailer).await;
            break;
        }
        let mut chunk = vec![0u8; chunk_len];
        reader
            .read_exact(&mut chunk)
            .await
            .map_err(|e| format!("Chunk payload read error: {e}"))?;
        out.extend_from_slice(&chunk);
        let mut crlf = [0u8; 2];
        reader
            .read_exact(&mut crlf)
            .await
            .map_err(|e| format!("Chunk CRLF read error: {e}"))?;
    }
    Ok(out)
}

#[cfg(not(unix))]
pub async fn forward_over_unix_socket(
    _socket_path: &Path,
    _request: http::Request<Vec<u8>>,
    _session_token: &str,
) -> Result<http::Response<Vec<u8>>, String> {
    Err("Unix domain socket transport requires a Unix/Linux target".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn injects_session_cookie_and_strips_forged_tokens() {
        assert_eq!(
            merge_session_cookie(None, "tok123"),
            "authjs.session-token=tok123"
        );
        assert_eq!(
            merge_session_cookie(
                Some("authjs.session-token=forged; mode=compact; __Secure-authjs.session-token=bad"),
                "tok123"
            ),
            "authjs.session-token=tok123; mode=compact"
        );
    }
}
