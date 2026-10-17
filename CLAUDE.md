# Stepcast

Screen recorder for support videos: Tauri 2 desktop app (`app/`) + Chrome/Edge extension (`extension/`) that
labels browser actions ("Click 'Products'"). MIT licensed, Windows + macOS. See README.md for the overview.

## Layout

- `extension/src/naming.ts`: element → role, action and accessible name. `content.ts`: events and blur rects.
  `background.ts`: WebSocket to the app (`ws://127.0.0.1:47615`, extension origins only).
- `app/src-tauri/src/`: `capture.rs` (ffmpeg ddagrab / avfoundation → `screen.mkv`, remuxed to `screen.mp4`),
  `recorder.rs` (session, pill window, pause, `project.json`), `project.rs` (list/load/save/export/guide frames),
  `ffmpeg.rs` (sidecar lookup, encoder probe, export filtergraph), `ws_server.rs`.
- `app/src/lib/`: `steps.ts` (events → steps), `phrases.ts` (EN/DA), `layout.ts` (screen + webcam placement),
  `formats.ts` (output formats: Original, 16:9, 9:16, …), `ass.ts` (overlay geometry + ASS file), `zoom.ts`
  (zoom keyframes → zoompan expression + preview view), `exporter.ts` (export spec). The editor preview
  (`Overlay.svelte`, `Preview.svelte`) draws the same geometry as `ass.ts`/`zoom.ts`, so keep them in sync
  (`zoom.test.ts` checks the expression against the preview).

## Conventions

- Event times: the extension stamps epoch ms; Rust converts to seconds in the screen recording (`time`).
  "Source" time = raw recording, "output" time = after trims and pauses (`timeline.ts`).
- Three sources: desktop, desktop + webcam, webcam only. A webcam-only recording has `project.screen: null`
  (no ffmpeg capture; `t0` is set when recording starts and the camera file is the only export input).
  `edits.view` picks what a recording shows and `edits.format` the output size (`layout.ts` places it).
- Coordinates from the extension are physical desktop pixels; `project.screen.{x,y,monitorWidth}` maps them.
  For area recordings these describe the area (`screen.area: true`), not the whole monitor. The area
  picker (`Picker.svelte`, `pick_area`) shows a screenshot of the monitor; window snapping is Windows-only.
- While recording, `recording.json` + `events.jsonl` are kept in the folder; on startup
  `recover_interrupted` turns folders without `project.json` into projects (`recovered: true`).
- Every ffmpeg child goes through `ffmpeg::tie_to_app` (Windows job object), so a crash never leaves ffmpeg
  recording the screen.
- Commands that create windows must be `async` (sync commands run on the main thread and deadlock on Windows).
- libass draws text at `ASS_EM` (2048/2478) of the CSS size; measure and preview with that factor.

## Testing

- `npm test` (extension + app vitest), `cargo test` in `app/src-tauri`.
- Real export check: `STEPCAST_E2E_DIR=<recording folder> npx vitest run e2e` (in `app/`), then
  `cargo test export_e2e -- --ignored` with the same variable.
- Debug webviews: start with `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222` and attach
  over CDP. The pill window is excluded from screenshots on purpose.

## Releasing

Follow RELEASING.md: write `docs/releases/vX.Y.Z.md`, then `npm run release -- X.Y.Z`. CI builds, signs
the updater artifacts with the `TAURI_SIGNING_PRIVATE_KEY` secret and publishes the GitHub Release.
