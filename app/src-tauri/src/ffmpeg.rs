//! Finding the bundled ffmpeg, choosing an encoder and building export filtergraphs.

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use serde::Deserialize;

/// Builds a `Command` that never opens a console window on Windows.
pub fn command(program: &Path) -> Command {
    #[allow(unused_mut)]
    let mut cmd = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

/// Makes sure the child dies with the app. Without this, a crashed app would leave ffmpeg
/// recording the screen in the background. (On macOS ffmpeg stops by itself: its progress
/// output goes to a pipe that closes with the app.)
#[cfg(windows)]
pub fn tie_to_app(child: &std::process::Child) {
    use std::os::windows::io::AsRawHandle;
    use std::sync::OnceLock;
    use windows::Win32::Foundation::HANDLE;
    use windows::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation, SetInformationJobObject,
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };

    // The job handle is never closed while the app runs; Windows closes it when the app exits.
    static JOB: OnceLock<Option<isize>> = OnceLock::new();
    let job = JOB.get_or_init(|| unsafe {
        let job = CreateJobObjectW(None, None).ok()?;
        let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        SetInformationJobObject(
            job,
            JobObjectExtendedLimitInformation,
            &info as *const _ as *const _,
            std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        )
        .ok()?;
        Some(job.0 as isize)
    });
    if let Some(job) = job {
        unsafe {
            let _ = AssignProcessToJobObject(HANDLE(*job as *mut _), HANDLE(child.as_raw_handle()));
        }
    }
}

#[cfg(not(windows))]
pub fn tie_to_app(_child: &std::process::Child) {}

/// The sidecar next to the app binary, the dev copy in `binaries/`, or `ffmpeg` on PATH.
pub fn locate() -> PathBuf {
    let exe_name = if cfg!(windows) { "ffmpeg.exe" } else { "ffmpeg" };
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let bundled = dir.join(exe_name);
            if bundled.exists() {
                return bundled;
            }
        }
    }
    let dev = Path::new(env!("CARGO_MANIFEST_DIR")).join("binaries").join(format!(
        "ffmpeg-{}{}",
        env!("TARGET_TRIPLE"),
        if cfg!(windows) { ".exe" } else { "" }
    ));
    if dev.exists() {
        return dev;
    }
    PathBuf::from(exe_name)
}

/// A hardware or software H.264 encoder and the arguments it needs for screen content.
#[derive(Debug, Clone)]
pub struct Encoder {
    pub name: &'static str,
    pub args: Vec<&'static str>,
}

fn candidates() -> Vec<Encoder> {
    let mut list = Vec::new();
    if cfg!(windows) {
        list.push(Encoder {
            name: "h264_nvenc",
            args: vec!["-c:v", "h264_nvenc", "-preset", "p4", "-tune", "ll", "-rc", "vbr", "-cq", "19", "-b:v", "0"],
        });
        list.push(Encoder {
            name: "h264_qsv",
            args: vec!["-c:v", "h264_qsv", "-preset", "faster", "-global_quality", "20"],
        });
        list.push(Encoder {
            name: "h264_amf",
            args: vec!["-c:v", "h264_amf", "-quality", "speed", "-rc", "cqp", "-qp_i", "18", "-qp_p", "20"],
        });
    }
    if cfg!(target_os = "macos") {
        list.push(Encoder {
            name: "h264_videotoolbox",
            args: vec!["-c:v", "h264_videotoolbox", "-realtime", "1", "-b:v", "24M"],
        });
    }
    list.push(software_encoder());
    list
}

fn software_encoder() -> Encoder {
    Encoder {
        name: "libx264",
        args: vec!["-c:v", "libx264", "-preset", "ultrafast", "-tune", "zerolatency", "-crf", "18"],
    }
}

