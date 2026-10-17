<script lang="ts">
  // Plays the raw recording composed like the export: screen, webcam panel, blur and overlay.
  import { onMount } from 'svelte';
  import { fileUrl, joinPath } from '../lib/api';
  import type { Overlay as OverlayItems } from '../lib/ass';
  import { BACKGROUND, type Layout } from '../lib/layout';
  import type { BlurSegment } from '../lib/steps';
  import { nextKeepStart, toOutput, type Range } from '../lib/timeline';
  import type { Box, Project } from '../lib/types';
  import { viewAt, type ZoomKey } from '../lib/zoom';
  import Overlay from './Overlay.svelte';

  let {
    dir,
    project,
    layout,
    keeps,
    overlay,
    zoom = [],
    blurs = [],
    time = $bindable(0),
    playing = $bindable(false),
  }: {
    dir: string;
    project: Project;
    layout: Layout;
    keeps: Range[];
    overlay: OverlayItems;
    zoom?: ZoomKey[];
    /** Blurred areas in screen-video pixels and source seconds. */
    blurs?: BlurSegment[];
    time?: number;
    playing?: boolean;
  } = $props();

  let screenEl = $state<HTMLVideoElement | null>(null);
  let camEl = $state<HTMLVideoElement | null>(null);

  const screenSrc = $derived(fileUrl(joinPath(dir, project.screen.file)));
  const camSrc = $derived(project.cam ? fileUrl(joinPath(dir, project.cam.file)) : null);
  const out = $derived(toOutput(time, keeps));
  const view = $derived(viewAt(zoom, out ?? 0, project.screen.width, project.screen.height));
  /** Position inside the screen video, in percent of it. */
  const inVideo = (b: { x: number; y: number; w: number; h: number }) =>
    `left:${(b.x / project.screen.width) * 100}%;top:${(b.y / project.screen.height) * 100}%;width:${(b.w / project.screen.width) * 100}%;height:${(b.h / project.screen.height) * 100}%`;

  const pct = (b: Box) =>
    `left:${(b.x / layout.width) * 100}%;top:${(b.y / layout.height) * 100}%;width:${(b.w / layout.width) * 100}%;height:${(b.h / layout.height) * 100}%`;

  export function seek(t: number) {
    if (!screenEl) return;
    screenEl.currentTime = Math.max(0, Math.min(project.duration, t));
    time = screenEl.currentTime;
    syncCam(true);
  }

  export async function toggle() {
    if (!screenEl) return;
    if (playing) {
      screenEl.pause();
      return;
    }
    const t = screenEl.currentTime;
    const last = keeps[keeps.length - 1];
    if (!last) return;
    if (t >= last[1] - 0.05) seek(keeps[0][0]);
    else if (toOutput(t, keeps) === null) seek(nextKeepStart(t, keeps) ?? keeps[0][0]);
    await screenEl.play();
  }

  function syncCam(force = false) {
    if (!camEl || !screenEl || !project.cam) return;
    const target = screenEl.currentTime - project.cam.offset;
    if (target < 0 || (camEl.duration && target > camEl.duration)) {
      camEl.pause();
      return;
    }
    if (force || Math.abs(camEl.currentTime - target) > 0.15) camEl.currentTime = target;
    if (playing && camEl.paused) camEl.play().catch(() => {});
    if (!playing && !camEl.paused) camEl.pause();
  }

  function tick() {
    if (!screenEl) return;
    const t = screenEl.currentTime;
    time = t;
    if (playing) {
      const next = nextKeepStart(t, keeps);
      const last = keeps[keeps.length - 1];
      if (next !== null) screenEl.currentTime = next;
      else if (!last || t >= last[1]) screenEl.pause();
    }
    syncCam();
  }

  onMount(() => {
    let frame = 0;
    const loop = () => {
      tick();
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  });
</script>

<div class="frame">
  <div
    class="stage"
    style="aspect-ratio:{layout.width}/{layout.height};--ar:{layout.width / layout.height};background:#{BACKGROUND}"
  >
    <div class="screen" style={pct(layout.screen)}>
      <div
        class="view"
        style="transform:scale({view.z}) translate({(-view.x / project.screen.width) * 100}%, {(-view.y / project.screen.height) * 100}%)"
      >
        <!-- svelte-ignore a11y_media_has_caption -->
        <video
          bind:this={screenEl}
          src={screenSrc}
          muted
          preload="auto"
          playsinline
          onplay={() => (playing = true)}
          onpause={() => (playing = false)}
          onclick={toggle}
        ></video>
        {#each blurs.filter((b) => time >= b.start && time <= b.end) as b}
          <div class="blur" style={inVideo(b)}></div>
        {/each}
      </div>
    </div>
    {#if camSrc}
      <!-- svelte-ignore a11y_media_has_caption -->
      <video
        bind:this={camEl}
        src={camSrc}
        class="cam"
        class:hidden={!layout.cam}
        style={layout.cam
          ? pct(layout.cam) +
            `;border-radius:${(layout.camRadius / layout.cam.w) * 100}% / ${(layout.camRadius / layout.cam.h) * 100}%`
          : ''}
        preload="auto"
        playsinline
      ></video>
    {/if}
    <Overlay items={overlay} width={layout.width} height={layout.height} t={out} />
  </div>
</div>

<style>
  .frame {
    container-type: size;
    display: grid;
    place-items: center;
    width: 100%;
    height: 100%;
  }

  .stage {
    position: relative;
    width: min(100cqw, 100cqh * var(--ar, 1.7778));
    max-width: 100%;
    max-height: 100%;
    overflow: hidden;
    border-radius: 8px;
    box-shadow:
      0 0 0 1px var(--border),
      var(--shadow);
  }

  video {
    position: absolute;
    display: block;
    object-fit: fill;
  }

  .screen {
    position: absolute;
    overflow: hidden;
  }

  .view {
    position: absolute;
    inset: 0;
    transform-origin: 0 0;
  }

  .view video {
    inset: 0;
    width: 100%;
    height: 100%;
  }

  .cam {
    object-fit: cover;
  }

  .cam.hidden {
    width: 1px;
    height: 1px;
    opacity: 0;
  }

  .blur {
    position: absolute;
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
  }
</style>
