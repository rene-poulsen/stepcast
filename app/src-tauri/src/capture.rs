//! Records one monitor, or an area of it, to `screen.mkv` with ffmpeg.

use std::fs::File;
use std::io::{BufRead, BufReader, Write};
use std::path::Path;
use std::process::{Child, ChildStdin, Stdio};
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

use crate::ffmpeg::{self, Encoder};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Monitor {
    pub index: usize,
    pub name: String,
    /// Physical pixels, virtual-desktop coordinates.
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub scale: f64,
    pub primary: bool,
}

/// Part of a monitor, in physical pixels relative to the monitor's top-left corner.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Area {
    pub x: i32,
    pub y: i32,
    pub w: u32,
    pub h: u32,
}

impl Area {
    /// Keeps the area inside the monitor, with even sizes (needed for H.264) and at least 64 px.
    pub fn fit(self, monitor: &Monitor) -> Area {
        let x = self.x.clamp(0, monitor.width as i32 - 64);
        let y = self.y.clamp(0, monitor.height as i32 - 64);
        let w = self.w.clamp(64, monitor.width - x as u32) & !1;
        let h = self.h.clamp(64, monitor.height - y as u32) & !1;
        Area { x, y, w, h }
    }
}

/// The ffmpeg filter that cuts out the area, or just makes the size even.
pub fn crop_filter(area: Option<Area>) -> String {
    match area {
        Some(a) => format!("crop={}:{}:{}:{}", a.w, a.h, a.x, a.y),
        None => "crop=trunc(iw/2)*2:trunc(ih/2)*2".into(),
    }
}

pub fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

pub struct Capture {
    child: Child,
    stdin: Option<ChildStdin>,
    /// Wall-clock time (epoch ms) of the first recorded frame; 0 until known.
    pub t0: Arc<AtomicI64>,
    /// Latest recorded position in milliseconds.
    pub recorded_ms: Arc<AtomicI64>,
}

#[cfg(windows)]
fn input_args(monitor: &Monitor) -> Vec<String> {
    let idx = dxgi_output_index(monitor).unwrap_or(monitor.index);
    vec![
        "-f".into(),
        "lavfi".into(),
        "-i".into(),
        format!("ddagrab=output_idx={idx}:framerate=30:draw_mouse=1,hwdownload,format=bgra"),
    ]
}

/// ddagrab numbers outputs across all adapters in DXGI order; match ours by position.
#[cfg(windows)]
fn dxgi_output_index(monitor: &Monitor) -> Option<usize> {
    use windows::Win32::Graphics::Dxgi::{CreateDXGIFactory1, IDXGIFactory1};
    unsafe {
        let factory: IDXGIFactory1 = CreateDXGIFactory1().ok()?;
        let mut idx = 0usize;
        let mut a = 0u32;
        while let Ok(adapter) = factory.EnumAdapters1(a) {
            let mut o = 0u32;
            while let Ok(output) = adapter.EnumOutputs(o) {
                if let Ok(desc) = output.GetDesc() {
                    let r = desc.DesktopCoordinates;
                    if r.left == monitor.x && r.top == monitor.y {
                        return Some(idx);
                    }
                }
                idx += 1;
                o += 1;
            }
            a += 1;
        }
    }
    None
}

#[cfg(target_os = "macos")]
fn input_args(monitor: &Monitor) -> Vec<String> {
    vec![
        "-f".into(),
        "avfoundation".into(),
        "-capture_cursor".into(),
        "1".into(),
        "-framerate".into(),
        "30".into(),
        "-i".into(),
        format!("Capture screen {}:none", monitor.index),
    ]
}

#[cfg(not(any(windows, target_os = "macos")))]
fn input_args(_monitor: &Monitor) -> Vec<String> {
    vec!["-f".into(), "x11grab".into(), "-framerate".into(), "30".into(), "-i".into(), ":0.0".into()]
}

impl Capture {
    pub fn start(ffmpeg_path: &Path, encoder: &Encoder, monitor: &Monitor, area: Option<Area>, dir: &Path) -> Result<Self, String> {
        let log = File::create(dir.join("ffmpeg-capture.log")).map_err(|e| e.to_string())?;
        let mut child = ffmpeg::command(ffmpeg_path)
            .current_dir(dir)
            .args(["-hide_banner", "-nostats", "-progress", "pipe:1", "-stats_period", "0.25"])
            .args(input_args(monitor))
            .args(["-vf", &format!("{},format=yuv420p", crop_filter(area))])
            .args(&encoder.args)
            .args(["-g", "60", "-y", "screen.mkv"])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::from(log))
            .spawn()
            .map_err(|e| format!("Could not start ffmpeg ({}): {e}", ffmpeg_path.display()))?;
        ffmpeg::tie_to_app(&child);

