//! The application menu.
//!
//! Two kinds of shortcut live in the design's map, and they need two different
//! mechanisms:
//!
//! - **Modified** (`⌘K`, `⌘A`, `⌘⌫`, `⌘⇧N`, `⌘,`, `⌘R`) are menu accelerators.
//!   The OS dispatches them whether or not the webview has focus, they show up
//!   in the menu bar where a desktop user expects to find them, and they keep
//!   working when a `<video>` or a native control has the keyboard.
//! - **Bare keys** (`Space`, `F`, `←`, `→`, `↵`, `M`, `S`, `X`) are handled in
//!   the view layer. Registering `S` as a menu accelerator would swallow the
//!   letter S in the "Name this person" field — a menu accelerator wins over
//!   the focused text input, every time. These are contextual by nature, so
//!   they belong to whichever window and mode is in front.
//!
//! A menu selection is broadcast as `menu-command` to every window; each window
//! ignores it unless it actually has focus. Tauri has no "send to the key
//! window" primitive, and `document.hasFocus()` is exactly the test that
//! matters.

use tauri::menu::{AboutMetadata, Menu, MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::{AppHandle, Runtime};

/// Build the whole menu bar. Ids here are the strings the view layer switches
/// on in `useMenuCommands`.
pub fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let settings = MenuItemBuilder::with_id("settings", "Settings…")
        .accelerator("CmdOrCtrl+Comma")
        .build(app)?;

    // The app menu's Services / Hide / Hide Others / Show All are macOS
    // conventions and macOS-only APIs; gating them keeps a Windows or Linux
    // build compiling rather than relying on them being silent no-ops there.
    let mut about = AboutMetadata::default();
    about.name = Some("Kindred".to_string());
    about.version = Some(env!("CARGO_PKG_VERSION").to_string());

    #[allow(unused_mut)]
    let mut app_menu = SubmenuBuilder::new(app, "Kindred")
        .about(Some(about))
        .separator()
        .item(&settings)
        .separator();
    #[cfg(target_os = "macos")]
    {
        app_menu = app_menu
            .services()
            .separator()
            .hide()
            .hide_others()
            .show_all()
            .separator();
    }
    let app_menu = app_menu.quit().build()?;

    let new_window = MenuItemBuilder::with_id("new-window", "New Window")
        .accelerator("CmdOrCtrl+Shift+N")
        .build(app)?;
    let open_viewer = MenuItemBuilder::with_id("open-viewer", "Open in Viewer Window").build(app)?;
    let open_review =
        MenuItemBuilder::with_id("open-review", "New Review Session…").build(app)?;
    let upload = MenuItemBuilder::with_id("upload", "Upload…")
        .accelerator("CmdOrCtrl+U")
        .build(app)?;
    let uploader = MenuItemBuilder::with_id("open-uploader", "Bulk Uploader…").build(app)?;
    let export = MenuItemBuilder::with_id("export", "Export Originals…")
        .accelerator("CmdOrCtrl+Shift+E")
        .build(app)?;

    let file_menu = SubmenuBuilder::new(app, "File")
        .item(&new_window)
        .item(&open_viewer)
        .item(&open_review)
        .separator()
        .item(&upload)
        .item(&uploader)
        .item(&export)
        .build()?;

    // Select All is ours, not the predefined edit action: ⌘A means "select
    // every photo in the current day sections", and the view layer falls back
    // to the browser's own select-all when a text field has focus.
    let select_all = MenuItemBuilder::with_id("select-all", "Select All")
        .accelerator("CmdOrCtrl+A")
        .build(app)?;
    let deselect = MenuItemBuilder::with_id("deselect", "Deselect All")
        .accelerator("CmdOrCtrl+Shift+A")
        .build(app)?;

    let edit_menu = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .separator()
        .item(&select_all)
        .item(&deselect)
        .build()?;

    let toggle_inspector = MenuItemBuilder::with_id("toggle-inspector", "Show Inspector")
        .accelerator("CmdOrCtrl+I")
        .build(app)?;
    let toggle_sidebar = MenuItemBuilder::with_id("toggle-sidebar", "Show Sidebar")
        .accelerator("CmdOrCtrl+Alt+S")
        .build(app)?;
    // Bare-key hints are in the label because the keys themselves must stay
    // available to text fields. See the module note.
    let quick_look = MenuItemBuilder::with_id("quick-look", "Quick Look  (Space)").build(app)?;
    let previous = MenuItemBuilder::with_id("step-previous", "Previous  (←)").build(app)?;
    let next = MenuItemBuilder::with_id("step-next", "Next  (→)").build(app)?;

    #[allow(unused_mut)]
    let mut view_menu = SubmenuBuilder::new(app, "View")
        .item(&quick_look)
        .item(&previous)
        .item(&next)
        .separator()
        .item(&toggle_sidebar)
        .item(&toggle_inspector);
    #[cfg(target_os = "macos")]
    {
        // ⌃⌘F, the platform's own full-screen accelerator. Bare `F` is handled
        // in the viewer's DOM so it cannot swallow the letter elsewhere.
        view_menu = view_menu.separator().fullscreen();
    }
    let view_menu = view_menu.build()?;

    let search = MenuItemBuilder::with_id("search", "Search…")
        .accelerator("CmdOrCtrl+K")
        .build(app)?;
    let sync = MenuItemBuilder::with_id("sync", "Sync Now")
        .accelerator("CmdOrCtrl+R")
        .build(app)?;
    let favorite = MenuItemBuilder::with_id("favorite", "Favorite")
        .accelerator("CmdOrCtrl+D")
        .build(app)?;
    let add_to_album = MenuItemBuilder::with_id("add-to-album", "Add to Album…").build(app)?;
    let share = MenuItemBuilder::with_id("share", "Share…").build(app)?;
    let reveal = MenuItemBuilder::with_id("reveal", "Reveal in Finder").build(app)?;
    let remove = MenuItemBuilder::with_id("remove", "Remove from Library")
        .accelerator("CmdOrCtrl+Backspace")
        .build(app)?;

    let library_menu = SubmenuBuilder::new(app, "Library")
        .item(&search)
        .item(&sync)
        .separator()
        .item(&favorite)
        .item(&add_to_album)
        .item(&share)
        .item(&reveal)
        .separator()
        .item(&remove)
        .build()?;

    #[allow(unused_mut)]
    let mut window_menu = SubmenuBuilder::new(app, "Window");
    #[cfg(target_os = "macos")]
    {
        window_menu = window_menu.minimize().maximize().separator();
    }
    let window_menu = window_menu.close_window().build()?;

    let shortcuts = MenuItemBuilder::with_id("shortcuts", "Keyboard Shortcuts").build(app)?;
    let help_menu = SubmenuBuilder::new(app, "Help").item(&shortcuts).build()?;

    MenuBuilder::new(app)
        .items(&[
            &app_menu,
            &file_menu,
            &edit_menu,
            &view_menu,
            &library_menu,
            &window_menu,
            &help_menu,
        ])
        .build()
}
