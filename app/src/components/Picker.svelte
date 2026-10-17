<script lang="ts">
  // Full-screen area picker over a screenshot of the monitor. Drag for an area, click for a window.
  import { onMount } from 'svelte';
  import { api } from '../lib/api';
  import { strings } from '../lib/i18n';
  import { settings } from '../lib/settings.svelte';
  import type { Area, WindowRect } from '../lib/types';

  const t = $derived(strings(settings.lang));
  let image = $state('');
  let windows = $state<WindowRect[]>([]);
  let mac = $state(false);
  /** Selected or hovered area, in physical monitor pixels. */
  let selection = $state<Area | null>(null);
  let hovered = $state<WindowRect | null>(null);
  let drag: { x: number; y: number; moved: boolean } | null = null;

  const dpr = () => window.devicePixelRatio || 1;
  const toPx = (e: PointerEvent) => ({ x: Math.round(e.clientX * dpr()), y: Math.round(e.clientY * dpr()) });
  const css = (a: Area) =>
    `left:${a.x / dpr()}px;top:${a.y / dpr()}px;width:${a.w / dpr()}px;height:${a.h / dpr()}px`;
  const shown = $derived(selection ?? hovered);

  function windowAt(x: number, y: number): WindowRect | null {
    return windows.find((w) => x >= w.x && x < w.x + w.w && y >= w.y && y < w.y + w.h) ?? null;
  }

  function down(e: PointerEvent) {
    if (e.button !== 0) return;
    const p = toPx(e);
    drag = { ...p, moved: false };
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  }

  function move(e: PointerEvent) {
    const p = toPx(e);
    if (!drag) {
      if (!selection) hovered = windowAt(p.x, p.y);
      return;
    }
    if (!drag.moved && Math.hypot(p.x - drag.x, p.y - drag.y) < 6) return;
    drag.moved = true;
    hovered = null;
    selection = {
      x: Math.min(p.x, drag.x),
      y: Math.min(p.y, drag.y),
      w: Math.abs(p.x - drag.x),
      h: Math.abs(p.y - drag.y),
    };
  }

  function up(e: PointerEvent) {
    if (!drag) return;
    const wasDrag = drag.moved;
    drag = null;
    if (wasDrag) {
      if (selection && (selection.w < 64 || selection.h < 64)) selection = null;
      return;
    }
    // A click selects the window under the pointer (or clears the selection).
    const p = toPx(e);
    const w = windowAt(p.x, p.y);
    selection = w ? { x: w.x, y: w.y, w: w.w, h: w.h } : null;
  }

  const confirm = () => selection && api.finishPick({ ...selection });
  const cancel = () => api.finishPick(null);

  onMount(() => {
    api.pickerData().then((data) => {
      if (!data) return cancel();
      image = data.image;
      windows = data.windows;
      mac = navigator.platform.startsWith('Mac');
    });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cancel();
      if (e.key === 'Enter') confirm();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
</script>

<div
  class="picker"
  style="background-image:url({image})"
  role="application"
  onpointerdown={down}
  onpointermove={move}
  onpointerup={up}
>
  {#if shown}
    {@const a = { x: shown.x / dpr(), y: shown.y / dpr(), w: shown.w / dpr(), h: shown.h / dpr() }}
    <!-- Four dimmed bands around the area. -->
    <div class="dim" style="left:0;top:0;right:0;height:{a.y}px"></div>
    <div class="dim" style="left:0;top:{a.y + a.h}px;right:0;bottom:0"></div>
    <div class="dim" style="left:0;top:{a.y}px;width:{a.x}px;height:{a.h}px"></div>
    <div class="dim" style="left:{a.x + a.w}px;top:{a.y}px;right:0;height:{a.h}px"></div>
    <div class="area" class:hover={!selection} style={css(shown)}></div>
  {:else}
    <div class="dim" style="inset:0"></div>
  {/if}

  {#if selection}
    {@const below = selection.y / dpr() + selection.h / dpr() + 64 < window.innerHeight}
    <div
      class="bar"
      style="left:{selection.x / dpr() + selection.w / dpr() / 2}px;top:{below
        ? selection.y / dpr() + selection.h / dpr() + 12
        : selection.y / dpr() + selection.h / dpr() - 56}px"
      onpointerdown={(e) => e.stopPropagation()}
      role="toolbar"
      tabindex="-1"
    >
      <span>{selection.w} × {selection.h}</span>
      <button class="btn ghost" onclick={cancel}>{t.cancel}</button>
      <button class="btn rec" onclick={confirm}><span class="dot"></span>{t.recordWhat}</button>
    </div>
  {:else}
    <div class="hint">{mac || windows.length === 0 ? t.pickHintMac : t.pickHint}</div>
  {/if}
</div>

<style>
  :global(html),
  :global(body) {
    background: #000;
  }

  .picker {
    position: fixed;
    inset: 0;
    background-size: 100% 100%;
    cursor: crosshair;
    user-select: none;
    overflow: hidden;
  }

  .dim {
    position: absolute;
    background: rgba(0, 0, 0, 0.45);
  }

  .area {
    position: absolute;
    border: 2px solid #fff;
    border-radius: 2px;
    box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.4);
  }

  .area.hover {
    border-color: #2383e2;
    background: rgba(35, 131, 226, 0.12);
  }

  .hint,
  .bar {
    position: absolute;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 6px 6px 14px;
    border-radius: 10px;
    background: rgba(25, 25, 25, 0.92);
    color: #e3e2e0;
    font-size: 13px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
  }

  .hint {
    top: 24px;
    left: 50%;
    transform: translateX(-50%);
    padding: 10px 16px;
    pointer-events: none;
  }

  .bar {
    transform: translateX(-50%);
    cursor: default;
  }

  .bar > span {
    font-variant-numeric: tabular-nums;
    color: #9b9a97;
    margin-right: 4px;
  }

  .bar .btn.ghost {
    color: #e3e2e0;
  }

  .bar .btn.ghost:hover {
    background: rgba(255, 255, 255, 0.08);
  }

  .btn.rec {
    border: 0;
    background: #e5484d;
    color: #fff;
  }

  .btn.rec:hover {
    background: #d13d42;
  }

  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #fff;
  }
</style>
