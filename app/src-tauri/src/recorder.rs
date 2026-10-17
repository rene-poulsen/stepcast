//! A recording in progress: screen capture, camera file, pauses and browser events.
//!
//! While recording, `recording.json` (session info) and `events.jsonl` (browser events) are kept
//! up to date in the recording's folder, so an interrupted recording can be recovered on next start.

use std::fs::{self, File};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::ipc::{InvokeBody, Request};
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, WebviewUrl, WebviewWindowBuilder};

use crate::capture::{self, Area, Capture, Monitor};
use crate::ffmpeg::{self, Encoder};
use crate::ws_server::Hub;

pub const SESSION_FILE: &str = "recording.json";
pub const EVENTS_FILE: &str = "events.jsonl";

pub struct AppState {
    pub hub: Arc<Hub>,
    pub ffmpeg: PathBuf,
    pub encoder: Arc<OnceLock<Encoder>>,
    pub session: Mutex<Option<Session>>,
    /// Screenshot and windows for the area picker while it is open.
    pub picker: Mutex<Option<Value>>,
}

impl AppState {
    pub fn encoder(&self) -> Encoder {
        self.encoder.get_or_init(|| ffmpeg::probe_encoder(&self.ffmpeg)).clone()
    }
}

/// What we need to know to turn the folder into a project, saved as `recording.json`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionMeta {
    monitor: Monitor,
    /// Recording only this part of the monitor.
    #[serde(default)]
    area: Option<Area>,
    /// Only the webcam is recorded; `monitor` is just where the pill was shown.
    #[serde(default)]
    cam_only: bool,
    /// Epoch ms of the first screen frame; 0 until capture has started.
    t0: i64,
    cam: Option<CamMeta>,
    pauses: Vec<[f64; 2]>,
    paused_at: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CamMeta {
    name: String,
    mime: String,
    started_at: i64,
    has_video: bool,
    has_audio: bool,
}

pub struct Session {
    dir: PathBuf,
    meta: SessionMeta,
    capture: Option<Capture>,
    cam_file: Option<File>,
    /// When a webcam-only recording started: its clock, as there is no screen capture.
    started: Option<Instant>,
}

impl Session {
    fn video_time(&self) -> f64 {
        match (&self.capture, self.started) {
            (Some(c), _) => c.recorded_ms.load(Ordering::Relaxed) as f64 / 1000.0,
            (None, Some(started)) => started.elapsed().as_secs_f64(),
            (None, None) => 0.0,
        }
    }

    fn save_meta(&self) {
        if let Ok(value) = serde_json::to_value(&self.meta) {
            let _ = write_json(&self.dir.join(SESSION_FILE), &value);
        }
    }
}

pub fn projects_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let base = app.path().video_dir().or_else(|_| app.path().home_dir()).map_err(|e| e.to_string())?;
    Ok(base.join("Stepcast"))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordOptions {
    pub monitor: Monitor,
    #[serde(default)]
    pub area: Option<Area>,
    pub camera: bool,
    pub mic: bool,
    /// Record only the webcam. `monitor` then only places the pill.
    #[serde(default)]
    pub cam_only: bool,
    /// Output format id ("9:16"), so the pill can show the crop guide.
    #[serde(default)]
    pub format: String,
}

/// The pill's size: a bar, plus a webcam preview that is larger when only the webcam is recorded.
fn pill_size(camera: bool, cam_only: bool) -> (f64, f64) {
    match (camera, cam_only) {
        (_, true) => (360.0, 64.0 + 8.0 + 344.0 * 9.0 / 16.0),
        (true, false) => (296.0, 64.0 + 166.0),
        (false, false) => (296.0, 64.0),
    }
}

