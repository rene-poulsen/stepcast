//! Saved recordings: listing, loading, saving, exporting.

use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::Stdio;

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};

use crate::ffmpeg::{self, BlurSpec, ExportSpec};
use crate::recorder::{projects_dir, write_json, AppState};

fn read_json(path: &Path) -> Result<Value, String> {
    let text = fs::read_to_string(path).map_err(|e| format!("{}: {e}", path.display()))?;
    serde_json::from_str(&text).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_projects(app: AppHandle) -> Result<Vec<Value>, String> {
    let root = projects_dir(&app)?;
    let Ok(entries) = fs::read_dir(&root) else { return Ok(vec![]) };
    let mut list: Vec<Value> = entries
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let dir = entry.path();
            let project = read_json(&dir.join("project.json")).ok()?;
            Some(json!({
                "dir": dir.to_string_lossy(),
                "title": project["title"],
                "createdAt": project["createdAt"],
                "duration": project["duration"],
                "steps": project["events"].as_array().map(|e| e.iter().filter(|e| e["kind"] == "step").count()),
                "thumb": dir.join("thumb.jpg").exists().then(|| dir.join("thumb.jpg").to_string_lossy().into_owned()),
                "exported": dir.join("export.mp4").exists(),
                "recovered": project["recovered"].as_bool().unwrap_or(false),
            }))
        })
        .collect();
    list.sort_by(|a, b| b["createdAt"].as_str().cmp(&a["createdAt"].as_str()));
    Ok(list)
}

#[tauri::command]
pub fn load_project(dir: String) -> Result<Value, String> {
    read_json(&Path::new(&dir).join("project.json"))
}

#[tauri::command]
pub fn save_project(dir: String, project: Value) -> Result<(), String> {
    write_json(&Path::new(&dir).join("project.json"), &project)
}

#[tauri::command]
pub fn delete_project(app: AppHandle, dir: String) -> Result<(), String> {
    let root = projects_dir(&app)?;
    let dir = PathBuf::from(dir);
    // Only ever delete recordings inside our own folder.
    if !dir.starts_with(&root) || !dir.join("project.json").exists() {
        return Err("Not a Stepcast recording".into());
    }
    fs::remove_dir_all(dir).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn write_text_file(path: String, contents: String) -> Result<(), String> {
    let path = PathBuf::from(path);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(path, contents).map_err(|e| e.to_string())
}

pub fn fonts_dir(app: &AppHandle) -> PathBuf {
    let bundled = app.path().resource_dir().map(|d| d.join("fonts")).ok();
    match bundled {
        Some(d) if d.exists() => d,
        _ => Path::new(env!("CARGO_MANIFEST_DIR")).join("fonts"),
    }
}

/// Writes the overlay and graph into `dir` and runs ffmpeg, reporting progress (0–1).
pub fn run_export(
    ffmpeg_path: &Path,
    fonts: &Path,
    dir: &Path,
    spec: &ExportSpec,
    ass: &str,
    output: &str,
    mut progress: impl FnMut(f64),
) -> Result<(), String> {
    let project = read_json(&dir.join("project.json"))?;
    fs::write(dir.join("overlay.ass"), ass).map_err(|e| e.to_string())?;
    fs::write(dir.join("export-graph.txt"), ffmpeg::build_graph(spec, fonts)).map_err(|e| e.to_string())?;
    let mut cmd = ffmpeg::command(ffmpeg_path);
    cmd.current_dir(dir).args(["-hide_banner", "-nostats", "-progress", "pipe:1", "-y"]);
    // Only the webcam is shown (or recorded): the screen isn't an input at all.
    if spec.screen_box.is_some() {
        cmd.args(["-i", project["screen"]["file"].as_str().unwrap_or("screen.mp4")]);
    } else if spec.cam.as_ref().is_none_or(|c| !c.video) {
        return Err("Nothing to export".into());
    }
    if let Some(cam) = &spec.cam {
        let file = project["cam"]["file"].as_str().ok_or("Recording has no camera file")?;
        cmd.args(["-itsoffset", &format!("{:.3}", cam.offset), "-i", file]);
    }
    cmd.args(["-/filter_complex", "export-graph.txt", "-map", "[v]"]);
    if spec.cam.as_ref().is_some_and(|c| c.audio) {
        cmd.args(["-map", "[a]", "-c:a", "aac", "-b:a", "160k"]);
    }
    cmd.args(["-c:v", "libx264", "-preset", "medium", "-crf", "20", "-r", "30", "-movflags", "+faststart"])
        .arg(output)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::from(fs::File::create(dir.join("ffmpeg-export.log")).map_err(|e| e.to_string())?));

    let mut child = cmd.spawn().map_err(|e| e.to_string())?;
    ffmpeg::tie_to_app(&child);
    let stdout = child.stdout.take().expect("piped stdout");
    for line in BufReader::new(stdout).lines().map_while(Result::ok) {
        if let Some(secs) = ffmpeg::parse_out_time(&line) {
            progress((secs / spec.duration.max(0.1)).min(1.0));
        }
    }
    let status = child.wait().map_err(|e| e.to_string())?;
    if !status.success() {
        return Err("Export failed. See ffmpeg-export.log in the recording folder.".into());
    }
    progress(1.0);
    Ok(())
}

