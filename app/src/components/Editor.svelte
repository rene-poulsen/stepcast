<script lang="ts">
  import { listen } from '@tauri-apps/api/event';
  import { save } from '@tauri-apps/plugin-dialog';
  import { openPath, revealItemInDir } from '@tauri-apps/plugin-opener';
  import { onMount } from 'svelte';
  import { api, joinPath } from '../lib/api';
  import { exportSpec, fileName, render } from '../lib/exporter';
  import { guideHtml, guideMarkdown, guideSteps } from '../lib/guide';
  import { strings } from '../lib/i18n';
  import { loadMeasureFont, measure } from '../lib/measure';
  import { settings } from '../lib/settings.svelte';
  import { formatsFor } from '../lib/formats';
  import { isStacked, toFrac } from '../lib/layout';
  import { blurSegments, normalizeEdits, viewsFor } from '../lib/steps';
  import { formatTime, toOutput } from '../lib/timeline';
  import type { Box, Edits, Project } from '../lib/types';
  import FormatPicker from './FormatPicker.svelte';
  import Icon from './Icon.svelte';
  import Preview from './Preview.svelte';
  import Switch from './Switch.svelte';
  import Timeline from './Timeline.svelte';

  let { dir, onclose }: { dir: string; onclose: () => void } = $props();

  let project = $state<Project | null>(null);
  let edits = $state<Edits | null>(null);
  let fontReady = $state(false);
  let time = $state(0);
  let playing = $state(false);
  let preview = $state<Preview | null>(null);
  let busy = $state<'' | 'video' | 'guide'>('');
  let progress = $state(0);
  let result = $state<{ label: string; path: string } | null>(null);
  let error = $state('');
  let saveTimer: ReturnType<typeof setTimeout> | undefined;

  const t = $derived(strings(edits?.lang ?? settings.lang));
  const r = $derived(project && edits && fontReady ? render(project, edits, measure) : null);
  const blurs = $derived(project ? blurSegments(project) : []);
  const views = $derived(project ? viewsFor(project) : []);
  const viewLabel = { both: () => t.sourceBoth, screen: () => t.sourceScreen, cam: () => t.sourceCam };
  const stacked = $derived(!!r && isStacked(r.layout));
  const sides = $derived(stacked ? (['top', 'bottom'] as const) : (['left', 'right'] as const));
  const arranges = ['auto', 'custom', 'overlay'] as const;
  const aligns = [
    ['top', 'alignTop'],
    ['center', 'alignCenter'],
    ['bottom', 'alignBottom'],
  ] as const;
  /** What can be dragged in the preview: both boxes in a custom layout, the webcam over the screen. */
  const movable = $derived.by((): ('screen' | 'cam')[] => {
    if (!r?.layout.screen || !r.layout.cam || !edits) return [];
    if (edits.camera.arrange === 'custom') return ['screen', 'cam'];
    return edits.camera.arrange === 'overlay' ? ['cam'] : [];
  });
  /** Steps and effects belong to the screen, so they are hidden when it isn't shown. */
  const showsScreen = $derived(!!r?.layout.screen);
  const current = $derived.by(() => {
    if (!r) return -1;
    let idx = -1;
    r.steps.forEach((s, i) => {
      if (s.time <= time + 0.05) idx = i;
    });
    return idx;
  });

  function persist() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (project && edits) api.saveProject(dir, { ...$state.snapshot(project), edits: $state.snapshot(edits) });
    }, 400);
  }

  /** Stores a box dragged in the preview, as fractions of the frame. */
  function place(target: 'screen' | 'cam', box: Box) {
    if (!edits || !r?.layout.screen || !r.layout.cam) return;
    const cam = edits.camera;
    if (cam.arrange === 'overlay') {
      cam.float = toFrac(box, r.layout);
    } else {
      cam.custom = { screen: toFrac(r.layout.screen, r.layout), cam: toFrac(r.layout.cam, r.layout) };
      cam.custom[target] = toFrac(box, r.layout);
    }
    persist();
  }

  function resetPlacement() {
    if (!edits) return;
    if (edits.camera.arrange === 'overlay') edits.camera.float = null;
    else edits.camera.custom = null;
    persist();
  }

  function setStep(index: number, patch: { text?: string; deleted?: boolean }) {
    if (!edits) return;
    edits.steps[index] = { ...edits.steps[index], ...patch };
    persist();
  }

  function seek(s: number) {
    preview?.seek(s);
  }

  async function exportVideo() {
    if (!project || !edits || !r) return;
    const path = await save({
      defaultPath: joinPath(dir, fileName(project.title, 'Stepcast', 'mp4')),
      filters: [{ name: 'MP4', extensions: ['mp4'] }],
    });
    if (!path) return;
    busy = 'video';
    progress = 0;
    error = '';
    result = null;
    try {
      const out = await api.exportVideo(dir, exportSpec(project, edits, r), r.ass, path);
      result = { label: t.exported, path: out };
    } catch (err) {
      error = String(err);
    } finally {
      busy = '';
    }
  }

  async function exportGuide() {
    if (!project?.screen || !r) return;
    const screen = project.screen;
    const steps = r.steps.filter((s) => !s.deleted);
    if (!steps.length) return;
    busy = 'guide';
    error = '';
    result = null;
    try {
      const out = joinPath(dir, 'guide');
      // A moment after the action, so the screenshot shows its result starting.
      const frames = steps.map((s) => {
        const time = s.time + 0.15;
        return { time, blurs: edits!.blur ? blurs.filter((b) => time >= b.start && time <= b.end) : [] };
      });
      const { width, height } = screen;
      const images = await api.extractFrames(dir, frames, width, height, joinPath(out, 'img'));
      const title = project.title || t.untitled;
      const gs = guideSteps(project, steps, images);
      await api.writeTextFile(joinPath(out, 'index.html'), guideHtml(title, gs, edits!.lang));
      await api.writeTextFile(joinPath(out, 'guide.md'), guideMarkdown(title, gs));
      result = { label: t.guideSaved, path: joinPath(out, 'index.html') };
    } catch (err) {
      error = String(err);
    } finally {
      busy = '';
    }
  }

  onMount(() => {
    api
      .loadProject(dir)
      .then((p) => {
        // A new recording starts in the format picked for its source; older edits get new settings filled in.
        const source = !p.screen ? 'cam' : p.cam?.video ? 'both' : 'screen';
        edits = normalizeEdits(p, p.edits ?? {}, settings.lang, p.edits ? undefined : settings.formats[source]);
        project = p;
      })
      .catch((err) => (error = String(err)));
    loadMeasureFont().finally(() => (fontReady = true));

    const off = listen<number>('export-progress', (e) => (progress = e.payload));
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault();
        preview?.toggle();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      off.then((fn) => fn());
      window.removeEventListener('keydown', onKey);
      clearTimeout(saveTimer);
    };
  });
