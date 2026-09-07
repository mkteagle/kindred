//! Thin client for the household's own Kindred server.
//!
//! The desktop app never knows a fixed address: the base URL and API key are
//! whatever the member entered during onboarding (see `settings.rs`), the same
//! pair the uploader already uses. Everything below is relative to that.
//!
//! Reads are proxied rather than typed. The backend is a moving target and the
//! window code wants whole documents (`/timeline`, `/clusters/people`) that it
//! reshapes anyway, so Rust passes `serde_json::Value` through and the
//! TypeScript side owns the shapes. What Rust *does* own is the credential —
//! the API key never reaches the webview — and the path allowlist below, so a
//! compromised view layer cannot reach arbitrary URLs on the household LAN.

use std::time::Duration;

use serde_json::Value;

use crate::error::{AppError, Result};

/// Path prefixes the view layer may reach. Anything else is refused before a
/// request is made. Kept deliberately narrow: these are the endpoints the four
/// windows actually use.
const ALLOWED_PREFIXES: &[&str] = &[
    "/health",
    "/app-config",
    "/auth/me",
    "/stats",
    "/library/",
    "/timeline",
    "/clusters",
    "/detections/",
    "/search",
    "/albums",
    "/favorites",
    "/photos/",
    "/shares",
    "/events",
    "/objects",
    "/scenes",
    "/locations",
    "/duplicates",
    "/notifications",
    "/syncs",
    "/jobs/",
    "/users",
];

#[derive(Clone)]
pub struct ApiClient {
    client: reqwest::Client,
    base_url: String,
    api_key: String,
}

/// A path is acceptable when it is rooted, free of traversal, and starts with
/// one of the allowlisted prefixes.
fn check_path(path: &str) -> Result<()> {
    if !path.starts_with('/') {
        return Err(AppError::Other(format!("path must be absolute: {}", path)));
    }
    if path.contains("..") {
        return Err(AppError::Other("path traversal is not allowed".into()));
    }
    if ALLOWED_PREFIXES.iter().any(|p| path.starts_with(p)) {
        Ok(())
    } else {
        Err(AppError::Other(format!("path is not allowlisted: {}", path)))
    }
}