        let t0 = Arc::new(AtomicI64::new(0));
        let recorded_ms = Arc::new(AtomicI64::new(0));
        let stdout = child.stdout.take().expect("piped stdout");
        {
            let t0 = t0.clone();
            let recorded_ms = recorded_ms.clone();
            std::thread::spawn(move || {
                for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                    if let Some(secs) = ffmpeg::parse_out_time(&line) {
                        let ms = (secs * 1000.0) as i64;
                        recorded_ms.store(ms, Ordering::Relaxed);
                        if ms > 0 && t0.load(Ordering::Relaxed) == 0 {
                            t0.store(now_ms() - ms, Ordering::Relaxed);
                        }
                    }
                }
            });
        }

        let stdin = child.stdin.take();
        Ok(Capture { child, stdin, t0, recorded_ms })
    }

    /// Waits until ffmpeg has written its first frame, or fails if it exits.
    pub fn wait_started(&mut self, timeout: Duration) -> Result<i64, String> {
        let until = Instant::now() + timeout;
        while Instant::now() < until {
            let t0 = self.t0.load(Ordering::Relaxed);
            if t0 > 0 {
                return Ok(t0);
            }
            if let Ok(Some(status)) = self.child.try_wait() {
                return Err(format!("ffmpeg stopped right away ({status}). See ffmpeg-capture.log."));
            }
            std::thread::sleep(Duration::from_millis(20));
        }
        Err("Screen capture did not start in time. See ffmpeg-capture.log.".into())
    }

    /// Asks ffmpeg to finish the file, and kills it if it doesn't.
    pub fn stop(mut self) {
        if let Some(mut stdin) = self.stdin.take() {
            let _ = stdin.write_all(b"q");
            let _ = stdin.flush();
        }
        let until = Instant::now() + Duration::from_secs(15);
        while Instant::now() < until {
            if let Ok(Some(_)) = self.child.try_wait() {
                return;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

/// Saves one frame of the monitor as a JPEG (the backdrop for picking an area).
pub fn grab_frame(ffmpeg_path: &Path, monitor: &Monitor, out: &Path) -> Result<(), String> {
    let output = ffmpeg::command(ffmpeg_path)
        .args(["-hide_banner", "-loglevel", "error", "-y"])
        .args(input_args(monitor))
        .args(["-frames:v", "1", "-update", "1", "-q:v", "3"])
        .arg(out)
        .stdin(Stdio::null())
        .output()
        .map_err(|e| e.to_string())?;
    if output.status.success() && out.exists() {
        Ok(())
    } else {
        Err(format!("Could not take a screenshot: {}", String::from_utf8_lossy(&output.stderr).trim()))
    }
}

/// A visible window on a monitor, for "click a window" when picking an area.
#[derive(Debug, Clone, Serialize)]
pub struct WindowRect {
    pub title: String,
    #[serde(flatten)]
    pub area: Area,
}

/// Visible windows on the monitor, frontmost first, in monitor coordinates.
#[cfg(windows)]
pub fn list_windows(monitor: &Monitor) -> Vec<WindowRect> {
    use windows::core::BOOL;
    use windows::Win32::Foundation::{HWND, LPARAM, RECT};
    use windows::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_CLOAKED, DWMWA_EXTENDED_FRAME_BOUNDS};
    use windows::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetWindowTextW, GetWindowThreadProcessId, IsIconic, IsWindowVisible,
    };

    struct Ctx {
        list: Vec<(String, RECT)>,
        pid: u32,
    }

    unsafe extern "system" fn visit(hwnd: HWND, lparam: LPARAM) -> BOOL {
        let ctx = unsafe { &mut *(lparam.0 as *mut Ctx) };
        unsafe {
            let mut pid = 0u32;
            GetWindowThreadProcessId(hwnd, Some(&mut pid));
            if pid == ctx.pid || !IsWindowVisible(hwnd).as_bool() || IsIconic(hwnd).as_bool() {
                return BOOL(1);
            }
            let mut cloaked = 0u32;
            let _ = DwmGetWindowAttribute(hwnd, DWMWA_CLOAKED, &mut cloaked as *mut _ as *mut _, 4);
            if cloaked != 0 {
                return BOOL(1);
            }
            let mut buf = [0u16; 256];
            let len = GetWindowTextW(hwnd, &mut buf);
            if len == 0 {
                return BOOL(1);
            }
            let mut rect = RECT::default();
            if DwmGetWindowAttribute(hwnd, DWMWA_EXTENDED_FRAME_BOUNDS, &mut rect as *mut _ as *mut _, size_of::<RECT>() as u32)
                .is_ok()
            {
                ctx.list.push((String::from_utf16_lossy(&buf[..len as usize]), rect));
            }
        }
        BOOL(1)
    }

    let mut ctx = Ctx { list: Vec::new(), pid: std::process::id() };
    unsafe {
        let _ = EnumWindows(Some(visit), LPARAM(&mut ctx as *mut Ctx as isize));
    }
    ctx.list
        .into_iter()
        .filter_map(|(title, r)| {
            // Clip to the monitor and drop windows that are (nearly) off it.
            let left = (r.left - monitor.x).max(0);
            let top = (r.top - monitor.y).max(0);
            let right = (r.right - monitor.x).min(monitor.width as i32);
            let bottom = (r.bottom - monitor.y).min(monitor.height as i32);
            (right - left >= 64 && bottom - top >= 64).then(|| WindowRect {
                title,
                area: Area { x: left, y: top, w: (right - left) as u32, h: (bottom - top) as u32 },
            })
        })
        .collect()
}

/// Window snapping isn't available here yet; the user drags an area instead.
#[cfg(not(windows))]
pub fn list_windows(_monitor: &Monitor) -> Vec<WindowRect> {
    Vec::new()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn monitor() -> Monitor {
        Monitor { index: 0, name: "M".into(), x: 0, y: 0, width: 1920, height: 1080, scale: 1.0, primary: true }
    }

    #[test]
    fn areas_stay_on_the_monitor_with_even_sizes() {
        let a = Area { x: -10, y: 1000, w: 501, h: 300 }.fit(&monitor());
        assert_eq!(a, Area { x: 0, y: 1000, w: 500, h: 80 });
        let tiny = Area { x: 100, y: 100, w: 3, h: 3 }.fit(&monitor());
        assert_eq!((tiny.w, tiny.h), (64, 64));
    }

    #[test]
    fn crops_to_the_area() {
        assert_eq!(crop_filter(Some(Area { x: 10, y: 20, w: 640, h: 360 })), "crop=640:360:10:20");
        assert_eq!(crop_filter(None), "crop=trunc(iw/2)*2:trunc(ih/2)*2");
    }
}