// Async: on Windows, creating a window from a sync command (main thread) deadlocks.
#[tauri::command]
pub async fn begin_recording(app: AppHandle, state: tauri::State<'_, AppState>, options: RecordOptions) -> Result<String, String> {
    let mut session = state.session.lock().unwrap();
    if session.is_some() {
        return Err("A recording is already running.".into());
    }
    let stamp = chrono::Local::now().format("%Y-%m-%d %H.%M.%S").to_string();
    let dir = projects_dir(&app)?.join(&stamp);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let new = Session {
        dir: dir.clone(),
        meta: SessionMeta {
            area: options.area.filter(|_| !options.cam_only).map(|a| a.fit(&options.monitor)),
            cam_only: options.cam_only,
            monitor: options.monitor.clone(),
            t0: 0,
            cam: None,
            pauses: Vec::new(),
            paused_at: None,
        },
        capture: None,
        cam_file: None,
        started: None,
    };
    new.save_meta();
    *session = Some(new);
    drop(session);

    let camera = options.camera || options.cam_only;
    let format: String = options.format.chars().filter(|c| c.is_ascii_alphanumeric() || *c == ':').collect();
    let url = format!(
        "index.html?w=pill&camera={camera}&mic={}&camOnly={}&format={format}",
        options.mic, options.cam_only
    );
    let (width, height) = pill_size(camera, options.cam_only);
    let pill = WebviewWindowBuilder::new(&app, "pill", WebviewUrl::App(url.into()))
        .title("Stepcast")
        .inner_size(width, height)
        .decorations(false)
        .resizable(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .content_protected(true)
        .shadow(true)
        .visible(false)
        .build()
        .map_err(|e| e.to_string())?;

    // Bottom-right corner of the monitor being recorded.
    let m = &options.monitor;
    let margin = 24.0 * m.scale;
    let x = m.x as f64 + m.width as f64 - width * m.scale - margin;
    let y = m.y as f64 + m.height as f64 - height * m.scale - margin * 3.0;
    let _ = pill.set_position(PhysicalPosition::new(x as i32, y as i32));
    let _ = pill.show();

    if let Some(main) = app.get_webview_window("main") {
        let _ = main.hide();
    }
    Ok(dir.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn cam_begin(state: tauri::State<AppState>, mime: String, started_at: i64, video: bool, audio: bool) -> Result<(), String> {
    let mut guard = state.session.lock().unwrap();
    let session = guard.as_mut().ok_or("No recording")?;
    let ext = if mime.contains("mp4") { "mp4" } else { "webm" };
    let name = format!("cam.{ext}");
    session.cam_file = Some(File::create(session.dir.join(&name)).map_err(|e| e.to_string())?);
    session.meta.cam = Some(CamMeta { name, mime, started_at, has_video: video, has_audio: audio });
    session.save_meta();
    Ok(())
}

#[tauri::command]
pub fn cam_chunk(state: tauri::State<AppState>, request: Request) -> Result<(), String> {
    let InvokeBody::Raw(bytes) = request.body() else { return Err("Expected raw bytes".into()) };
    let mut guard = state.session.lock().unwrap();
    let file = guard.as_mut().and_then(|s| s.cam_file.as_mut()).ok_or("Camera file not started")?;
    file.write_all(bytes).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn start_screen(app: AppHandle) -> Result<i64, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let (monitor, area, dir, cam_only) = {
            let guard = state.session.lock().unwrap();
            let s = guard.as_ref().ok_or("No recording")?;
            (s.meta.monitor.clone(), s.meta.area, s.dir.clone(), s.meta.cam_only)
        };
        if cam_only {
            // Nothing to capture: the recording's clock starts now, and browser events aren't kept.
            let mut guard = state.session.lock().unwrap();
            let s = guard.as_mut().ok_or("No recording")?;
            s.started = Some(Instant::now());
            s.meta.t0 = chrono::Utc::now().timestamp_millis();
            s.save_meta();
            return Ok(s.meta.t0);
        }
        let encoder = state.encoder();
        let mut capture = Capture::start(&state.ffmpeg, &encoder, &monitor, area, &dir)?;
        let t0 = match capture.wait_started(Duration::from_secs(10)) {
            Ok(t0) => t0,
            Err(e) => {
                capture.stop();
                return Err(e);
            }
        };
        let mut guard = state.session.lock().unwrap();
        let s = guard.as_mut().ok_or("No recording")?;
        s.capture = Some(capture);
        s.meta.t0 = t0;
        s.save_meta();
        state.hub.set_recording(true, Some(&dir.join(EVENTS_FILE)));
        Ok(t0)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn toggle_pause(state: tauri::State<AppState>) -> Result<bool, String> {
    let mut guard = state.session.lock().unwrap();
    let s = guard.as_mut().ok_or("No recording")?;
    let now = s.video_time();
    let paused = match s.meta.paused_at.take() {
        Some(start) => {
            s.meta.pauses.push([start, now]);
            false
        }
        None => {
            s.meta.paused_at = Some(now);
            true
        }
    };
    s.save_meta();
    Ok(paused)
}

/// Converts browser events to video time and drops those from the countdown.
fn events_in_video_time(events: Vec<Value>, t0: i64, duration: f64) -> Vec<Value> {
    events
        .into_iter()
        .filter_map(|mut e| {
            let t = e.get("t")?.as_i64()?;
            let time = (t - t0) as f64 / 1000.0;
            if time < -0.25 || time > duration + 0.5 {
                return None;
            }
            e.as_object_mut()?.insert("time".into(), json!(time.max(0.0)));
            Some(e)
        })
        .collect()
}

fn close_pill_show_main(app: &AppHandle) {
    if let Some(pill) = app.get_webview_window("pill") {
        let _ = pill.destroy();
    }
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.show();
        let _ = main.set_focus();
    }
}

#[tauri::command]
pub async fn stop_recording(app: AppHandle) -> Result<String, String> {
    let result = tauri::async_runtime::spawn_blocking({
        let app = app.clone();
        move || finish(&app)
    })
    .await
    .map_err(|e| e.to_string())?;
    close_pill_show_main(&app);
    if let Ok(dir) = &result {
        let _ = app.emit("recording-finished", dir);
    }
    result
}

fn finish(app: &AppHandle) -> Result<String, String> {
    let state = app.state::<AppState>();
    state.hub.set_recording(false, None);
    let mut session = state.session.lock().unwrap().take().ok_or("No recording")?;

    let duration = session.video_time();
    if let Some(capture) = session.capture.take() {
        capture.stop();
    }
    drop(session.cam_file.take());
    let events = state.hub.take_events();
    build_project(&state.ffmpeg, &session.dir, session.meta, events, Some(duration), false)?;
    Ok(session.dir.to_string_lossy().into_owned())
}

/// Makes the files playable and writes `project.json`. `duration` is read from the video if unknown.
fn build_project(
    ffmpeg_path: &Path,
    dir: &Path,
    mut meta: SessionMeta,
    events: Vec<Value>,
    duration: Option<f64>,
    recovered: bool,
) -> Result<(), String> {
    let cam_meta = meta.cam.clone().filter(|c| dir.join(&c.name).exists());
    if let Some(c) = &cam_meta {
        // MediaRecorder files have no seek index; a stream copy adds one.
        let tmp = format!("indexed-{}", c.name);
        if remux(ffmpeg_path, dir, &c.name, &tmp).is_ok() {
            let _ = fs::rename(dir.join(&tmp), dir.join(&c.name));
        }
    }
    // Seconds from t0 to the camera file's start; negative, as the camera starts first.
    let cam_offset = cam_meta.as_ref().map_or(0.0, |c| (c.started_at - meta.t0) as f64 / 1000.0);

    let (duration, screen, events) = if meta.cam_only {
        let c = cam_meta.as_ref().filter(|c| c.has_video).ok_or("The webcam recording is empty")?;
        let from_file = probe(ffmpeg_path, dir, &c.name).duration.map(|d| d + cam_offset);
        let duration = duration.filter(|d| *d > 0.0).or(from_file).filter(|d| *d > 0.0).ok_or("The webcam recording is empty")?;
        (duration, Value::Null, Vec::new())
    } else {
        // Copy into an indexed MP4 so the editor can play and seek it (WebKit can't play MKV).
        if remux(ffmpeg_path, dir, "screen.mkv", "screen.mp4").is_ok() {
            let _ = fs::remove_file(dir.join("screen.mkv"));
        }
        let info = probe(ffmpeg_path, dir, "screen.mp4");
        let duration = duration.filter(|d| *d > 0.0).or(info.duration).ok_or("The screen recording is empty")?;
        let m = &meta.monitor;
        // What was recorded, in desktop pixels: the whole monitor or the chosen area.
        let (x, y, w, h) = match meta.area {
            Some(a) => (m.x + a.x, m.y + a.y, a.w, a.h),
            None => (m.x, m.y, m.width, m.height),
        };
        let (video_w, video_h) = info.size.unwrap_or((w & !1, h & !1));
        let screen = json!({
            "file": "screen.mp4",
            "width": video_w,
            "height": video_h,
            "x": x,
            "y": y,
            "monitorWidth": w,
            "monitorHeight": h,
            "scale": m.scale,
            "area": meta.area.is_some(),
        });
        (duration, screen, events_in_video_time(events, meta.t0, duration))
    };

    if let Some(start) = meta.paused_at.take() {
        meta.pauses.push([start, duration]);
    }
    let cam = cam_meta.as_ref().map(|c| {
        json!({
            "file": c.name,
            "mime": c.mime,
            "offset": cam_offset,
            "video": c.has_video,
            "audio": c.has_audio,
        })
    });

    let project = json!({
        "version": 1,
        "title": "",
        "createdAt": created_at(dir),
        "duration": duration,
        "recovered": recovered,
        "screen": screen,
        "cam": cam,
        "pauses": meta.pauses,
        "events": events,
        "edits": null,
    });
    write_json(&dir.join("project.json"), &project)?;
    let _ = fs::remove_file(dir.join(SESSION_FILE));
    let _ = fs::remove_file(dir.join(EVENTS_FILE));
    let at = (duration / 2.0).min(1.0);
    let _ = match &cam_meta {
        Some(c) if meta.cam_only => make_thumbnail(ffmpeg_path, dir, &c.name, at - cam_offset),
        _ => make_thumbnail(ffmpeg_path, dir, "screen.mp4", at),
    };
    Ok(())
}

/// Opens the area picker on a monitor: a full-screen window over a screenshot of it.
/// The result comes back as the `area-picked` event (an area, or null when cancelled).
// Async: creates a window (see begin_recording).
#[tauri::command]
pub async fn pick_area(app: AppHandle, monitor: Monitor) -> Result<(), String> {
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.hide();
    }
    // Give the window time to disappear before the screenshot.
    tokio::time::sleep(Duration::from_millis(250)).await;

    let shot = app.path().app_cache_dir().map_err(|e| e.to_string())?.join("picker.jpg");
    let _ = fs::create_dir_all(shot.parent().unwrap());
    let grabbed = {
        let (ffmpeg_path, monitor, shot) = (app.state::<AppState>().ffmpeg.clone(), monitor.clone(), shot.clone());
        tauri::async_runtime::spawn_blocking(move || capture::grab_frame(&ffmpeg_path, &monitor, &shot))
            .await
            .map_err(|e| e.to_string())?
    };
    if let Err(e) = grabbed {
        if let Some(main) = app.get_webview_window("main") {
            let _ = main.show();
        }
        return Err(e);
    }
    let image = fs::read(&shot).map_err(|e| e.to_string())?;
    let _ = fs::remove_file(&shot);
    use base64::Engine;
    *app.state::<AppState>().picker.lock().unwrap() = Some(json!({
        "image": format!("data:image/jpeg;base64,{}", base64::engine::general_purpose::STANDARD.encode(image)),
        "windows": capture::list_windows(&monitor),
        "monitor": monitor,
    }));

    let picker = WebviewWindowBuilder::new(&app, "picker", WebviewUrl::App("index.html?w=picker".into()))
        .title("Stepcast")
        .decorations(false)
        .resizable(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .shadow(false)
        .visible(false)
        .build()
        .map_err(|e| e.to_string())?;
    let _ = picker.set_position(PhysicalPosition::new(monitor.x, monitor.y));
    let _ = picker.set_size(tauri::PhysicalSize::new(monitor.width, monitor.height));
    let _ = picker.show();
    let _ = picker.set_focus();
    Ok(())
}

#[tauri::command]
pub fn picker_data(state: tauri::State<AppState>) -> Option<Value> {
    state.picker.lock().unwrap().clone()
}

#[tauri::command]
pub async fn finish_pick(app: AppHandle, area: Option<Area>) -> Result<(), String> {
    app.state::<AppState>().picker.lock().unwrap().take();
    if let Some(picker) = app.get_webview_window("picker") {
        let _ = picker.destroy();
    }
    if area.is_none() {
        if let Some(main) = app.get_webview_window("main") {
            let _ = main.show();
            let _ = main.set_focus();
        }
    }
    let _ = app.emit_to("main", "area-picked", area);
    Ok(())
}

/// The folder name is the start time ("2026-10-17 14.32.05"); fall back to now.
fn created_at(dir: &Path) -> String {
    dir.file_name()
        .and_then(|n| n.to_str())
        .and_then(|n| chrono::NaiveDateTime::parse_from_str(n, "%Y-%m-%d %H.%M.%S").ok())
        .and_then(|d| d.and_local_timezone(chrono::Local).single())
        .unwrap_or_else(chrono::Local::now)
        .to_rfc3339()
}

/// Turns recordings that were cut off (crash, power loss, force quit) into normal projects.
/// Returns how many were recovered.
pub fn recover_interrupted(app: &AppHandle) -> usize {
    let state = app.state::<AppState>();
    let Ok(root) = projects_dir(app) else { return 0 };
    let Ok(entries) = fs::read_dir(&root) else { return 0 };
    let active = state.session.lock().unwrap().as_ref().map(|s| s.dir.clone());
    let mut recovered = 0;
    for dir in entries.filter_map(Result::ok).map(|e| e.path()) {
        if Some(&dir) == active.as_ref() || dir.join("project.json").exists() || !dir.join(SESSION_FILE).exists() {
            continue;
        }
        if recover_one(&state.ffmpeg, &dir).is_ok() {
            recovered += 1;
        } else if !has_media(&dir) {
            // Stopped before anything was recorded (e.g. during the countdown).
            let _ = fs::remove_dir_all(&dir);
        }
    }
    recovered
}

fn has_media(dir: &Path) -> bool {
    ["screen.mkv", "screen.mp4", "cam.webm", "cam.mp4"].iter().any(|f| fs::metadata(dir.join(f)).is_ok_and(|m| m.len() > 1024))
}

fn recover_one(ffmpeg_path: &Path, dir: &Path) -> Result<(), String> {
    let text = fs::read_to_string(dir.join(SESSION_FILE)).map_err(|e| e.to_string())?;
    let meta: SessionMeta = serde_json::from_str(&text).map_err(|e| e.to_string())?;
    if meta.t0 == 0 || !has_media(dir) {
        return Err("Nothing was recorded".into());
    }
    build_project(ffmpeg_path, dir, meta, read_events(&dir.join(EVENTS_FILE)), None, true)
}

fn read_events(path: &Path) -> Vec<Value> {
    let Ok(file) = File::open(path) else { return vec![] };
    BufReader::new(file)
        .lines()
        .map_while(Result::ok)
        .filter_map(|line| serde_json::from_str(&line).ok())
        .collect()
}

#[tauri::command]
pub async fn cancel_recording(app: AppHandle) -> Result<(), String> {
    let dir = tauri::async_runtime::spawn_blocking({
        let app = app.clone();
        move || {
            let state = app.state::<AppState>();
            state.hub.set_recording(false, None);
            let session = state.session.lock().unwrap().take();
            session.map(|mut s| {
                if let Some(c) = s.capture.take() {
                    c.stop();
                }
                drop(s.cam_file.take());
                s.dir
            })
        }
    })
    .await
    .map_err(|e| e.to_string())?;
    if let Some(dir) = dir {
        let _ = fs::remove_dir_all(dir);
    }
    close_pill_show_main(&app);
    Ok(())
}

pub fn write_json(path: &Path, value: &Value) -> Result<(), String> {
    let text = serde_json::to_string_pretty(value).map_err(|e| e.to_string())?;
    fs::write(path, text).map_err(|e| e.to_string())
}

fn remux(ffmpeg_path: &Path, dir: &Path, from: &str, to: &str) -> Result<(), String> {
    if !dir.join(from).exists() {
        return Err(format!("{from} not found"));
    }
    let status = ffmpeg::command(ffmpeg_path)
        .current_dir(dir)
        .args(["-hide_banner", "-loglevel", "error", "-y", "-i", from, "-c", "copy", "-movflags", "+faststart", to])
        .status()
        .map_err(|e| e.to_string())?;
    status.success().then_some(()).ok_or_else(|| format!("Could not remux {from}"))
}

/// Reads size and duration from ffmpeg's description of a file.
fn probe(ffmpeg_path: &Path, dir: &Path, file: &str) -> ffmpeg::MediaInfo {
    let Ok(out) = ffmpeg::command(ffmpeg_path).current_dir(dir).args(["-hide_banner", "-i", file]).output() else {
        return ffmpeg::MediaInfo::default();
    };
    ffmpeg::parse_media_info(&String::from_utf8_lossy(&out.stderr))
}

pub fn make_thumbnail(ffmpeg_path: &Path, dir: &Path, file: &str, at: f64) -> Result<(), String> {
    let status = ffmpeg::command(ffmpeg_path)
        .current_dir(dir)
        .args(["-hide_banner", "-loglevel", "error", "-y", "-ss", &format!("{:.2}", at.max(0.0)), "-i", file])
        .args(["-frames:v", "1", "-vf", "scale=640:-2", "-q:v", "4", "thumb.jpg"])
        .status()
        .map_err(|e| e.to_string())?;
    status.success().then_some(()).ok_or_else(|| "Thumbnail failed".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn converts_event_times_and_drops_countdown_events() {
        let events = vec![
            json!({"kind": "step", "t": 9_000, "name": "too early"}),
            json!({"kind": "step", "t": 10_100, "name": "a"}),
            json!({"kind": "step", "t": 12_500, "name": "b"}),
            json!({"kind": "blur", "t": 9_900, "rects": []}),
        ];
        let out = events_in_video_time(events, 10_000, 5.0);
        let times: Vec<f64> = out.iter().map(|e| e["time"].as_f64().unwrap()).collect();
        assert_eq!(times, vec![0.1, 2.5, 0.0]);
    }

    #[test]
    fn reads_folder_start_time() {
        let at = created_at(Path::new("/x/2026-10-17 14.32.05"));
        assert!(at.starts_with("2026-10-17T14:32:05"), "{at}");
    }

    #[test]
    fn skips_broken_event_lines() {
        let dir = std::env::temp_dir().join(format!("stepcast-test-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join(EVENTS_FILE);
        fs::write(&path, "{\"kind\":\"step\",\"t\":1}\n{\"kind\":\"st").unwrap();
        assert_eq!(read_events(&path).len(), 1);
        let _ = fs::remove_dir_all(dir);
    }
}
