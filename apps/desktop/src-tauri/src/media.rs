//! Media flowing between the household server and the local cache.
//!
//! Every pixel the four windows draw comes from a file on this machine. The
//! view layer asks for a photo id and a variant, gets back an absolute path,
//! and turns it into an asset URL with `convertFileSrc`. That indirection is
//! what makes the app work on a plane, and it is also what keeps the API key
//! out of the webview: nothing in `src/` ever sees it or talks to the server
//! directly.
//!
//! The one exception is playing a video original — see `video_stream_url`.

use std::io::Write;
use std::path::Path;

use serde::Serialize;

use crate::cache::CachedMedia;
use crate::error::{AppError, Result};

/// 8 MB per ranged request. Big enough that a 2 GB original is a few hundred
/// requests rather than tens of thousands, small enough that a chunk lives in
/// memory for a moment and no longer.
const CHUNK_BYTES: u64 = 8 * 1024 * 1024;

#[derive(Debug, Clone, Serialize)]
pub struct MediaRef {
    pub photo_id: String,
    pub variant: String,
    /// Absolute path to the cached file, or null when it is not on this
    /// machine. A null path with `offline: true` is what the grid draws its
    /// "not kept offline" placeholder for.
    pub path: Option<String>,
    pub bytes: i64,
    pub cached: bool,
    /// True when this call served an existing file without touching the
    /// network.
    pub from_cache: bool,
    /// Set when a fetch was attempted and failed — usually the server being
    /// unreachable, which the UI reports rather than swallowing.
    pub error: Option<String>,
}

impl MediaRef {
    fn hit(media: CachedMedia, from_cache: bool) -> Self {
        Self {
            photo_id: media.photo_id,
            variant: media.variant,
            path: Some(media.path),
            bytes: media.bytes,
            cached: true,
            from_cache,
            error: None,
        }
    }

    fn miss(photo_id: &str, variant: &str, error: Option<String>) -> Self {
        Self {
            photo_id: photo_id.to_string(),
            variant: variant.to_string(),
            path: None,
            bytes: 0,
            cached: false,
            from_cache: false,
            error,
        }
    }
}

fn local_path(photo_id: &str) -> String {
    format!("/photos/{}/local", photo_id)
}

fn variant_query(variant: &str) -> Vec<(String, String)> {
    vec![("variant".to_string(), variant.to_string())]
}

/// Pull one variant into the cache if it is not already there.
///
/// Video *originals* are deliberately excluded from the ordinary browsing path
/// — a library of 412 videos would fill any allowance long before the photos
/// did. They are fetched only when something actually needs the file on disk
/// (drag-out, export, an explicit pin), and then in ranged pieces via
/// `ensure_original_file`.
pub async fn ensure(
    cache: &crate::cache::MediaCache,
    client: &crate::api::ApiClient,
    photo_id: &str,
    variant: &str,
    pin: Option<&str>,
    limit_bytes: i64,
) -> MediaRef {
    match cache.lookup(photo_id, variant) {
        Ok(Some(media)) => {
            if let Some(pin) = pin {
                let _ = cache.set_pin(photo_id, variant, Some(pin));
            }
            return MediaRef::hit(media, true);
        }
        Ok(None) => {}
        Err(e) => return MediaRef::miss(photo_id, variant, Some(e.to_string())),
    }

    let fetched = client
        .get_bytes(&local_path(photo_id), &variant_query(variant))
        .await;
    match fetched {
        Ok((bytes, content_type)) => match cache.store(photo_id, variant, &bytes, &content_type, pin)
        {
            Ok(media) => {
                // Trim after every write rather than on a timer, so the cache
                // can never run away between sweeps.
                let _ = cache.evict_to_fit(limit_bytes);
                MediaRef::hit(media, false)
            }
            Err(e) => MediaRef::miss(photo_id, variant, Some(e.to_string())),
        },
        Err(e) => MediaRef::miss(photo_id, variant, Some(e.to_string())),
    }
}

