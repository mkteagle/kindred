// Google Photos Takeout sidecar JSON parsing.
//
// Each photo in a Google Takeout export has a sibling JSON file with the
// metadata Google stripped from EXIF — original capture date, GPS, description.
// We need this because Flickr's "date taken" comes from EXIF, and Takeout
// frequently breaks EXIF dates (especially for older photos).
//
// File naming patterns we look for:
//   IMG_0001.JPG  →  IMG_0001.JPG.supplemental-metadata.json   (current format)
//   IMG_0001.JPG  →  IMG_0001.JPG.json                          (older format)
//   long-name.JPG →  truncated-to-46-chars.supplemental-metadata.json
//                    (Google truncates the basename when the resulting JSON
//                    would exceed filesystem limits)

use serde::Deserialize;
use std::path::{Path, PathBuf};

#[derive(Debug, Deserialize, Default)]
pub struct SidecarJson {
    #[serde(default)]
    pub description: Option<String>,
    #[serde(rename = "photoTakenTime", default)]
    pub photo_taken_time: Option<TakenTime>,
    #[serde(rename = "geoData", default)]
    pub geo_data: Option<GeoData>,
}

#[derive(Debug, Deserialize, Default)]
pub struct TakenTime {
    pub timestamp: Option<String>,
}

#[derive(Debug, Deserialize, Default)]
pub struct GeoData {
    pub latitude: Option<f64>,
    pub longitude: Option<f64>,
}

#[derive(Debug, Default, Clone)]
pub struct ExtractedMeta {
    pub taken_at_unix: Option<i64>,
    pub description: Option<String>,
    pub latitude: Option<f64>,
    pub longitude: Option<f64>,
}

impl ExtractedMeta {
    pub fn is_empty(&self) -> bool {
        self.taken_at_unix.is_none()
            && self.description.is_none()
            && self.latitude.is_none()
            && self.longitude.is_none()
    }
}

/// Look for a Google Takeout sidecar next to the given photo path.
/// Tries the common naming patterns. Returns the path if a file exists.
pub fn find_sidecar(photo_path: &Path) -> Option<PathBuf> {
    let display = photo_path.to_string_lossy();
    let candidates = [
        format!("{}.supplemental-metadata.json", display),
        format!("{}.json", display),
    ];
    for c in candidates {
        let p = PathBuf::from(&c);
        if p.is_file() {
            return Some(p);
        }
    }
    // Google truncates the basename used in the sidecar name when it would
    // produce a filename longer than the filesystem allows. The truncation
    // point varies; try a few common ones.
    let file_name = photo_path.file_name()?.to_string_lossy().to_string();
    let parent = photo_path.parent()?;
    for trunc in [46usize, 47, 51] {
        if file_name.len() > trunc {
            let stem = &file_name[..trunc];
            let p = parent.join(format!("{}.supplemental-metadata.json", stem));
            if p.is_file() {
                return Some(p);
            }
        }
    }
    None
}

pub fn parse_sidecar(path: &Path) -> Option<ExtractedMeta> {
    let raw = std::fs::read_to_string(path).ok()?;
    let parsed: SidecarJson = serde_json::from_str(&raw).ok()?;

    let taken_at_unix = parsed
        .photo_taken_time
        .as_ref()
        .and_then(|t| t.timestamp.as_ref())
        .and_then(|s| s.parse::<i64>().ok());

    let description = parsed
        .description
        .as_ref()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    let (latitude, longitude) = parsed
        .geo_data
        .as_ref()
        .map(|g| (g.latitude, g.longitude))
        .unwrap_or((None, None));

    // Google uses 0.0/0.0 to mean "no GPS data". Treat as None.
    let (latitude, longitude) = match (latitude, longitude) {
        (Some(0.0), Some(0.0)) => (None, None),
        (None, _) | (_, None) => (None, None),
        other => other,
    };

    Some(ExtractedMeta {
        taken_at_unix,
        description,
        latitude,
        longitude,
    })
}
