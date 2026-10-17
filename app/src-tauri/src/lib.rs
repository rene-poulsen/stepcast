mod capture;
mod ffmpeg;
mod project;
mod recorder;
mod ws_server;

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};

use serde_json::{json, Value};
use tauri::webview::{PermissionKind, PermissionResponse};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_global_shortcut::{Code, Modifiers, Shortcut, ShortcutEvent, ShortcutState};

use capture::Monitor;
use recorder::AppState;
use ws_server::{ExtStatus, Hub};

#[tauri::command]
fn list_monitors(app: AppHandle) -> Result<Vec<Monitor>, String> {
    let primary = app.primary_monitor().ok().flatten().map(|m| *m.position());
    let monitors = app.available_monitors().map_err(|e| e.to_string())?;
    Ok(monitors
        .iter()
        .enumerate()
        .map(|(index, m)| Monitor {
            index,
            name: m.name().cloned().unwrap_or_else(|| format!("Display {}", index + 1)),
            x: m.position().x,
            y: m.position().y,
            width: m.size().width,
            height: m.size().height,
            scale: m.scale_factor(),
            primary: primary == Some(*m.position()),
        })
        .collect())
}

#[tauri::command]
fn ext_status(state: tauri::State<AppState>) -> ExtStatus {
    state.hub.status()
}

/// The bundled extension, copied to a stable folder the browser can load it from.
/// (Inside a macOS .app bundle it is hard to pick in a folder dialog, and the path
/// stays the same across updates, so updating is just "reload" in the browser.)
fn install_extension(app: &AppHandle) -> Option<PathBuf> {
    let bundled = app.path().resource_dir().ok().map(|d| d.join("extension")).filter(|d| d.exists());
    let source = bundled.unwrap_or_else(|| Path::new(env!("CARGO_MANIFEST_DIR")).join("../../extension/dist/chrome"));
    let target = app.path().app_local_data_dir().ok()?.join("extension");
    let version = |dir: &Path| std::fs::read_to_string(dir.join("manifest.json")).ok();
    if version(&source) != version(&target) || cfg!(debug_assertions) {
        let _ = std::fs::remove_dir_all(&target);
        copy_dir(&source, &target).ok()?;
    }
    Some(target)
}

fn copy_dir(from: &Path, to: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(to)?;
    for entry in std::fs::read_dir(from)? {
        let entry = entry?;
        let dest = to.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_dir(&entry.path(), &dest)?;
        } else {
            std::fs::copy(entry.path(), dest)?;
        }
    }
    Ok(())
}

#[tauri::command]
fn app_info(app: AppHandle, state: tauri::State<AppState>) -> Value {
    json!({
        "version": app.package_info().version.to_string(),
        "projectsDir": recorder::projects_dir(&app).ok(),
        "extensionDir": install_extension(&app).map(dunce_path),
        "encoder": state.encoder.get().map(|e| e.name),
        "platform": std::env::consts::OS,
    })
}

/// Normalizes `..` segments so the path can be shown to the user.
fn dunce_path(p: PathBuf) -> String {
    let s = std::fs::canonicalize(&p).unwrap_or(p).to_string_lossy().into_owned();
    s.strip_prefix(r"\\?\").map(str::to_owned).unwrap_or(s)
}

fn shortcut_handler(app: &AppHandle, shortcut: &Shortcut, event: ShortcutEvent) {
    if event.state() != ShortcutState::Pressed {
        return;
    }
    let recording = app.state::<AppState>().session.lock().unwrap().is_some();
    let action = if shortcut.key == Code::KeyR { "record" } else { "pause" };
    let target = if recording { "pill" } else { "main" };
    let _ = app.emit_to(target, "shortcut", action);
}

pub fn run() {
    let hub = Hub::new();
    let encoder = Arc::new(OnceLock::new());
    let ffmpeg_path = ffmpeg::locate();

    let mods = Modifiers::CONTROL | Modifiers::ALT;
    #[cfg(target_os = "macos")]
    let mods = Modifiers::SUPER | Modifiers::ALT;
    let record_key = Shortcut::new(Some(mods), Code::KeyR);
    let pause_key = Shortcut::new(Some(mods), Code::KeyP);

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_shortcuts([record_key, pause_key])
                .unwrap()
                .with_handler(shortcut_handler)
                .build(),
        )
        // Our own pages may use the camera and mic without a browser prompt; WebView2 would
        // otherwise show it inside the small recording window, where nobody can answer it.
        .on_permission_request(|_, kind| match kind {
            PermissionKind::Camera | PermissionKind::Microphone => PermissionResponse::Allow,
            _ => PermissionResponse::Default,
        })
        .manage(AppState { hub: hub.clone(), ffmpeg: ffmpeg_path.clone(), encoder: encoder.clone(), session: Mutex::new(None), picker: Mutex::new(None) })
        .setup(move |app| {
            ws_server::spawn(app.handle().clone(), hub);
            // Probing hardware encoders takes a second; do it before the first recording.
            std::thread::spawn(move || {
                encoder.get_or_init(|| ffmpeg::probe_encoder(&ffmpeg_path));
            });
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                let recovered = recorder::recover_interrupted(&handle);
                if recovered > 0 {
                    let _ = handle.emit("projects-changed", recovered);
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_monitors,
            ext_status,
            app_info,
            recorder::begin_recording,
            recorder::cam_begin,
            recorder::cam_chunk,
            recorder::start_screen,
            recorder::toggle_pause,
            recorder::stop_recording,
            recorder::cancel_recording,
            recorder::pick_area,
            recorder::picker_data,
            recorder::finish_pick,
            project::list_projects,
            project::load_project,
            project::save_project,
            project::delete_project,
            project::write_text_file,
            project::export_video,
            project::extract_frames,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Stepcast");
}
