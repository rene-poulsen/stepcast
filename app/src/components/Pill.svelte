<script lang="ts">
  // The small floating window shown while recording. It is hidden from the capture.
  import { listen } from '@tauri-apps/api/event';
  import { onMount } from 'svelte';
  import { api } from '../lib/api';
  import { strings } from '../lib/i18n';
  import { settings } from '../lib/settings.svelte';
  import { formatTime } from '../lib/timeline';
  import Icon from './Icon.svelte';

  let { camera, mic }: { camera: boolean; mic: boolean } = $props();

  const t = $derived(strings(settings.lang));
  let countdown = $state(3);
  let recording = $state(false);
  let paused = $state(false);
  let stopping = $state(false);
  let elapsed = $state(0);
  let error = $state('');
  let video = $state<HTMLVideoElement | null>(null);

  let stream: MediaStream | null = null;
  let recorder: MediaRecorder | null = null;
  let writes: Promise<unknown> = Promise.resolve();
  let pausedTotal = 0;
  let pausedSince = 0;
  let startedAt = 0;

  function pickMime(hasVideo: boolean): string {
    const options = hasVideo
      ? ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4']
      : ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
    return options.find((m) => MediaRecorder.isTypeSupported(m)) ?? '';
  }

  async function openMedia() {
    if (!camera && !mic) return;
    stream = await navigator.mediaDevices.getUserMedia({
      video: camera
        ? { deviceId: settings.cameraId ? { exact: settings.cameraId } : undefined, width: { ideal: 1280 }, height: { ideal: 720 } }
        : false,
      audio: mic
        ? { deviceId: settings.micId ? { exact: settings.micId } : undefined, echoCancellation: true, noiseSuppression: true }
        : false,
    });
    if (video) video.srcObject = stream;
  }

  async function startMediaRecorder() {
    if (!stream) return;
    const hasVideo = stream.getVideoTracks().length > 0;
    const hasAudio = stream.getAudioTracks().length > 0;
    const mimeType = pickMime(hasVideo);
    recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 4_000_000, audioBitsPerSecond: 128_000 });
    recorder.ondataavailable = (e) => {
      if (!e.data.size) return;
      writes = writes.then(async () => api.camChunk(new Uint8Array(await e.data.arrayBuffer())));
    };
    await api.camBegin(recorder.mimeType || mimeType, Date.now(), hasVideo, hasAudio);
    recorder.start(1000);
  }

  async function begin() {
    try {
      await openMedia();
    } catch (err) {
      error = String(err);
      return;
    }
    for (countdown = 3; countdown > 0; countdown--) {
      await new Promise((r) => setTimeout(r, 1000));
      if (stopping) return;
    }
    try {
      // The camera starts first, so it covers the very first frame of the screen.
      await startMediaRecorder();
      const t0 = await api.startScreen();
      startedAt = t0;
      recording = true;
    } catch (err) {
      error = String(err);
      recorder?.stop();
    }
  }

  async function togglePause() {
    if (!recording || stopping) return;
    paused = await api.togglePause();
    if (paused) pausedSince = Date.now();
    else pausedTotal += Date.now() - pausedSince;
  }

  async function stop() {
    if (stopping) return;
    if (!recording) return cancel();
    stopping = true;
    if (recorder && recorder.state !== 'inactive') {
      const done = new Promise((r) => recorder!.addEventListener('stop', r, { once: true }));
      recorder.stop();
      await done;
    }
    await writes;
    stream?.getTracks().forEach((track) => track.stop());
    try {
      await api.stopRecording();
    } catch (err) {
      error = String(err);
      stopping = false;
    }
  }

  async function cancel() {
    stopping = true;
    recorder?.state !== 'inactive' && recorder?.stop();
    stream?.getTracks().forEach((track) => track.stop());
    await api.cancelRecording();
  }

  onMount(() => {
    begin();
    const timer = setInterval(() => {
      if (!recording) return;
      const pausedNow = paused ? Date.now() - pausedSince : 0;
      elapsed = (Date.now() - startedAt - pausedTotal - pausedNow) / 1000;
    }, 250);
    const off = listen<string>('shortcut', (e) => (e.payload === 'record' ? stop() : togglePause()));
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !recording && cancel();
    window.addEventListener('keydown', onKey);
    return () => {
      clearInterval(timer);
      off.then((fn) => fn());
      window.removeEventListener('keydown', onKey);
    };
  });
</script>

<div class="pill">
  {#if camera}
    <div class="cam" data-tauri-drag-region>
      <!-- svelte-ignore a11y_media_has_caption -->
      <video bind:this={video} autoplay muted playsinline></video>
    </div>
  {/if}

  <div class="bar" data-tauri-drag-region>
    {#if error}
      <span class="error" title={error}>{t.recordingFailed}</span>
      <button class="ctl" onclick={cancel} title={t.cancel}><Icon name="x" /></button>
    {:else if !recording}
      <span class="count" data-tauri-drag-region>{countdown}</span>
      <button class="ctl" onclick={cancel} title={t.cancel}><Icon name="x" /></button>
    {:else}
      <span class="rec" class:paused data-tauri-drag-region></span>
      <span class="time" data-tauri-drag-region>{paused ? t.paused : formatTime(elapsed)}</span>
      <button class="ctl" onclick={togglePause} title={paused ? t.resume : t.pause} disabled={stopping}>
        <Icon name={paused ? 'play' : 'pause'} />
      </button>
      <button class="ctl stop" onclick={stop} title={t.stop} disabled={stopping}><Icon name="stop" /></button>
    {/if}
  </div>
</div>

<style>
  :global(html),
  :global(body) {
    background: #191919;
  }

  .pill {
    display: flex;
    flex-direction: column;
    height: 100vh;
    color: #e3e2e0;
    background: #191919;
    user-select: none;
  }

  .cam {
    flex: 1;
    padding: 8px 8px 0;
    min-height: 0;
  }

  video {
    width: 100%;
    height: 100%;
    object-fit: cover;
    border-radius: 8px;
    transform: scaleX(-1);
    background: #2a2a2a;
  }

  .bar {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 64px;
    padding: 0 12px 0 18px;
  }

  .rec {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--red);
    animation: pulse 1.6s ease-in-out infinite;
  }

  .rec.paused {
    background: #9b9a97;
    animation: none;
  }

  @keyframes pulse {
    50% {
      opacity: 0.35;
    }
  }

  .time,
  .count,
  .error {
    flex: 1;
    font-variant-numeric: tabular-nums;
    font-weight: 500;
    font-size: 15px;
  }

  .count {
    font-size: 22px;
    font-weight: 600;
  }

  .error {
    color: #ff8589;
    font-size: 13px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .ctl {
    display: grid;
    place-items: center;
    width: 36px;
    height: 36px;
    border: 0;
    border-radius: 8px;
    background: #2a2a2a;
    color: #e3e2e0;
  }

  .ctl:hover {
    background: #333;
  }

  .ctl.stop {
    background: var(--red);
    color: #fff;
  }

  .ctl.stop:hover {
    background: #d13d42;
  }
</style>
