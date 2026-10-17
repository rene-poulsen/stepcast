# Stepcast

A free screen recorder for support videos. Record what you do in the browser and Stepcast adds a label for
every step: **"Click 'Products'"**, **"Click 'About us' link"**, **"Enter 'Username'"**, **"Check 'I accept the
terms & conditions'"**. Your customers can follow along without guessing where you clicked.

- Records the **whole screen** as MP4 at your screen's own resolution, or just **an area or a window** of it
- Labels in **English or Danish** (switch any time, even after recording)
- Optional **webcam panel next to the screen**, never on top of it, with an adjustable size
- **Click ripple** and a **highlight** around the element you clicked
- **Keyboard labels** for Enter, Esc and shortcuts: "Press Ctrl+S" (can be turned off)
- **Zoom in on clicks** (optional): the video zooms in on what you click and back out again
- **Blurs password fields** automatically, plus any field you pick
- **Review before export**: edit or remove labels, trim the start and end, pause while recording
- **Step-by-step guide export**: an HTML page and a Markdown file with one screenshot per step
- **Recovers interrupted recordings**: if the app or computer stops mid-recording, the recording is rebuilt the next time Stepcast opens
- Windows and macOS. No account, no API key, nothing leaves your computer.

MIT licensed. Free to use, change and share.

## Install

1. Download the newest version from [Releases](https://github.com/rene-poulsen/stepcast/releases/latest):
   - **Windows:** `Stepcast_x.y.z_x64-setup.exe`
   - **macOS:** `Stepcast_x.y.z_universal.dmg` (Apple Silicon and Intel)
2. Install it like any other program.
   - **Windows** may show "Windows protected your PC" because the app isn't code-signed. Click **More info →
     Run anyway**.
   - **macOS** may say the app "can't be opened". Open **System Settings → Privacy & Security** and click
     **Open Anyway**. The first time you record, allow **Screen Recording**, **Camera** and **Microphone**
     there too, then restart Stepcast.
3. Open Stepcast and follow **Install the browser extension**. It shows the folder to load in Chrome, Edge,
   Brave or Arc (`chrome://extensions` → Developer mode → **Load unpacked**).

Stepcast checks for updates when it starts and shows **Update available** when a new version is out. One click
installs it. If the update includes a new extension, Stepcast tells you to click **reload** on the extension.

## Use it

1. Choose **Entire screen** or **Area**, then press the big record button or **Ctrl+Alt+R** (**⌘⌥R** on
   Mac). With **Area**, drag a rectangle on the screen, or click a window to select exactly that window
   (Windows), and press **Record** or Enter. Recording starts after a 3-second countdown.
2. Do the task in your browser. A small control window (hidden from the recording) shows the time, and has
   pause and stop buttons. **Ctrl+Alt+P** (**⌘⌥P**) pauses; paused parts are left out of the video.
3. Stop with the button or **Ctrl+Alt+R** again. The recording opens in the editor:
   - Change or remove labels in the **Steps** list, and switch between **EN** and **DA**.
   - Drag the ends of the timeline to trim.
   - Turn the webcam panel on or off, and choose its size and side.
   - Under **Effects**, turn the click ripple, highlight, blur, keyboard labels and **Zoom in on clicks** on or
     off. Zoom is off until you turn it on.
4. **Export video** saves an MP4. **Export guide** saves `guide/index.html` and `guide/guide.md` in the
   recording's folder.

Recordings are kept in `Videos/Stepcast` (`Movies/Stepcast` on Mac).

The extension is optional: without it you can still record anything on your screen, with webcam, pause, trim
and zoom. You only miss the automatic step labels.

**Blur a field:** click the Stepcast extension icon → **Pick element to blur**, then click the field. Stepcast
remembers it for that website. Password fields are always blurred.

## How it works

| Part | What it does |
| --- | --- |
| `app/` | Desktop app (Tauri 2: Rust + Svelte). Records the screen with ffmpeg, the webcam and microphone in a webview, and exports the final MP4 with ffmpeg. |
| `extension/` | Browser extension. Reads what you click, focus, check and select, using each element's accessible name. Sends it to the app over `127.0.0.1` only. It never sends what you type. |
| `shared/` | The messages the two exchange. |

The labels are drawn as subtitles (ASS) and burned into the video. The editor previews the same layout.

## Develop

You need [Node.js 22](https://nodejs.org), [Rust](https://rustup.rs) and, on Windows, the
[WebView2 runtime](https://developer.microsoft.com/microsoft-edge/webview2/) (already part of Windows 11).

```bash
npm install
npm run ffmpeg          # downloads ffmpeg for this computer into app/src-tauri/binaries/
npm run dev             # builds the extension and starts the app
npm test                # extension + app unit tests
cd app/src-tauri && cargo test
```

Load `extension/dist/chrome` as an unpacked extension while developing. `extension/test/playground.html` has
one of every kind of element to try.

## Releasing a new version

See [RELEASING.md](RELEASING.md).

## License

[MIT](LICENSE). Stepcast ships [ffmpeg](https://ffmpeg.org) as a separate program and the
[Inter](https://rsms.me/inter/) font; see [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md).
