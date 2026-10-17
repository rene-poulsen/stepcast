<script lang="ts">
  // Plays the raw recording composed like the export: screen, webcam panel, blur and overlay.
  import { onMount } from 'svelte';
  import { fileUrl, joinPath } from '../lib/api';
  import type { Overlay as OverlayItems } from '../lib/ass';
  import { BACKGROUND, layoutMargin, minCamSide, minScreenWidth, snapTo, type Layout } from '../lib/layout';
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
    movable = [],
    onplace,
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
    /** Boxes the user can drag and resize in the preview, the topmost last. */
    movable?: Target[];
    /** A moved or resized box, in output pixels. */
    onplace?: (target: Target, box: Box) => void;
  } = $props();

  type Target = 'screen' | 'cam';
  type Grip = 'move' | 'nw' | 'ne' | 'sw' | 'se';
  const GRIPS = ['nw', 'ne', 'sw', 'se'] as const;

  let stageEl = $state<HTMLDivElement | null>(null);
  let dragging = $state<Target | null>(null);

  /** Drags a box (or one of its corners) with snapping to the edges, the margin and the middle; Alt turns snapping off. */
  function startDrag(e: PointerEvent, target: Target, grip: Grip) {
    const start = layout[target];
    if (!stageEl || !start || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const scale = layout.width / stageEl.getBoundingClientRect().width;
    const W = layout.width;
    const H = layout.height;
    const margin = layoutMargin(layout);
    const threshold = 8 * scale;
    const ratio = start.h / start.w;
    let moved = false;

    // How far to shift so the nearest of these positions lands on a snap line.
    const nudge = (values: number[], size: number, alt: boolean) => {
      if (alt) return 0;
      let best = 0;
      let found = false;
      for (const v of values) {
        const line = snapTo(v, size, margin, threshold);
        if (line !== null && (!found || Math.abs(line - v) < Math.abs(best))) {
          best = line - v;
          found = true;
        }
      }
      return best;
    };

    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - e.clientX) * scale;
      const dy = (ev.clientY - e.clientY) * scale;
      if (!moved && Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < 3) return;
      moved = true;
      dragging = target;
      let { x, y, w, h } = start;
      if (grip === 'move') {
        x = Math.max(0, Math.min(W - w, x + dx));
        y = Math.max(0, Math.min(H - h, y + dy));
        x += nudge([x, x + w / 2, x + w], W, ev.altKey);
        y += nudge([y, y + h / 2, y + h], H, ev.altKey);
      } else {
        const east = grip.endsWith('e');
        const south = grip.startsWith('s');
        // The dragged corner moves; the opposite one stays put.
        let cx = Math.max(0, Math.min(W, (east ? x + w : x) + dx));
        let cy = Math.max(0, Math.min(H, (south ? y + h : y) + dy));
        cx += nudge([cx], W, ev.altKey);
        cy += nudge([cy], H, ev.altKey);
        const ax = east ? x : x + w;
        const ay = south ? y : y + h;
        w = Math.abs(cx - ax);
        h = Math.abs(cy - ay);
        if (target === 'screen') {
          // The screen keeps its shape: follow whichever side was dragged further.
          w = Math.max(w, h / ratio);
          w = Math.min(w, east ? W - ax : ax, (south ? H - ay : ay) / ratio);
          w = Math.max(w, minScreenWidth(layout));
          h = w * ratio;
        } else {
          const min = minCamSide(layout);
          w = Math.max(min, w);
          h = Math.max(min, h);
        }
        x = east ? ax : ax - w;
        y = south ? ay : ay - h;
      }
      onplace?.(target, { x, y, w, h });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      dragging = null;
      // A click without a drag still plays and pauses.
      if (!moved) toggle();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  let screenEl = $state<HTMLVideoElement | null>(null);
  let camEl = $state<HTMLVideoElement | null>(null);

  // Recording time comes from the screen video; webcam-only recordings use the camera file instead.
  const camOffset = $derived(project.cam?.offset ?? 0);
  const master = $derived(project.screen ? screenEl : camEl);
  const getTime = (el: HTMLVideoElement) => (project.screen ? el.currentTime : el.currentTime + camOffset);
  const setTime = (el: HTMLVideoElement, t: number) => (el.currentTime = project.screen ? t : Math.max(0, t - camOffset));

  const screen = $derived(project.screen ?? { file: '', width: 1, height: 1 });
  const screenSrc = $derived(project.screen ? fileUrl(joinPath(dir, project.screen.file)) : null);
  const camSrc = $derived(project.cam ? fileUrl(joinPath(dir, project.cam.file)) : null);
  const out = $derived(toOutput(time, keeps));
  const view = $derived(viewAt(zoom, out ?? 0, screen.width, screen.height));
  /** Position inside the screen video, in percent of it. */
  const inVideo = (b: { x: number; y: number; w: number; h: number }) =>
    `left:${(b.x / screen.width) * 100}%;top:${(b.y / screen.height) * 100}%;width:${(b.w / screen.width) * 100}%;height:${(b.h / screen.height) * 100}%`;

  const pct = (b: Box) =>
    `left:${(b.x / layout.width) * 100}%;top:${(b.y / layout.height) * 100}%;width:${(b.w / layout.width) * 100}%;height:${(b.h / layout.height) * 100}%`;

  export function seek(t: number) {
    if (!master) return;
    setTime(master, Math.max(0, Math.min(project.duration, t)));
    time = getTime(master);
    syncCam(true);
  }

  export async function toggle() {
    if (!master) return;
    if (playing) {
      master.pause();
      return;
    }
    const t = getTime(master);
    const last = keeps[keeps.length - 1];
    if (!last) return;
    if (t >= last[1] - 0.05) seek(keeps[0][0]);
    else if (toOutput(t, keeps) === null) seek(nextKeepStart(t, keeps) ?? keeps[0][0]);
    await master.play();
  }

  function syncCam(force = false) {
    if (!camEl || !screenEl || !project.cam || !project.screen) return;
    const target = screenEl.currentTime - camOffset;
    if (target < 0 || (camEl.duration && target > camEl.duration)) {
      camEl.pause();
      return;
    }
    if (force || Math.abs(camEl.currentTime - target) > 0.15) camEl.currentTime = target;
    if (playing && camEl.paused) camEl.play().catch(() => {});
    if (!playing && !camEl.paused) camEl.pause();
  }

  function tick() {
    if (!master) return;
    const t = getTime(master);
    time = t;
    if (playing) {
      const next = nextKeepStart(t, keeps);
      const last = keeps[keeps.length - 1];
      if (next !== null) setTime(master, next);
      else if (!last || t >= last[1]) master.pause();
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
    bind:this={stageEl}
    style="aspect-ratio:{layout.width}/{layout.height};--ar:{layout.width / layout.height};background:#{BACKGROUND}"
  >
    {#if screenSrc}
      <!-- Stays mounted when only the webcam is shown: it is still the clock. -->
      <div class="screen" class:hidden={!layout.screen} style={layout.screen ? pct(layout.screen) : ''}>
        <div
          class="view"
          style="transform:scale({view.z}) translate({(-view.x / screen.width) * 100}%, {(-view.y / screen.height) * 100}%)"
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
    {/if}
    {#if camSrc}
      <!-- svelte-ignore a11y_media_has_caption -->
      <video
        bind:this={camEl}
        src={camSrc}
        class="cam"
        class:hidden={!layout.cam}
        style={layout.cam
          ? pct(layout.cam) +
            `;border-radius:${(layout.camRadius / layout.cam.w) * 100}% / ${(layout.camRadius / layout.cam.h) * 100}%` +
            `;object-position:${layout.camFocus * 100}% 50%`
          : ''}
        preload="auto"
        playsinline
        onplay={() => !project.screen && (playing = true)}
        onpause={() => !project.screen && (playing = false)}
        onclick={() => !project.screen && toggle()}
      ></video>
    {/if}
    <Overlay items={overlay} width={layout.width} height={layout.height} t={out} />
    {#each movable as target (target)}
      {@const b = layout[target]}
      {#if b}
        <div
          class="mover"
          class:dragging={dragging === target}
          style={pct(b)}
          role="presentation"
          onpointerdown={(e) => startDrag(e, target, 'move')}
        >
          {#each GRIPS as grip (grip)}
            <span class="grip {grip}" role="presentation" onpointerdown={(e) => startDrag(e, target, grip)}></span>
          {/each}
        </div>
      {/if}
    {/each}
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

  .cam.hidden,
  .screen.hidden {
    width: 1px;
    height: 1px;
    opacity: 0;
  }

  .mover {
    position: absolute;
    cursor: move;
    touch-action: none;
  }

  .mover:hover,
  .mover.dragging {
    outline: 2px solid var(--accent);
    outline-offset: -1px;
  }

  .grip {
    position: absolute;
    width: 12px;
    height: 12px;
    margin: -6px;
    border: 2px solid var(--accent);
    border-radius: 3px;
    background: #fff;
    opacity: 0;
  }

  .mover:hover .grip,
  .mover.dragging .grip {
    opacity: 1;
  }

  .grip.nw {
    left: 0;
    top: 0;
    cursor: nwse-resize;
  }

  .grip.ne {
    right: 0;
    top: 0;
    cursor: nesw-resize;
  }

  .grip.sw {
    left: 0;
    bottom: 0;
    cursor: nesw-resize;
  }

  .grip.se {
    right: 0;
    bottom: 0;
    cursor: nwse-resize;
  }

  .blur {
    position: absolute;
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
  }
</style>
