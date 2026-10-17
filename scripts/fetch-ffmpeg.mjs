// Puts an ffmpeg build at app/src-tauri/binaries/ffmpeg-<target-triple>[.exe] for Tauri to bundle.
//
//   node scripts/fetch-ffmpeg.mjs                 download for this machine
//   node scripts/fetch-ffmpeg.mjs --target <triple>
//   node scripts/fetch-ffmpeg.mjs --from-path     copy the ffmpeg already on PATH (quick for local dev)
//
// Builds used (GPL, shipped as a separate program; see THIRD_PARTY_LICENSES.md):
//   Windows: BtbN/FFmpeg-Builds   macOS: ffmpeg.martin-riedl.de (arm64 + x86_64, merged with lipo)
import { execFileSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const binDir = join(root, 'app', 'src-tauri', 'binaries');

const args = process.argv.slice(2);
const target = args.includes('--target') ? args[args.indexOf('--target') + 1] : hostTriple();
const exe = target.includes('windows') ? '.exe' : '';
const dest = join(binDir, `ffmpeg-${target}${exe}`);

const SOURCES = {
  'x86_64-pc-windows-msvc': 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip',
  'aarch64-apple-darwin': 'https://ffmpeg.martin-riedl.de/redirect/latest/macos/arm64/release/ffmpeg.zip',
  'x86_64-apple-darwin': 'https://ffmpeg.martin-riedl.de/redirect/latest/macos/amd64/release/ffmpeg.zip',
};

function hostTriple() {
  const out = execFileSync('rustc', ['-vV'], { encoding: 'utf8' });
  return /host: (\S+)/.exec(out)[1];
}

function findFile(dir, name) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) {
      const hit = findFile(p, name);
      if (hit) return hit;
    } else if (entry === name) return p;
  }
  return null;
}

async function download(url) {
  const work = mkdtempSync(join(tmpdir(), 'stepcast-ffmpeg-'));
  const zip = join(work, 'ffmpeg.zip');
  console.log(`Downloading ${url}`);
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`Download failed: ${res.status} ${url}`);
  writeFileSync(zip, Buffer.from(await res.arrayBuffer()));
  const out = join(work, 'x');
  mkdirSync(out);
  // bsdtar ships with Windows 10+ and macOS and reads zip files.
  execFileSync('tar', ['-xf', zip, '-C', out]);
  const bin = findFile(out, `ffmpeg${exe}`);
  if (!bin) throw new Error('ffmpeg binary not found in the archive');
  return { bin, work };
}

mkdirSync(binDir, { recursive: true });

if (args.includes('--from-path')) {
  const which = execFileSync(process.platform === 'win32' ? 'where' : 'which', ['ffmpeg'], { encoding: 'utf8' }).split(/\r?\n/)[0];
  copyFileSync(which, dest);
} else if (target === 'universal-apple-darwin') {
  const arm = await download(SOURCES['aarch64-apple-darwin']);
  const x64 = await download(SOURCES['x86_64-apple-darwin']);
  execFileSync('lipo', ['-create', arm.bin, x64.bin, '-output', dest]);
  rmSync(arm.work, { recursive: true, force: true });
  rmSync(x64.work, { recursive: true, force: true });
  // A universal build compiles each architecture on its own, and each looks for its own sidecar name.
  for (const arch of ['aarch64-apple-darwin', 'x86_64-apple-darwin']) {
    copyFileSync(dest, join(binDir, `ffmpeg-${arch}`));
    chmodSync(join(binDir, `ffmpeg-${arch}`), 0o755);
  }
} else {
  const url = SOURCES[target];
  if (!url) throw new Error(`No ffmpeg source for ${target}`);
  const { bin, work } = await download(url);
  copyFileSync(bin, dest);
  rmSync(work, { recursive: true, force: true });
}

if (!exe) chmodSync(dest, 0o755);
if (!existsSync(dest)) throw new Error('ffmpeg was not written');
console.log(`ffmpeg ready: ${dest}`);