impl ApiClient {
    pub fn new(base_url: String, api_key: String) -> Result<Self> {
        // Browsing is chatty and interactive; a two-hour timeout like the
        // uploader's would leave a dead server hanging the UI. Media transfers
        // get their own, longer budget below.
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(30))
            .build()?;
        Ok(Self {
            client,
            base_url: base_url.trim_end_matches('/').to_string(),
            api_key,
        })
    }

    pub fn base_url(&self) -> &str {
        &self.base_url
    }

    /// The API key as a query parameter, for the one case a URL has to carry
    /// it: handing a video URL to the webview's own `<video>` element, which
    /// cannot set request headers. See `media.rs` for why that is the fallback
    /// rather than the rule.
    pub fn query_credential(&self) -> (&'static str, &str) {
        ("api_key", &self.api_key)
    }

    fn request(
        &self,
        method: reqwest::Method,
        path: &str,
        query: &[(String, String)],
    ) -> Result<reqwest::RequestBuilder> {
        check_path(path)?;
        Ok(self
            .client
            .request(method, format!("{}{}", self.base_url, path))
            .header("X-API-Key", &self.api_key)
            .query(query))
    }

    async fn read_json(response: reqwest::Response) -> Result<Value> {
        let status = response.status();
        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            return Err(AppError::Other(format!(
                "HTTP {} — {}",
                status.as_u16(),
                body.chars().take(400).collect::<String>()
            )));
        }
        // A 204 or an empty body is still success; report it as JSON null
        // rather than a parse failure.
        let body = response.text().await?;
        if body.trim().is_empty() {
            return Ok(Value::Null);
        }
        Ok(serde_json::from_str(&body)?)
    }

    pub async fn get_json(&self, path: &str, query: &[(String, String)]) -> Result<Value> {
        let response = self
            .request(reqwest::Method::GET, path, query)?
            .send()
            .await?;
        Self::read_json(response).await
    }

    pub async fn send_json(
        &self,
        method: &str,
        path: &str,
        query: &[(String, String)],
        body: Option<Value>,
    ) -> Result<Value> {
        let method = reqwest::Method::from_bytes(method.to_uppercase().as_bytes())
            .map_err(|e| AppError::Other(format!("bad method: {}", e)))?;
        let mut builder = self.request(method, path, query)?;
        if let Some(body) = body {
            builder = builder.json(&body);
        }
        Self::read_json(builder.send().await?).await
    }

    /// Whole-body fetch, used for thumbnails, previews, hover clips and image
    /// originals. Returns the bytes and the server's content type so the cache
    /// can pick a file extension.
    pub async fn get_bytes(
        &self,
        path: &str,
        query: &[(String, String)],
    ) -> Result<(Vec<u8>, String)> {
        let response = self
            .request(reqwest::Method::GET, path, query)?
            // Originals can be large; give media its own budget.
            .timeout(Duration::from_secs(600))
            .send()
            .await?;
        let status = response.status();
        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            return Err(AppError::Other(format!(
                "HTTP {} — {}",
                status.as_u16(),
                body.chars().take(200).collect::<String>()
            )));
        }
        let content_type = response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("application/octet-stream")
            .split(';')
            .next()
            .unwrap_or("application/octet-stream")
            .trim()
            .to_string();
        let bytes = response.bytes().await?;
        Ok((bytes.to_vec(), content_type))
    }

    /// One byte range. `/photos/{id}/local` answers 206 for video, which is
    /// what lets a large original be pulled into the cache in resumable pieces
    /// instead of one all-or-nothing request.
    pub async fn get_range(
        &self,
        path: &str,
        query: &[(String, String)],
        start: u64,
        end_inclusive: u64,
    ) -> Result<RangeChunk> {
        let response = self
            .request(reqwest::Method::GET, path, query)?
            .header(
                reqwest::header::RANGE,
                format!("bytes={}-{}", start, end_inclusive),
            )
            .timeout(Duration::from_secs(600))
            .send()
            .await?;
        let status = response.status();
        if !(status.is_success() || status.as_u16() == 206) {
            let body = response.text().await.unwrap_or_default();
            return Err(AppError::Other(format!(
                "HTTP {} — {}",
                status.as_u16(),
                body.chars().take(200).collect::<String>()
            )));
        }
        let partial = status.as_u16() == 206;
        let content_type = response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("application/octet-stream")
            .split(';')
            .next()
            .unwrap_or("application/octet-stream")
            .trim()
            .to_string();
        // `Content-Range: bytes 0-1023/98765` carries the full length, which is
        // the only place the total size is available on a ranged response.
        let total = response
            .headers()
            .get(reqwest::header::CONTENT_RANGE)
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.rsplit('/').next().map(|s| s.to_string()))
            .and_then(|s| s.parse::<u64>().ok());
        let bytes = response.bytes().await?.to_vec();
        Ok(RangeChunk {
            bytes,
            content_type,
            total,
            partial,
        })
    }

    pub async fn health_check(&self) -> Result<bool> {
        let response = self
            .client
            .get(format!("{}/health", self.base_url))
            .timeout(Duration::from_secs(6))
            .send()
            .await?;
        Ok(response.status().is_success())
    }
}

pub struct RangeChunk {
    pub bytes: Vec<u8>,
    pub content_type: String,
    /// Total size of the resource, when the server reported a Content-Range.
    pub total: Option<u64>,
    /// True when the server honoured the range (206) rather than sending the
    /// whole body (200).
    pub partial: bool,
}

#[cfg(test)]
mod tests {
    use super::check_path;

    #[test]
    fn allowlisted_paths_pass() {
        assert!(check_path("/library/photos").is_ok());
        assert!(check_path("/photos/abc/local").is_ok());
        assert!(check_path("/clusters/people").is_ok());
    }

    #[test]
    fn everything_else_is_refused() {
        assert!(check_path("library/photos").is_err());
        assert!(check_path("/photos/../../etc/passwd").is_err());
        assert!(check_path("/flickr/delete").is_err());
        assert!(check_path("/api-keys").is_err());
    }
}
