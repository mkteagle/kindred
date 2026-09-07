//! Multi-window management.
//!
//! Four window kinds, each a real OS window with its own selection and its own
//! remembered geometry:
//!
//! | kind       | label            | default size | what it is                    |
//! |------------|------------------|--------------|-------------------------------|
//! | `library`  | `main`           | 1180×720     | the sidebar + mosaic window   |
//! | `viewer`   | `viewer-N`       | 1080×700     | stage, filmstrip, inspector   |
//! | `review`   | `review-N`       | 980×660      | "Who is this?"                |
//! | `settings` | `settings`       | 900×620      | the settings rail             |
//! | `uploader` | `uploader`       | 1100×720     | the pre-existing bulk uploader|
//!
//! Every window loads the same `index.html`; the view layer switches on the
//! window's own label rather than on a URL, and pulls whatever it was opened
//! with (a photo id, a cluster id) from `window_context`. Passing state through
//! a command instead of a query string keeps the payload structured and means
//! a re-opened window cannot inherit a stale URL.
//!
//! Geometry is remembered per *kind*, not per label: the second viewer you tear
//! off should land where the last one was, and there is no useful sense in
//! which `viewer-7` has a home of its own.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent};

use crate::error::{AppError, Result};
use crate::settings::{SettingsStore, WindowGeometry};

/// What a window was opened with, readable by that window and no other.
#[derive(Debug, Clone, Serialize)]
pub struct WindowContext {
    pub label: String,
    pub kind: String,
    pub params: Value,
}

#[derive(Default)]
pub struct WindowRegistry {
    contexts: Mutex<HashMap<String, WindowContext>>,
    /// Live geometry, updated on every move and resize and flushed to
    /// config.json when a window loses focus or closes. Writing the file on
    /// every pixel of a drag would be absurd.
    geometry: Mutex<HashMap<String, WindowGeometry>>,
    counter: Mutex<u32>,
}

impl WindowRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    fn next_label(&self, kind: &str) -> String {
        let mut counter = self.counter.lock().unwrap();
        *counter += 1;
        format!("{}-{}", kind, *counter)
    }

    pub fn context(&self, label: &str) -> Option<WindowContext> {
        self.contexts.lock().unwrap().get(label).cloned()
    }

    pub fn set_context(&self, context: WindowContext) {
        self.contexts
            .lock()
            .unwrap()
            .insert(context.label.clone(), context);
    }

    pub fn forget(&self, label: &str) {
        self.contexts.lock().unwrap().remove(label);
    }

    pub fn record_geometry(&self, kind: &str, update: impl FnOnce(&mut WindowGeometry)) {
        let mut map = self.geometry.lock().unwrap();
        let entry = map.entry(kind.to_string()).or_insert(WindowGeometry {
            x: 0,
            y: 0,
            width: 0,
            height: 0,
        });
        update(entry);
    }

    pub fn take_geometry(&self, kind: &str) -> Option<WindowGeometry> {
        self.geometry.lock().unwrap().get(kind).copied()
    }
}

/// Default size and minimum for each kind, straight from the mock dimensions.
fn defaults_for(kind: &str) -> Result<(f64, f64, f64, f64, &'static str)> {
    Ok(match kind {
        "library" => (1180.0, 720.0, 900.0, 560.0, "Kindred — All photos"),
        "viewer" => (1080.0, 700.0, 760.0, 520.0, "Kindred"),
        "review" => (980.0, 660.0, 760.0, 520.0, "Review"),
        "settings" => (900.0, 620.0, 700.0, 480.0, "Kindred — Settings"),
        "uploader" => (1100.0, 720.0, 900.0, 600.0, "Kindred Uploader"),
        other => return Err(AppError::Other(format!("unknown window kind: {}", other))),
    })
}

/// Kinds that only ever want one window. Asking again focuses what is already
/// open instead of stacking a second copy.
fn is_singleton(kind: &str) -> bool {
    matches!(kind, "settings" | "uploader" | "library")
}

fn label_for(kind: &str, registry: &WindowRegistry) -> String {
    match kind {
        "library" => "main".to_string(),
        "settings" => "settings".to_string(),
        "uploader" => "uploader".to_string(),
        other => registry.next_label(other),
    }
}

/// Open (or focus) a window of this kind, carrying `params` to it.
pub fn open(
    app: &AppHandle,
    registry: &Arc<WindowRegistry>,
    settings: &Arc<SettingsStore>,
    kind: &str,
    params: Value,
) -> Result<String> {
    let (width, height, min_width, min_height, title) = defaults_for(kind)?;
    let label = label_for(kind, registry);

    if is_singleton(kind) {
        if let Some(existing) = app.get_webview_window(&label) {
            // Re-arm the context before focusing: "Settings → Local cache" from
            // a menu should land on that pane even when Settings is open on
            // another.
            registry.set_context(WindowContext {
                label: label.clone(),
                kind: kind.to_string(),
                params: params.clone(),
            });
            let _ = existing.emit_context(&params);
            let _ = existing.unminimize();
            let _ = existing.set_focus();
            return Ok(label);
        }
    }

    registry.set_context(WindowContext {
        label: label.clone(),
        kind: kind.to_string(),
        params,
    });

    let remembered = settings.get().windows.get(kind).copied();
    let mut builder =
        WebviewWindowBuilder::new(app, label.as_str(), WebviewUrl::App("index.html".into()))
        .title(title)
        .min_inner_size(min_width, min_height)
        .resizable(true);

    builder = match remembered {
        Some(geometry) if geometry.width > 400 && geometry.height > 300 => builder
            .inner_size(geometry.width as f64, geometry.height as f64)
            .position(geometry.x as f64, geometry.y as f64),
        _ => builder.inner_size(width, height).center(),
    };

    let window = builder.build()?;
    attach_geometry_tracking(&window, registry.clone(), settings.clone(), kind.to_string());
    Ok(label)
}

/// Keep `config.json` in step with where the member actually left the window.
fn attach_geometry_tracking(
    window: &tauri::WebviewWindow,
    registry: Arc<WindowRegistry>,
    settings: Arc<SettingsStore>,
    kind: String,
) {
    let label = window.label().to_string();
    window.on_window_event(move |event| match event {
        WindowEvent::Moved(position) => {
            registry.record_geometry(&kind, |g| {
                g.x = position.x;
                g.y = position.y;
            });
        }
        WindowEvent::Resized(size) => {
            registry.record_geometry(&kind, |g| {
                g.width = size.width;
                g.height = size.height;
            });
        }
        WindowEvent::Focused(false) | WindowEvent::CloseRequested { .. } => {
            flush_geometry(&registry, &settings, &kind);
        }
        WindowEvent::Destroyed => {
            flush_geometry(&registry, &settings, &kind);
            registry.forget(&label);
        }
        _ => {}
    });
}

fn flush_geometry(registry: &WindowRegistry, settings: &SettingsStore, kind: &str) {
    let Some(geometry) = registry.take_geometry(kind) else {
        return;
    };
    if geometry.width == 0 || geometry.height == 0 {
        return;
    }
    let _ = settings.update(|s| {
        s.windows.insert(kind.to_string(), geometry);
    });
}

/// Small extension so re-focusing a singleton can hand it fresh params.
trait EmitContext {
    fn emit_context(&self, params: &Value) -> tauri::Result<()>;
}

impl EmitContext for tauri::WebviewWindow {
    fn emit_context(&self, params: &Value) -> tauri::Result<()> {
        use tauri::Emitter;
        self.emit("window-context", params)
    }
}