</script>

<div class="editor">
  <header>
    <button class="btn ghost" onclick={onclose}><Icon name="back" />{t.back}</button>
    {#if project}
      <input class="title" bind:value={project.title} placeholder={t.untitled} oninput={persist} />
    {/if}
    <div class="actions">
      <button class="btn" onclick={exportGuide} disabled={!!busy || !project?.screen || !r?.steps.length}>
        <Icon name="guide" />{t.exportGuide}
      </button>
      <button class="btn primary" onclick={exportVideo} disabled={!!busy || !r}>
        <Icon name="download" />{t.exportVideo}
      </button>
    </div>
  </header>

  {#if busy || result || error}
    <div class="status" class:error={!!error}>
      {#if busy === 'video'}
        <span>{t.exporting} {Math.round(progress * 100)}%</span>
        <span class="bar"><span style="width:{progress * 100}%"></span></span>
      {:else if busy === 'guide'}
        <span>{t.exporting}…</span>
      {:else if result}
        <Icon name="check" /><span>{result.label}</span>
        <button class="btn ghost" onclick={() => openPath(result!.path)}>{t.open}</button>
        <button class="btn ghost" onclick={() => revealItemInDir(result!.path)}>{t.showInFolder}</button>
        <button class="icon-btn" onclick={() => (result = null)} aria-label="Close"><Icon name="x" /></button>
      {:else}
        <span>{error}</span>
        <button class="icon-btn" onclick={() => (error = '')} aria-label="Close"><Icon name="x" /></button>
      {/if}
    </div>
  {/if}

  {#if project && edits && r}
    <div class="body">
      <section class="stage-col">
        <div class="stage">
          <Preview
            bind:this={preview}
            {dir}
            {project}
            layout={r.layout}
            keeps={r.keeps}
            zoom={r.zoom}
            overlay={r.overlay}
            blurs={edits.blur ? blurs : []}
            bind:time
            bind:playing
            {movable}
            onplace={place}
          />
        </div>
        <div class="transport">
          <button class="icon-btn play" onclick={() => preview?.toggle()} aria-label={playing ? t.pause : 'Play'}>
            <Icon name={playing ? 'pause' : 'play'} size={18} />
          </button>
          <span class="clock">{formatTime(toOutput(time, r.keeps) ?? 0)} / {formatTime(r.duration)}</span>
          <div class="timeline">
            <Timeline
              duration={project.duration}
              bind:trim={edits.trim}
              pauses={project.pauses}
              steps={r.steps}
              {time}
              onseek={seek}
              onchange={persist}
            />
          </div>
        </div>
        <p class="hint muted">{t.trimHint}</p>
      </section>

      <aside>
        <div class="group">
          <h3>{t.video}</h3>
          {#if views.length > 1}
            <div class="views">
              <div class="segmented" role="radiogroup" aria-label={t.show}>
                {#each views as v (v)}
                  <button class:on={edits.view === v} onclick={() => ((edits!.view = v), persist())}>{viewLabel[v]()}</button>
                {/each}
              </div>
            </div>
          {/if}
          <div class="format">
            <FormatPicker formats={formatsFor(!!project.screen)} bind:value={edits.format} lang={edits.lang} onchange={persist} />
          </div>
          {#if r.layout.screen && r.layout.cam}
            <div class="views">
              <div class="segmented" role="radiogroup" aria-label={t.arrange}>
                {#each arranges as a (a)}
                  <button class:on={edits.camera.arrange === a} onclick={() => ((edits!.camera.arrange = a), persist())}>
                    {a === 'auto' ? (stacked ? t.stacked : t.sideBySide) : t[a]}
                  </button>
                {/each}
              </div>
            </div>
          {/if}
          {#if r.layout.screen && r.layout.cam && edits.camera.arrange !== 'auto'}
            <div class="row">
              <span class="muted small">{edits.camera.arrange === 'custom' ? t.customHint : t.overlayHint}</span>
              <button class="btn ghost" onclick={resetPlacement}>{t.resetLayout}</button>
            </div>
          {:else if r.layout.screen && r.layout.cam}
            {#if !stacked}
              <div class="row">
                <span class="muted">{t.camSize}</span>
                <input type="range" min="0.15" max="0.4" step="0.01" bind:value={edits.camera.split} onchange={persist} />
              </div>
              <div class="row">
                <span class="muted">{t.align}</span>
                <div class="segmented">
                  {#each aligns as [a, label] (a)}
                    <button class:on={edits.camera.align === a} onclick={() => ((edits!.camera.align = a), persist())}>{t[label]}</button>
                  {/each}
                </div>
              </div>
            {/if}
            <div class="row">
              <span class="muted">{t.layout}</span>
              <div class="segmented">
                {#each sides as side, i (side)}
                  {@const on = (edits.camera.side === 'left' || edits.camera.side === 'top') === (i === 0)}
                  <button class:on onclick={() => ((edits!.camera.side = side), persist())}>{t[side]}</button>
                {/each}
              </div>
            </div>
          {/if}
          {#if r.layout.cam}
            <div class="row">
              <span class="muted">{t.framing}</span>
              <input type="range" min="0" max="1" step="0.01" bind:value={edits.camera.focusX} oninput={persist} />
            </div>
          {/if}
        </div>

        {#if showsScreen}
        <div class="group">
          <div class="group-head">
            <h3>{t.stepsTitle}</h3>
            <div class="segmented">
              <button class:on={edits.lang === 'en'} onclick={() => ((edits!.lang = 'en'), persist())}>EN</button>
              <button class:on={edits.lang === 'da'} onclick={() => ((edits!.lang = 'da'), persist())}>DA</button>
            </div>
          </div>
          {#if r.steps.length === 0}
            <p class="muted small">{t.noSteps}</p>
          {:else}
            <ol class="steps">
              {#each r.steps as step, i (step.index)}
                <li class:current={i === current} class:deleted={step.deleted}>
                  <button class="time" onclick={() => seek(Math.max(0, step.time - 0.6))} title={t.jump}>
                    {formatTime(step.out)}
                  </button>
                  <textarea
                    rows="1"
                    value={step.text}
                    disabled={step.deleted}
                    onkeydown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        e.currentTarget.blur();
                      }
                    }}
                    onchange={(e) => setStep(step.index, { text: e.currentTarget.value.trim() || undefined })}
                  ></textarea>
                  <button
                    class="icon-btn"
                    title={step.deleted ? t.restoreStep : t.deleteStep}
                    onclick={() => setStep(step.index, { deleted: !step.deleted })}
                  >
                    <Icon name={step.deleted ? 'restore' : 'trash'} size={14} />
                  </button>
                </li>
              {/each}
            </ol>
          {/if}
        </div>

        <div class="group">
          <h3>{t.effects}</h3>
          <label class="row"><span>{t.ripple}</span><Switch bind:checked={edits.ripple} onchange={persist} /></label>
          <label class="row"><span>{t.highlight}</span><Switch bind:checked={edits.highlight} onchange={persist} /></label>
          <label class="row"><span>{t.blur}</span><Switch bind:checked={edits.blur} onchange={persist} /></label>
          <label class="row"><span>{t.keyboard}</span><Switch bind:checked={edits.keyboard} onchange={persist} /></label>
          <label class="row"><span>{t.zoom}</span><Switch bind:checked={edits.zoom} onchange={persist} /></label>
        </div>
        {/if}
      </aside>
    </div>
  {/if}
</div>

<style>
  .editor {
    display: flex;
    flex-direction: column;
    height: 100%;
  }

  header {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 16px;
    border-bottom: 1px solid var(--border);
  }

  .title {
    flex: 1;
    min-width: 0;
    height: 32px;
    padding: 0 8px;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    background: transparent;
    font-size: 15px;
    font-weight: 600;
  }

  .title:hover {
    background: var(--hover);
  }

  .title:focus {
    outline: none;
    border-color: var(--border);
    background: var(--bg);
  }

  .actions {
    display: flex;
    gap: 8px;
  }

  .status {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 16px;
    border-bottom: 1px solid var(--border);
    background: var(--surface);
    color: var(--text);
  }

  .status.error {
    color: var(--red);
  }

  .bar {
    flex: 1;
    max-width: 320px;
    height: 4px;
    border-radius: 2px;
    background: var(--surface-2);
    overflow: hidden;
  }

  .bar span {
    display: block;
    height: 100%;
    background: var(--accent);
    transition: width 0.2s;
  }

  .body {
    flex: 1;
    display: flex;
    min-height: 0;
  }

  .stage-col {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
    padding: 20px 20px 12px;
    background: var(--surface);
  }

  .stage {
    flex: 1;
    min-height: 0;
  }

  .transport {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-top: 14px;
  }

  .play {
    width: 36px;
    height: 36px;
    color: var(--text);
  }

  .clock {
    font-variant-numeric: tabular-nums;
    color: var(--muted);
    font-size: 13px;
    white-space: nowrap;
  }

  .timeline {
    flex: 1;
  }

  .hint {
    margin: 2px 0 0 48px;
    font-size: 12px;
  }

  aside {
    width: 340px;
    flex: none;
    overflow-y: auto;
    border-left: 1px solid var(--border);
  }

  .group {
    padding: 16px;
    border-bottom: 1px solid var(--border);
  }

  .group-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 10px;
  }

  h3 {
    font-size: 13px;
    font-weight: 600;
  }

  .group > h3 {
    margin-bottom: 10px;
  }

  .small {
    font-size: 13px;
  }

  .steps {
    margin: 0 -8px;
    padding: 0;
    list-style: none;
  }

  .steps li {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 2px 4px;
    border-radius: var(--radius-sm);
  }

  .steps li.current {
    background: var(--accent-soft);
  }

  .steps li .icon-btn {
    opacity: 0;
  }

  .steps li:hover .icon-btn,
  .steps li.deleted .icon-btn {
    opacity: 1;
  }

  .steps .time {
    flex: none;
    width: 42px;
    padding: 4px;
    border: 0;
    border-radius: 4px;
    background: none;
    color: var(--muted);
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    text-align: left;
  }

  .steps .time:hover {
    color: var(--accent);
  }

  .steps textarea {
    flex: 1;
    min-width: 0;
    min-height: 30px;
    padding: 5px 6px;
    font: inherit;
    line-height: 1.35;
    resize: none;
    field-sizing: content;
    border: 1px solid transparent;
    border-radius: 4px;
    background: transparent;
  }

  .steps textarea:hover {
    border-color: var(--border);
  }

  .steps textarea:focus {
    outline: none;
    border-color: var(--accent);
    background: var(--bg);
  }

  .steps li.deleted textarea {
    text-decoration: line-through;
    color: var(--faint);
  }

  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    min-height: 34px;
  }

  .format {
    margin: 4px 0 8px;
  }

  .views {
    margin-bottom: 12px;
  }

  .views .segmented {
    display: flex;
  }

  .views button {
    flex: auto;
    white-space: nowrap;
  }

  .row input[type='range'] {
    flex: 1;
    max-width: 180px;
    accent-color: var(--accent);
  }
</style>
