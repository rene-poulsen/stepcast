// Checks GitHub Releases for a newer version when the app opens.
import { relaunch } from '@tauri-apps/plugin-process';
import { check, type Update } from '@tauri-apps/plugin-updater';

export const update = $state<{ available: Update | null; installing: boolean; progress: number; error: string }>({
  available: null,
  installing: false,
  progress: 0,
  error: '',
});

export async function checkForUpdate(): Promise<void> {
  try {
    update.available = await check();
  } catch (err) {
    // Offline, or no release published yet: just don't show anything.
    console.warn('Update check failed', err);
  }
}

export async function installUpdate(): Promise<void> {
  if (!update.available) return;
  update.installing = true;
  update.error = '';
  let total = 0;
  let done = 0;
  try {
    // Fetch a fresh handle; the one from startup may have expired.
    const fresh = (await check()) ?? update.available;
    await fresh.downloadAndInstall((event) => {
      if (event.event === 'Started') total = event.data.contentLength ?? 0;
      if (event.event === 'Progress') {
        done += event.data.chunkLength;
        update.progress = total ? done / total : 0;
      }
    });
    await relaunch();
  } catch (err) {
    update.error = String(err);
    update.installing = false;
  }
}
