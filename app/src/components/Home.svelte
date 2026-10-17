<script lang="ts">
  import { listen } from '@tauri-apps/api/event';
  import { onMount } from 'svelte';
  import { api, fileUrl, type AppInfo, type ExtStatus } from '../lib/api';
  import { formatRatio, formatsFor } from '../lib/formats';
  import { strings } from '../lib/i18n';
  import { saveSettings, settings, type Source } from '../lib/settings.svelte';
  import { formatTime } from '../lib/timeline';
  import type { Monitor, ProjectSummary } from '../lib/types';
  import { checkForUpdate } from '../lib/update.svelte';
  import FormatPicker from './FormatPicker.svelte';
  import Icon from './Icon.svelte';
  import Setup from './Setup.svelte';
  import Switch from './Switch.svelte';
  import UpdateBanner from './UpdateBanner.svelte';

  let { onopen }: { onopen: (dir: string) => void } = $props();

  const t = $derived(strings(settings.lang));
  let info = $state<AppInfo | null>(null);
  let ext = $state<ExtStatus>({ connected: 0, version: null });
  let monitors = $state<Monitor[]>([]);
  let projects = $state<ProjectSummary[]>([]);
  let cameras = $state<MediaDeviceInfo[]>([]);
  let mics = $state<MediaDeviceInfo[]>([]);
  let showSetup = $state(false);
  let starting = $state(false);
  let error = $state('');
  let confirmDelete = $state<string | null>(null);
  let preview = $state<HTMLVideoElement | null>(null);
  let stream: MediaStream | null = null;

  const hasScreen = $derived(settings.source !== 'cam');
  const hasCam = $derived(settings.source !== 'screen');
  const sources: { id: Source; icon: 'monitor' | 'screenCam' | 'camera'; label: () => string }[] = [
    { id: 'screen', icon: 'monitor', label: () => t.sourceScreen },
    { id: 'both', icon: 'screenCam', label: () => t.sourceBoth },
    { id: 'cam', icon: 'camera', label: () => t.sourceCam },
  ];
  /** Webcam-only recordings are cropped to the format; the preview shows what stays in. */
  const guide = $derived(settings.source === 'cam' ? formatRatio(settings.formats.cam, null) : null);

  const isMac = $derived(info?.platform === 'macos');
  const shortcut = $derived(isMac ? '⌘ ⌥ R' : 'Ctrl Alt R');
  const extOutdated = $derived(!!info && !!ext.version && ext.connected > 0 && ext.version !== info.version);

  async function refreshDevices() {
    const devices = await navigator.mediaDevices.enumerateDevices().catch(() => []);
    cameras = devices.filter((d) => d.kind === 'videoinput');
    mics = devices.filter((d) => d.kind === 'audioinput');
  }

  async function startPreview() {
    stopPreview();
    if (!hasCam) return;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: {
          deviceId: settings.cameraId ? { exact: settings.cameraId } : undefined,
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
      });
      if (preview) preview.srcObject = stream;
      await refreshDevices();
    } catch (err) {
      error = `${t.webcam}: ${err}`;
      settings.source = 'screen';
    }
  }

  function setSource(source: Source) {
    settings.source = source;
    saveSettings();
    if (hasCam) startPreview();
    else stopPreview();
  }

  function stopPreview() {
    stream?.getTracks().forEach((track) => track.stop());
    stream = null;
  }

  async function askMic() {
    if (!settings.mic) return;
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      s.getTracks().forEach((track) => track.stop());
      await refreshDevices();
    } catch (err) {
      error = `${t.microphone}: ${err}`;
      settings.mic = false;
    }
  }

  async function loadProjects() {
    projects = await api.listProjects().catch(() => []);
  }

  async function start() {
    if (starting) return;
    const monitor = monitors.find((m) => m.index === settings.monitor) ?? monitors.find((m) => m.primary) ?? monitors[0];
    if (!monitor) return;
    starting = true;
    error = '';
    saveSettings();
    stopPreview();
    try {
      let area = null;
      if (hasScreen && settings.mode === 'area') {
        area = await api.pickArea(monitor);
        if (!area) {
          startPreview();
          return;
        }
      }
      await api.beginRecording({
        monitor,
        area,
        camera: hasCam,
        mic: settings.mic,
        camOnly: settings.source === 'cam',
        format: settings.formats[settings.source],
      });
    } catch (err) {
      error = `${t.recordingFailed}: ${err}`;
      startPreview();
    } finally {
      starting = false;
    }
  }

  async function remove(dir: string) {
    if (confirmDelete !== dir) {
      confirmDelete = dir;
      setTimeout(() => confirmDelete === dir && (confirmDelete = null), 3000);
      return;
    }
    await api.deleteProject(dir);
    confirmDelete = null;
    loadProjects();
  }

  function title(p: ProjectSummary): string {
    if (p.title) return p.title;
    const d = new Date(p.createdAt);
    return d.toLocaleString(settings.lang === 'da' ? 'da-DK' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' });
  }

  onMount(() => {
    api.appInfo().then((i) => (info = i));
    api.extStatus().then((s) => (ext = s));
    api.listMonitors().then((m) => {
      monitors = m;
      if (!m.some((x) => x.index === settings.monitor)) settings.monitor = (m.find((x) => x.primary) ?? m[0])?.index ?? 0;
    });
    loadProjects();
    refreshDevices();
    checkForUpdate();
    if (hasCam) startPreview();
    if (!settings.onboarded) showSetup = true;

    const offs = [
      listen<ExtStatus>('ext-status', (e) => (ext = e.payload)),
      listen<string>('shortcut', (e) => e.payload === 'record' && start()),
      listen<number>('projects-changed', () => loadProjects()),
    ];
    const onFocus = () => {
      loadProjects();
      api.extStatus().then((s) => (ext = s));
    };
    window.addEventListener('focus', onFocus);
    return () => {
      stopPreview();
      window.removeEventListener('focus', onFocus);
      offs.forEach((off) => off.then((fn) => fn()));
    };
  });

  $effect(() => {
    if (preview && stream) preview.srcObject = stream;
  });
</script>

<div class="home">
  <header>
    <div class="brand">
      <img src="/icon.png" alt="" width="22" height="22" />
      <strong>Stepcast</strong>
    </div>
    <div class="right">
      {#if ext.connected > 0}
        <span class="chip"><span class="dot on"></span>{t.extConnected}</span>
      {:else}
        <button class="chip action" onclick={() => (showSetup = true)}>
          <span class="dot"></span>{t.extMissing}<span class="link">{t.extSetup}</span>
        </button>
      {/if}
      <div class="segmented" title={t.labels}>
        <button class:on={settings.lang === 'en'} onclick={() => ((settings.lang = 'en'), saveSettings())}>EN</button>
        <button class:on={settings.lang === 'da'} onclick={() => ((settings.lang = 'da'), saveSettings())}>DA</button>
      </div>
    </div>
  </header>

  <main>
    <UpdateBanner />
    {#if extOutdated}
      <p class="notice"><Icon name="puzzle" />{t.extOutdated}</p>
    {/if}

    <section class="recorder">
      <button class="record" onclick={start} disabled={starting || monitors.length === 0} aria-label={t.record}>
        <span class="ring"><span class="core"></span></span>
      </button>
      <div class="record-text">
        <h1>{t.record}</h1>
        <p class="muted">{t.recordHint} <kbd>{shortcut}</kbd></p>
      </div>

      <div class="sources" role="radiogroup" aria-label={t.source}>
        {#each sources as s (s.id)}
          <button role="radio" aria-checked={settings.source === s.id} class:on={settings.source === s.id} onclick={() => setSource(s.id)}>
            <Icon name={s.icon} size={22} />
            <span>{s.label()}</span>
          </button>
        {/each}
      </div>

      <div class="options">
        {#if hasScreen}
          <div class="option">
            <Icon name="monitor" />
            <span>{t.recordWhat}</span>
            <div class="segmented">
              <button class:on={settings.mode === 'screen'} onclick={() => ((settings.mode = 'screen'), saveSettings())}>
                {t.wholeScreen}
              </button>
              <button class:on={settings.mode === 'area'} onclick={() => ((settings.mode = 'area'), saveSettings())}>
                {t.area}
              </button>
            </div>
          </div>
        {/if}
        {#if hasScreen && monitors.length > 1}
          <div class="option">
            <Icon name="monitor" />
            <span>{t.screen}</span>
            <select class="select" bind:value={settings.monitor} onchange={saveSettings}>
              {#each monitors as m (m.index)}
                <option value={m.index}>{m.name} · {m.width}×{m.height}</option>
              {/each}
            </select>
          </div>
        {/if}

        {#if hasCam && cameras.length > 1}
          <div class="option">
            <Icon name="camera" />
            <span>{t.webcam}</span>
            <select class="select" bind:value={settings.cameraId} onchange={() => (saveSettings(), startPreview())}>
              <option value="">{t.defaultDevice}</option>
              {#each cameras.filter((c) => c.deviceId) as c (c.deviceId)}
                <option value={c.deviceId}>{c.label || t.webcam}</option>
              {/each}
            </select>
          </div>
        {/if}

        <div class="option">
          <Icon name="mic" />
          <span>{t.microphone}</span>
          {#if settings.mic && mics.length > 1}
            <select class="select" bind:value={settings.micId} onchange={saveSettings}>
              <option value="">{t.defaultDevice}</option>
              {#each mics.filter((m) => m.deviceId && m.deviceId !== 'default' && m.deviceId !== 'communications') as m (m.deviceId)}
                <option value={m.deviceId}>{m.label || t.microphone}</option>
              {/each}
            </select>
          {/if}
          <Switch bind:checked={settings.mic} onchange={() => (saveSettings(), askMic())} />
        </div>

        <div class="option format">
          <span class="format-head">{t.format}</span>
          <FormatPicker
            formats={formatsFor(hasScreen)}
            bind:value={settings.formats[settings.source]}
            lang={settings.lang}
            onchange={saveSettings}
          />
        </div>
      </div>

      {#if hasCam}
        <div class="cam-preview">
          <!-- svelte-ignore a11y_media_has_caption -->
          <video bind:this={preview} autoplay muted playsinline></video>
          {#if guide}
            <span class="guide" style="aspect-ratio:{guide};{guide > 16 / 9 ? 'width:100%' : 'height:100%'}"></span>
          {/if}
        </div>
      {/if}

      {#if error}<p class="error">{error}</p>{/if}
    </section>

    <section class="library">
      <h2>{t.recent}</h2>
      {#if projects.length === 0}
        <p class="muted empty">{t.noRecordings}</p>
      {:else}
        <ul>
          {#each projects as p (p.dir)}
            <li>
              <button class="card" onclick={() => onopen(p.dir)}>
                <div class="thumb">
                  {#if p.thumb}<img src={fileUrl(p.thumb)} alt="" loading="lazy" />{/if}
                  <span class="duration">{formatTime(p.duration)}</span>
                  {#if p.recovered}<span class="badge" title={t.recoveredHint}>{t.recovered}</span>{/if}
                </div>
                <div class="meta">
                  <strong>{title(p)}</strong>
                  <span class="muted">{p.steps} {t.steps}{p.exported ? ' · MP4' : ''}</span>
                </div>
              </button>
              <button class="icon-btn delete" class:confirm={confirmDelete === p.dir} onclick={() => remove(p.dir)} title={t.delete}>
                {#if confirmDelete === p.dir}<span>{t.confirmDelete}</span>{:else}<Icon name="trash" />{/if}
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    </section>
  </main>
</div>

{#if showSetup && info}
  <Setup
    {info}
    connected={ext.connected > 0}
    onclose={() => {
      showSetup = false;
      settings.onboarded = true;
      saveSettings();
    }}
  />
{/if}

<style>
  .home {
    display: flex;
    flex-direction: column;
    height: 100%;
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 12px 20px;
    border-bottom: 1px solid var(--border);
  }

  .brand {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 15px;
  }

  .brand img {
    border-radius: 5px;
  }

  .right {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .chip {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    height: 28px;
    padding: 0 10px;
    border: 1px solid var(--border);
    border-radius: 99px;
    background: var(--bg);
    color: var(--muted);
    font-size: 13px;
  }

  .chip.action:hover {
    background: var(--hover);
  }

  .chip .link {
    color: var(--accent);
    font-weight: 500;
  }

  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--faint);
  }

  .dot.on {
    background: var(--green);
  }

  main {
    flex: 1;
    overflow-y: auto;
    padding: 0 20px 40px;
  }

  .notice {
    display: flex;
    align-items: center;
    gap: 8px;
    max-width: 720px;
    margin: 16px auto 0;
    padding: 10px 14px;
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--muted);
  }

  .recorder {
    display: flex;
    flex-direction: column;
    align-items: center;
    max-width: 720px;
    margin: 0 auto;
    padding: 48px 0 40px;
    text-align: center;
  }

  .record {
    padding: 0;
    border: 0;
    background: none;
    border-radius: 50%;
    transition: transform 0.15s;
  }

  .record:hover:not(:disabled) {
    transform: scale(1.04);
  }

  .record:active:not(:disabled) {
    transform: scale(0.97);
  }

  .record:focus-visible {
    outline: 3px solid var(--accent-soft);
    outline-offset: 4px;
  }

  .ring {
    display: grid;
    place-items: center;
    width: 96px;
    height: 96px;
    border-radius: 50%;
    background: #202020;
    box-shadow: inset 0 0 0 7px #202020, inset 0 0 0 11px #fff, var(--shadow);
  }

  .core {
    width: 40px;
    height: 40px;
    border-radius: 50%;
    background: var(--red);
  }

  .record-text h1 {
    margin-top: 18px;
    font-size: 22px;
  }

  .record-text p {
    margin: 6px 0 0;
  }

  .options {
    display: flex;
    flex-direction: column;
    width: 100%;
    max-width: 420px;
    margin-top: 12px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    text-align: left;
  }

  .option {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 48px;
    padding: 0 14px;
    color: var(--muted);
  }

  .option + .option {
    border-top: 1px solid var(--border);
  }

  .option > span {
    flex: 1;
    color: var(--text);
  }

  .option .select {
    max-width: 180px;
  }

  .sources {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 8px;
    width: 100%;
    max-width: 420px;
    margin-top: 28px;
  }

  .sources button {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    padding: 12px 6px 10px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--bg);
    color: var(--muted);
    font-size: 13px;
  }

  .sources button:hover {
    background: var(--hover);
  }

  .sources button.on {
    border-color: var(--accent);
    background: var(--accent-soft);
    color: var(--text);
    font-weight: 500;
  }

  .option.format {
    flex-direction: column;
    align-items: stretch;
    gap: 8px;
    padding: 12px 14px;
  }

  .option > .format-head {
    flex: none;
  }

  .cam-preview {
    position: relative;
    display: grid;
    place-items: center;
    width: 260px;
    margin-top: 16px;
    border-radius: var(--radius);
    background: var(--surface-2);
    aspect-ratio: 16 / 9;
    overflow: hidden;
  }

  .cam-preview video {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    transform: scaleX(-1);
  }

  /* What a webcam-only video keeps: the rest is darkened. */
  .guide {
    position: relative;
    border: 1.5px solid rgba(255, 255, 255, 0.9);
    border-radius: 4px;
    box-shadow: 0 0 0 999px rgba(0, 0, 0, 0.45);
  }

  .error {
    margin: 16px 0 0;
    color: var(--red);
  }

  .library {
    max-width: 960px;
    margin: 0 auto;
  }

  .library h2 {
    margin-bottom: 12px;
    font-size: 14px;
    color: var(--muted);
    font-weight: 500;
  }

  .empty {
    padding: 24px 0;
  }

  ul {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 16px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  li {
    position: relative;
  }

  .card {
    display: block;
    width: 100%;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--bg);
    text-align: left;
    overflow: hidden;
    transition: box-shadow 0.15s;
  }

  .card:hover {
    box-shadow: var(--shadow);
  }

  .thumb {
    position: relative;
    aspect-ratio: 16 / 10;
    background: var(--surface-2);
  }

  .thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  .duration {
    position: absolute;
    right: 8px;
    bottom: 8px;
    padding: 1px 6px;
    border-radius: 4px;
    background: rgba(0, 0, 0, 0.6);
    color: #fff;
    font-size: 12px;
  }

  .badge {
    position: absolute;
    left: 8px;
    top: 8px;
    padding: 1px 6px;
    border-radius: 4px;
    background: var(--accent);
    color: #fff;
    font-size: 12px;
  }

  .meta {
    display: flex;
    flex-direction: column;
    padding: 10px 12px 12px;
  }

  .meta strong {
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .meta span {
    font-size: 12px;
  }

  .delete {
    position: absolute;
    top: 8px;
    right: 8px;
    width: auto;
    min-width: 28px;
    padding: 0 6px;
    background: var(--bg);
    opacity: 0;
    transition: opacity 0.12s;
  }

  li:hover .delete,
  .delete.confirm {
    opacity: 1;
  }

  .delete.confirm {
    color: var(--red);
    font-size: 12px;
  }
</style>