/// Pull a full original to disk, in ranged chunks.
///
/// `/photos/{id}/local` answers HTTP byte ranges for video, which is what makes
/// this resumable in principle and memory-bounded in practice. A server that
/// answers 200 instead (images always do) is handled by taking the whole body
/// from that first response.
pub async fn ensure_original_file(
    cache: &crate::cache::MediaCache,
    client: &crate::api::ApiClient,
    photo_id: &str,
    pin: Option<&str>,
    limit_bytes: i64,
) -> Result<CachedMedia> {
    if let Some(media) = cache.lookup(photo_id, "original")? {
        if media.complete {
            if let Some(pin) = pin {
                let _ = cache.set_pin(photo_id, "original", Some(pin));
            }
            return Ok(media);
        }
    }

    let path = local_path(photo_id);
    let query = variant_query("original");
    let staging = cache.staging_path(photo_id)?;
    let _ = std::fs::remove_file(&staging);

    let first = client.get_range(&path, &query, 0, CHUNK_BYTES - 1).await?;
    let content_type = first.content_type.clone();

    if !first.partial {
        // The server sent the whole thing; nothing left to range for.
        let media = cache.store(photo_id, "original", &first.bytes, &content_type, pin)?;
        let _ = cache.evict_to_fit(limit_bytes);
        return Ok(media);
    }

    let total = first.total.ok_or_else(|| {
        AppError::Other("server sent a partial response without a total length".into())
    })?;
    {
        let mut file = std::fs::File::create(&staging)?;
        file.write_all(&first.bytes)?;
        let mut offset = first.bytes.len() as u64;
        while offset < total {
            let end = (offset + CHUNK_BYTES - 1).min(total - 1);
            let chunk = client.get_range(&path, &query, offset, end).await?;
            if chunk.bytes.is_empty() {
                return Err(AppError::Other(
                    "server stopped sending before the original was complete".into(),
                ));
            }
            file.write_all(&chunk.bytes)?;
            offset += chunk.bytes.len() as u64;
        }
        file.flush()?;
    }

    let media = cache.store_file(photo_id, "original", &staging, &content_type, pin)?;
    let _ = cache.evict_to_fit(limit_bytes);
    Ok(media)
}

/// A filename a member would recognise in Finder. Falls back to the photo id
/// so an export never produces two files called `Untitled`.
pub fn export_filename(title: Option<&str>, photo_id: &str, path: &Path) -> String {
    let extension = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("jpg")
        .to_string();
    let stem = title
        .map(str::trim)
        .filter(|t| !t.is_empty())
        .map(|t| {
            t.chars()
                .map(|c| match c {
                    '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '-',
                    c => c,
                })
                .collect::<String>()
        })
        .filter(|t| !t.is_empty())
        .unwrap_or_else(|| photo_id.to_string());
    let stem: String = stem.chars().take(120).collect();
    // The stem may already carry the extension when it came from a filename.
    if stem.to_lowercase().ends_with(&format!(".{}", extension.to_lowercase())) {
        stem
    } else {
        format!("{}.{}", stem, extension)
    }
}

#[cfg(test)]
mod tests {
    use super::export_filename;
    use std::path::Path;

    #[test]
    fn builds_a_recognisable_filename() {
        assert_eq!(
            export_filename(Some("Campfire at the lake"), "abc", Path::new("/x/abc.jpg")),
            "Campfire at the lake.jpg"
        );
        assert_eq!(
            export_filename(Some("IMG_0042.jpg"), "abc", Path::new("/x/abc.jpg")),
            "IMG_0042.jpg"
        );
        assert_eq!(export_filename(None, "abc", Path::new("/x/abc.mov")), "abc.mov");
        assert_eq!(
            export_filename(Some("a/b:c"), "abc", Path::new("/x/abc.jpg")),
            "a-b-c.jpg"
        );
    }
}
