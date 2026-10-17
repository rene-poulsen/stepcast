fn main() {
    // Used to find the dev copy of the ffmpeg sidecar (binaries/ffmpeg-<triple>).
    println!("cargo:rustc-env=TARGET_TRIPLE={}", std::env::var("TARGET").unwrap());
    tauri_build::build()
}