/// Picks the first encoder that can actually encode a frame on this machine.
pub fn probe_encoder(ffmpeg: &Path) -> Encoder {
    for enc in candidates() {
        if enc.name == "libx264" {
            return enc;
        }
        let ok = command(ffmpeg)
            .args(["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=s=640x360:r=30", "-frames:v", "3"])
            .args(&enc.args)
            .args(["-pix_fmt", "yuv420p", "-f", "null", "-"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map(|s| s.success())
            .unwrap_or(false);
        if ok {
            return enc;
        }
    }
    software_encoder()
}

/// Escapes a path for use as a quoted filter option value: `fontsdir='…'`.
pub fn filter_path(path: &Path) -> String {
    path.to_string_lossy()
        .replace('\\', "/")
        .replace(':', "\\:")
        .replace('\'', "'\\''")
}

#[derive(Debug, Clone, Copy, Deserialize, PartialEq)]
pub struct BoxSpec {
    pub x: i64,
    pub y: i64,
    pub w: i64,
    pub h: i64,
}

/// A blurred area on the raw screen recording, in source pixels and source seconds.
#[derive(Debug, Clone, Deserialize)]
pub struct BlurSpec {
    pub start: f64,
    pub end: f64,
    pub x: i64,
    pub y: i64,
    pub w: i64,
    pub h: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CamSpec {
    #[serde(rename = "box")]
    pub area: BoxSpec,
    /// Seconds between the screen recording's start and the camera file's start.
    pub offset: f64,
    pub video: bool,
    pub audio: bool,
    /// Which part of the camera image shows when it is cropped to the box: 0 = left, 1 = right.
    #[serde(default = "centre")]
    pub focus_x: f64,
    /// Corner radius cut out of the camera image when it floats over the screen; 0 for none.
    #[serde(default)]
    pub radius: i64,
}

/// Filters that make the camera's corners transparent (anti-aliased by one pixel), so it can sit on
/// top of the screen. Empty for square corners.
fn round_corners(radius: i64) -> String {
    if radius <= 0 {
        return String::new();
    }
    let r = radius;
    format!(
        ",format=yuva420p,geq=lum='lum(X\\,Y)':cb='cb(X\\,Y)':cr='cr(X\\,Y)':\
         a='clip(255*({r}+0.5-hypot(max(0\\,abs(X+0.5-W/2)-(W/2-{r}))\\,max(0\\,abs(Y+0.5-H/2)-(H/2-{r}))))\\,0\\,255)'"
    )
}

fn centre() -> f64 {
    0.5
}

/// Everything the export needs. The app UI computes the layout so preview and export match.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportSpec {
    pub width: i64,
    pub height: i64,
    pub src_width: i64,
    pub src_height: i64,
    /// Ranges of source time to keep, in order.
    pub keeps: Vec<[f64; 2]>,
    pub blurs: Vec<BlurSpec>,
    /// Where the screen goes; None when only the webcam is shown (the screen isn't an input then).
    pub screen_box: Option<BoxSpec>,
    pub cam: Option<CamSpec>,
    pub background: String,
    /// Output duration in seconds, for the progress bar.
    pub duration: f64,
    /// "Zoom to clicks": zoompan expressions of output time `it`.
    #[serde(default)]
    pub zoom: Option<ZoomSpec>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ZoomSpec {
    pub z: String,
    pub x: String,
    pub y: String,
}

impl ZoomSpec {
    /// Expressions are built by the app, but never let anything else into the filtergraph.
    fn is_safe(&self) -> bool {
        [&self.z, &self.x, &self.y]
            .iter()
            .all(|e| e.chars().all(|c| c.is_ascii_alphanumeric() || "().,+-*/_ ".contains(c)))
    }
}

fn select_expr(keeps: &[[f64; 2]]) -> String {
    keeps
        .iter()
        .map(|[a, b]| format!("between(t\\,{a:.3}\\,{b:.3})"))
        .collect::<Vec<_>>()
        .join("+")
}

fn clamp_blur(b: &BlurSpec, w: i64, h: i64) -> Option<(i64, i64, i64, i64)> {
    let x = b.x.clamp(0, w);
    let y = b.y.clamp(0, h);
    let right = (b.x + b.w).clamp(0, w);
    let bottom = (b.y + b.h).clamp(0, h);
    // Even sizes keep chroma subsampling happy.
    let bw = (right - x) & !1;
    let bh = (bottom - y) & !1;
    (bw >= 4 && bh >= 4).then_some((x & !1, y & !1, bw, bh))
}

/// Adds blurred boxes on input 0 to `parts` and returns the label of the result.
/// With `timed`, each box only shows between its start and end.
pub fn blur_chain(parts: &mut Vec<String>, blurs: &[BlurSpec], src_w: i64, src_h: i64, timed: bool) -> String {
    let mut cur = "0:v".to_string();
    for (i, blur) in blurs.iter().enumerate() {
        let Some((x, y, w, h)) = clamp_blur(blur, src_w, src_h) else { continue };
        // Chroma planes are half size, so the radius must stay below a quarter of the box.
        let radius = (w.min(h) / 4 - 1).clamp(1, 24);
        let enable = if timed { format!(":enable='between(t,{:.3},{:.3})'", blur.start, blur.end) } else { String::new() };
        parts.push(format!(
            "[{cur}]split[bm{i}][bs{i}];[bs{i}]crop={w}:{h}:{x}:{y},boxblur={radius}:3[bb{i}];\
             [bm{i}][bb{i}]overlay={x}:{y}{enable}[b{i}]"
        ));
        cur = format!("b{i}");
    }
    cur
}

/// The ffmpeg input index of the camera file: after the screen, or first when there is no screen.
pub fn cam_input(spec: &ExportSpec) -> usize {
    if spec.screen_box.is_some() { 1 } else { 0 }
}

/// Builds the `-filter_complex` graph. Input 0 is the screen and input 1 the camera file;
/// without a screen box the camera file is input 0. Outputs `[v]` and, when there is audio, `[a]`.
pub fn build_graph(spec: &ExportSpec, fonts_dir: &Path) -> String {
    let mut parts: Vec<String> = Vec::new();
    let select = select_expr(&spec.keeps);
    let cam_in = cam_input(spec);

    let background = format!("color=c=0x{}:s={}x{}:r=30[bg]", spec.background, spec.width, spec.height);
    let mut base = "bg".to_string();
    if let Some(sb) = spec.screen_box {
        let cur = blur_chain(&mut parts, &spec.blurs, spec.src_width, spec.src_height, true);
        // zoompan runs after the cuts, so its expressions use output time.
        let zoom = match &spec.zoom {
            Some(z) if z.is_safe() => format!(
                "zoompan=z='{}':x='{}':y='{}':d=1:s={}x{}:fps=30,",
                z.z, z.x, z.y, spec.src_width, spec.src_height
            ),
            _ => String::new(),
        };
        parts.push(format!(
            "[{cur}]select='{select}',setpts=N/FRAME_RATE/TB,{zoom}scale={}:{}:flags=lanczos,setsar=1[scr]",
            sb.w, sb.h
        ));
        let full = sb == BoxSpec { x: 0, y: 0, w: spec.width, h: spec.height };
        if full && !spec.cam.as_ref().is_some_and(|c| c.video) {
            base = "scr".to_string();
        } else {
            parts.push(format!("{background};[bg][scr]overlay={}:{}:shortest=1[lay]", sb.x, sb.y));
            base = "lay".to_string();
        }
    } else {
        parts.push(background);
    }

    if let Some(cam) = spec.cam.as_ref().filter(|c| c.video) {
        let b = cam.area;
        let fx = cam.focus_x.clamp(0.0, 1.0);
        // Without a screen nothing else ends the video, so the camera does.
        let eof = if spec.screen_box.is_some() { "repeat" } else { "endall" };
        parts.push(format!(
            "[{cam_in}:v]fps=30,select='{select}',setpts=N/FRAME_RATE/TB,\
             scale={}:{}:force_original_aspect_ratio=increase,crop={}:{}:(iw-ow)*{fx:.3}:(ih-oh)/2,setsar=1{}[cam];\
             [{base}][cam]overlay={}:{}:eof_action={eof}[withcam]",
            b.w, b.h, b.w, b.h, round_corners(cam.radius), b.x, b.y
        ));
        base = "withcam".to_string();
    }

    parts.push(format!(
        "[{base}]subtitles=filename=overlay.ass:fontsdir='{}',format=yuv420p[v]",
        filter_path(fonts_dir)
    ));

    if spec.cam.as_ref().is_some_and(|c| c.audio) {
        let aselect = select_expr(&spec.keeps);
        parts.push(format!("[{cam_in}:a]aselect='{aselect}',asetpts=N/SR/TB,aresample=async=1[a]"));
    }

    parts.join(";\n")
}

/// Parses `out_time_us=…` from ffmpeg's `-progress` output.
pub fn parse_out_time(line: &str) -> Option<f64> {
    let value = line.strip_prefix("out_time_us=")?;
    value.trim().parse::<f64>().ok().map(|us| us / 1_000_000.0)
}

#[derive(Debug, Default, PartialEq)]
pub struct MediaInfo {
    pub size: Option<(u32, u32)>,
    pub duration: Option<f64>,
}

/// Reads "Duration: 00:01:02.50" and the first video stream's "1920x1080" from `ffmpeg -i` output.
pub fn parse_media_info(stderr: &str) -> MediaInfo {
    let size = stderr.lines().find(|l| l.contains("Stream #") && l.contains("Video:")).and_then(|line| {
        line.split([',', ' ']).find_map(|part| {
            let (w, h) = part.split_once('x')?;
            Some((w.parse().ok()?, h.parse().ok()?))
        })
    });
    let duration = stderr.lines().find_map(|l| {
        let rest = l.trim().strip_prefix("Duration: ")?;
        let mut parts = rest.split(',').next()?.split(':');
        let (h, m, s) = (parts.next()?.parse::<f64>().ok()?, parts.next()?.parse::<f64>().ok()?, parts.next()?.parse::<f64>().ok()?);
        Some(h * 3600.0 + m * 60.0 + s)
    });
    MediaInfo { size, duration }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_media_info() {
        let s = "  Duration: 00:01:02.50, start: 0.000000, bitrate: 1200 kb/s\n  Stream #0:0: Video: h264 (High) (avc1 / 0x31637661), yuv420p(tv, bt709, progressive), 2048x1152 [SAR 1:1 DAR 16:9], 30 fps";
        assert_eq!(parse_media_info(s), MediaInfo { size: Some((2048, 1152)), duration: Some(62.5) });
        assert_eq!(parse_media_info("  Duration: N/A, bitrate: N/A\nStream #0:1: Audio: aac"), MediaInfo::default());
    }

    fn spec() -> ExportSpec {
        ExportSpec {
            width: 1920,
            height: 1080,
            src_width: 1920,
            src_height: 1080,
            keeps: vec![[0.0, 4.5], [7.25, 12.0]],
            blurs: vec![],
            screen_box: Some(BoxSpec { x: 0, y: 0, w: 1920, h: 1080 }),
            cam: None,
            background: "F4F4F2".into(),
            duration: 9.25,
            zoom: None,
        }
    }

    #[test]
    fn adds_zoom_only_with_safe_expressions() {
        let mut s = spec();
        s.zoom = Some(ZoomSpec { z: "if(lt(it,(1)),(1),(1.8))".into(), x: "(10)".into(), y: "(20)".into() });
        assert!(build_graph(&s, Path::new("/f")).contains("zoompan=z='if(lt(it,(1)),(1),(1.8))':x='(10)':y='(20)':d=1:s=1920x1080"));
        s.zoom = Some(ZoomSpec { z: "1';[0:v]evil".into(), x: "0".into(), y: "0".into() });
        assert!(!build_graph(&s, Path::new("/f")).contains("zoompan"));
    }

    #[test]
    fn escapes_windows_paths() {
        assert_eq!(filter_path(Path::new(r"C:\Users\a b\fonts")), r"C\:/Users/a b/fonts");
        assert_eq!(filter_path(Path::new("/x/it's")), r"/x/it'\''s");
    }

    #[test]
    fn plain_screen_has_no_background_or_audio() {
        let g = build_graph(&spec(), Path::new("/fonts"));
        assert!(g.contains("select='between(t\\,0.000\\,4.500)+between(t\\,7.250\\,12.000)'"));
        assert!(!g.contains("color="));
        assert!(!g.contains("[a]"));
        assert!(g.ends_with("[v]"));
    }

    #[test]
    fn webcam_layout_places_screen_and_camera() {
        let mut s = spec();
        s.screen_box = Some(BoxSpec { x: 28, y: 144, w: 1412, h: 794 });
        s.cam = Some(CamSpec {
            area: BoxSpec { x: 1468, y: 258, w: 424, h: 566 },
            offset: -0.2,
            video: true,
            audio: true,
            focus_x: 0.5,
            radius: 0,
        });
        let g = build_graph(&s, Path::new("/fonts"));
        assert!(g.contains("scale=1412:794"));
        assert!(g.contains("[bg][scr]overlay=28:144"));
        assert!(g.contains("crop=424:566:(iw-ow)*0.500:(ih-oh)/2"));
        assert!(g.contains("[1:v]fps=30"));
        assert!(g.contains("overlay=1468:258:eof_action=repeat"));
        assert!(g.contains("[1:a]aselect="));
        assert!(!g.contains("geq"));
    }

    #[test]
    fn floating_webcam_gets_transparent_corners() {
        let mut s = spec();
        s.screen_box = Some(BoxSpec { x: 0, y: 0, w: 1920, h: 1080 });
        s.cam = Some(CamSpec {
            area: BoxSpec { x: 1480, y: 776, w: 384, h: 288 },
            offset: 0.0,
            video: true,
            audio: false,
            focus_x: 0.5,
            radius: 17,
        });
        let g = build_graph(&s, Path::new("/fonts"));
        assert!(g.contains("setsar=1,format=yuva420p,geq=lum='lum(X\\,Y)'"));
        assert!(g.contains("a='clip(255*(17+0.5-hypot("));
        assert!(g.contains("[lay][cam]overlay=1480:776"));
    }

    #[test]
    fn webcam_only_uses_the_camera_as_the_first_input() {
        let mut s = spec();
        s.width = 1080;
        s.height = 1920;
        s.screen_box = None;
        s.blurs = vec![BlurSpec { start: 1.0, end: 2.0, x: 10, y: 10, w: 100, h: 100 }];
        s.cam = Some(CamSpec {
            area: BoxSpec { x: 0, y: 0, w: 1080, h: 1920 },
            offset: -0.3,
            video: true,
            audio: true,
            focus_x: 0.0,
            radius: 0,
        });
        let g = build_graph(&s, Path::new("/fonts"));
        assert!(g.starts_with("color=c=0xF4F4F2:s=1080x1920:r=30[bg]"));
        assert!(!g.contains("[scr]") && !g.contains("boxblur") && !g.contains("[1:"));
        assert!(g.contains("[0:v]fps=30"));
        assert!(g.contains("crop=1080:1920:(iw-ow)*0.000:(ih-oh)/2"));
        assert!(g.contains("[bg][cam]overlay=0:0:eof_action=endall"));
        assert!(g.contains("[0:a]aselect="));
    }

    #[test]
    fn blur_regions_are_clamped_and_even() {
        let mut s = spec();
        s.blurs = vec![
            BlurSpec { start: 1.0, end: 2.0, x: 1900, y: 1001, w: 100, h: 101 },
            BlurSpec { start: 1.0, end: 2.0, x: 5000, y: 0, w: 10, h: 10 },
        ];
        let g = build_graph(&s, Path::new("/fonts"));
        assert!(g.contains("crop=20:78:1900:1000"));
        assert!(!g.contains("[b1]"));
    }

    #[test]
    fn reads_progress_time() {
        assert_eq!(parse_out_time("out_time_us=1500000"), Some(1.5));
        assert_eq!(parse_out_time("out_time_us=N/A"), None);
        assert_eq!(parse_out_time("frame=3"), None);
    }
}