/// Renders the final MP4. Emits `export-progress` with a value from 0 to 1.
#[tauri::command]
pub async fn export_video(app: AppHandle, dir: String, spec: ExportSpec, ass: String, output: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        run_export(&state.ffmpeg, &fonts_dir(&app), Path::new(&dir), &spec, &ass, &output, |p| {
            let _ = app.emit("export-progress", p);
        })?;
        Ok(output)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Saves one JPEG per time (seconds in the screen recording) to `out_dir/step-N.jpg`.
#[derive(serde::Deserialize)]
pub struct FrameSpec {
    time: f64,
    /// Areas to blur in this frame, in screen-video pixels.
    blurs: Vec<BlurSpec>,
}

#[tauri::command]
pub async fn extract_frames(
    app: AppHandle,
    dir: String,
    frames: Vec<FrameSpec>,
    src_width: i64,
    src_height: i64,
    out_dir: String,
) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        fs::create_dir_all(&out_dir).map_err(|e| e.to_string())?;
        let mut files = Vec::new();
        for (i, frame) in frames.iter().enumerate() {
            let name = format!("step-{}.jpg", i + 1);
            let target = Path::new(&out_dir).join(&name);
            let mut parts = Vec::new();
            let last = ffmpeg::blur_chain(&mut parts, &frame.blurs, src_width, src_height, false);
            parts.push(format!("[{last}]scale='min(1600,iw)':-2[v]"));
            let ok = ffmpeg::command(&state.ffmpeg)
                .current_dir(&dir)
                .args(["-hide_banner", "-loglevel", "error", "-y", "-ss", &format!("{:.3}", frame.time), "-i", "screen.mp4"])
                .args(["-filter_complex", &parts.join(";"), "-map", "[v]", "-frames:v", "1", "-q:v", "3"])
                .arg(&target)
                .status()
                .map(|s| s.success())
                .unwrap_or(false);
            if !ok {
                return Err(format!("Could not grab the frame for step {}", i + 1));
            }
            files.push(name);
        }
        Ok(files)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Runs a real export with the dev ffmpeg. Set STEPCAST_E2E_DIR to a folder with
    /// project.json, screen.mp4, cam.webm, overlay.ass and spec.json (made by the app e2e script).
    #[test]
    #[ignore]
    fn export_e2e() {
        let dir = PathBuf::from(std::env::var("STEPCAST_E2E_DIR").expect("STEPCAST_E2E_DIR"));
        let spec: ExportSpec = serde_json::from_str(&fs::read_to_string(dir.join("spec.json")).unwrap()).unwrap();
        let ass = fs::read_to_string(dir.join("overlay.ass")).unwrap();
        let fonts = Path::new(env!("CARGO_MANIFEST_DIR")).join("fonts");
        let out = dir.join("export.mp4");
        let mut last = 0.0;
        run_export(&ffmpeg::locate(), &fonts, &dir, &spec, &ass, out.to_str().unwrap(), |p| last = p).unwrap();
        assert_eq!(last, 1.0);
        assert!(out.exists());
    }
}
