# Third-party licenses

Stepcast's own code is MIT licensed (see [LICENSE](LICENSE)). The installers also include:

## FFmpeg

Stepcast runs FFmpeg as a separate program (`ffmpeg` / `ffmpeg.exe` next to the app) to record the screen and
export videos. The bundled builds are licensed under the **GNU General Public License v3** because they include
GPL components such as libx264.

- Windows build: <https://github.com/BtbN/FFmpeg-Builds>
- macOS build: <https://ffmpeg.martin-riedl.de>
- Source code: <https://ffmpeg.org/download.html> and the build pages above

FFmpeg is a trademark of Fabrice Bellard. Stepcast is not affiliated with the FFmpeg project.

## Inter

The Inter typeface (`app/src-tauri/fonts`, and the app's interface font via `@fontsource/inter`) by Rasmus
Andersson is licensed under the **SIL Open Font License 1.1**: <https://github.com/rsms/inter/blob/master/LICENSE.txt>

## Libraries

The app and extension use open-source libraries under MIT, Apache-2.0 and similar permissive licenses,
including Tauri, Svelte, tokio, tungstenite, serde and dom-accessibility-api. Their license texts are in each
package (`node_modules/*/LICENSE`, and `cargo license` for the Rust crates).
