use reqwest::Client;
use serde::Deserialize;
use std::path::Path;
use std::time::Duration;

use crate::error::Result;

#[derive(Deserialize, Debug)]
pub struct UploadResponse {
    pub photo_id: String,
}

#[derive(Deserialize, Debug, serde::Serialize)]
pub struct ScanTriggerResponse {
    #[serde(default)]
    pub message: String,
    #[serde(default)]
    pub job_id: Option<String>,
    #[serde(default)]
    pub count: i64,
}

#[derive(Deserialize, Debug, serde::Serialize, Clone)]
pub struct Album {
    pub id: String,
    pub title: String,
    pub photo_count: i64,
    pub primary_photo_id: Option<String>,
}

#[derive(Deserialize, Debug)]
struct AlbumsResponse {
    albums: Vec<Album>,
}

#[derive(Clone)]
pub struct KindredClient {
    client: Client,
    base_url: String,
    api_key: String,
}

#[derive(Debug, thiserror::Error)]
pub enum UploadError {
    #[error("auth failed ({0}) — check your API key")]
    Auth(String),
    #[error("file too large for backend (50MB limit on /photos/upload)")]
    TooLarge,
    #[error("server error ({status}): {body}")]
    Server { status: u16, body: String },
    #[error("network error: {0}")]
    Network(String),
    #[error("bad response: {0}")]
    BadResponse(String),
}

impl UploadError {
    pub fn is_retryable(&self) -> bool {
        matches!(
            self,
            UploadError::Network(_)
                | UploadError::Server {
                    status: 500..=599,
                    ..
                }
        )
    }
}

impl KindredClient {
    pub fn new(base_url: String, api_key: String) -> Result<Self> {
        let client = Client::builder()
            .timeout(Duration::from_secs(300))
            .build()?;
        Ok(Self {
            client,
            base_url: base_url.trim_end_matches('/').to_string(),
            api_key,
        })
    }

    pub async fn health_check(&self) -> Result<bool> {
        let url = format!("{}/health", self.base_url);
        let res = self.client.get(&url).send().await?;
        Ok(res.status().is_success())
    }

    pub async fn trigger_scan(&self) -> Result<ScanTriggerResponse> {
        let url = format!("{}/scan/auto", self.base_url);
        let res = self
            .client
            .post(&url)
            .header("X-API-Key", &self.api_key)
            .send()
            .await?;
        if !res.status().is_success() {
            let status = res.status();
            let body = res.text().await.unwrap_or_default();
            return Err(crate::error::AppError::Other(format!(
                "scan trigger failed: HTTP {} — {}",
                status, body
            )));
        }
        Ok(res.json().await?)
    }

    pub async fn list_albums(&self) -> Result<Vec<Album>> {
        let url = format!("{}/flickr/albums", self.base_url);
        let res = self
            .client
            .get(&url)
            .header("X-API-Key", &self.api_key)
            .send()
            .await?;
        if !res.status().is_success() {
            let status = res.status();
            let body = res.text().await.unwrap_or_default();
            return Err(crate::error::AppError::Other(format!(
                "list albums failed: HTTP {} — {}",
                status, body
            )));
        }
        let body: AlbumsResponse = res.json().await?;
        Ok(body.albums)
    }

    pub async fn upload_file(
        &self,
        path: &Path,
        album_id: Option<&str>,
    ) -> std::result::Result<UploadResponse, UploadError> {
        let bytes = tokio::fs::read(path)
            .await
            .map_err(|e| UploadError::Network(format!("read file: {}", e)))?;
        let filename = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("upload")
            .to_string();
        let title = path
            .file_stem()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_string();
        let mime = mime_for(&filename);

        let part = reqwest::multipart::Part::bytes(bytes)
            .file_name(filename)
            .mime_str(&mime)
            .map_err(|e| UploadError::BadResponse(e.to_string()))?;
        let form = reqwest::multipart::Form::new()
            .part("photo", part)
            .text("title", title);

        // skip_processing=true: the backend won't run per-photo ML inline.
        // Callers should hit /scan/auto once at the end to index in batch.
        // privacy=private: hard-coded for the desktop uploader — backup tool
        // should never expose photos publicly or even to family.
        let mut url = format!(
            "{}/photos/upload?skip_processing=true&privacy=private",
            self.base_url
        );
        if let Some(id) = album_id {
            url.push_str("&album_id=");
            url.push_str(&urlencode(id));
        }
        let res = self
            .client
            .post(&url)
            .header("X-API-Key", &self.api_key)
            .multipart(form)
            .send()
            .await
            .map_err(|e| UploadError::Network(e.to_string()))?;

        let status = res.status();
        if status.as_u16() == 401 || status.as_u16() == 403 {
            return Err(UploadError::Auth(format!("HTTP {}", status)));
        }
        if status.as_u16() == 413 {
            return Err(UploadError::TooLarge);
        }
        if !status.is_success() {
            let body = res.text().await.unwrap_or_default();
            return Err(UploadError::Server {
                status: status.as_u16(),
                body,
            });
        }
        let body: UploadResponse = res
            .json()
            .await
            .map_err(|e| UploadError::BadResponse(e.to_string()))?;
        Ok(body)
    }
}

fn urlencode(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                (b as char).to_string()
            }
            _ => format!("%{:02X}", b),
        })
        .collect()
}

fn mime_for(filename: &str) -> &'static str {
    let ext = filename.rsplit('.').next().unwrap_or("").to_lowercase();
    match ext.as_str() {
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "heic" | "heif" => "image/heic",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "tif" | "tiff" => "image/tiff",
        "mp4" => "video/mp4",
        "mov" => "video/quicktime",
        _ => "application/octet-stream",
    }
}
