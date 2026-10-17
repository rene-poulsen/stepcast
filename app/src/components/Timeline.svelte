<script lang="ts">
  // Source-time timeline: drag the ends to trim, click to seek. Pauses show as cut areas.
  import type { Step } from '../lib/steps';
  import type { Range } from '../lib/timeline';

  let {
    duration,
    trim = $bindable(),
    pauses,
    steps,
    time,
    onseek,
    onchange,
  }: {
    duration: number;
    trim: Range;
    pauses: Range[];
    steps: Step[];
    time: number;
    onseek: (t: number) => void;
    onchange: () => void;
  } = $props();

  let track = $state<HTMLDivElement | null>(null);
  let dragging = $state<'start' | 'end' | 'seek' | null>(null);

  const pct = (t: number) => `${(Math.max(0, Math.min(duration, t)) / duration) * 100}%`;

  function timeAt(e: PointerEvent): number {
    const r = track!.getBoundingClientRect();
    return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * duration;
  }

  function down(e: PointerEvent, what: 'start' | 'end' | 'seek') {
    e.stopPropagation();
    dragging = what;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    move(e);
  }

  function move(e: PointerEvent) {
    if (!dragging) return;
    const t = timeAt(e);
    if (dragging === 'start') {
      trim = [Math.min(t, trim[1] - 0.5), trim[1]];
      onseek(trim[0]);
    } else if (dragging === 'end') {
      trim = [trim[0], Math.max(t, trim[0] + 0.5)];
      onseek(trim[1]);
    } else onseek(t);
  }

  function up() {
    if (dragging === 'start' || dragging === 'end') onchange();
    dragging = null;
  }
</script>

<div
  class="timeline"
  bind:this={track}
  role="slider"
  tabindex="0"
  aria-valuemin={0}
  aria-valuemax={duration}
  aria-valuenow={time}
  onpointerdown={(e) => down(e, 'seek')}
  onpointermove={move}
  onpointerup={up}
  onkeydown={(e) => {
    if (e.key === 'ArrowLeft') onseek(time - 1);
    if (e.key === 'ArrowRight') onseek(time + 1);
  }}
>
  <div class="rail"></div>
  <div class="cut" style="left:0;width:{pct(trim[0])}"></div>
  <div class="cut" style="left:{pct(trim[1])};right:0"></div>
  {#each pauses as [a, b]}
    <div class="cut pause" style="left:{pct(a)};width:calc({pct(b)} - {pct(a)})"></div>
  {/each}
  {#each steps as step (step.index)}
    <span class="marker" class:deleted={step.deleted} style="left:{pct(step.time)}"></span>
  {/each}
  <button class="handle start" style="left:{pct(trim[0])}" aria-label="Trim start" onpointerdown={(e) => down(e, 'start')}
  ></button>
  <button class="handle end" style="left:{pct(trim[1])}" aria-label="Trim end" onpointerdown={(e) => down(e, 'end')}></button>
  <div class="playhead" style="left:{pct(time)}"></div>
</div>

<style>
  .timeline {
    position: relative;
    height: 40px;
    cursor: pointer;
    touch-action: none;
    outline: none;
  }

  .rail {
    position: absolute;
    left: 0;
    right: 0;
    top: 12px;
    height: 16px;
    border-radius: 4px;
    background: var(--surface-2);
  }

  .cut {
    position: absolute;
    top: 12px;
    height: 16px;
    background: repeating-linear-gradient(-45deg, var(--active) 0 4px, transparent 4px 8px);
    border-radius: 4px;
  }

  .marker {
    position: absolute;
    top: 16px;
    width: 8px;
    height: 8px;
    margin-left: -4px;
    border-radius: 50%;
    background: var(--accent);
    pointer-events: none;
  }

  .marker.deleted {
    background: var(--faint);
  }

  .handle {
    position: absolute;
    top: 8px;
    width: 10px;
    height: 24px;
    margin-left: -5px;
    padding: 0;
    border: 2px solid var(--bg);
    border-radius: 4px;
    background: var(--text);
    cursor: ew-resize;
  }

  .playhead {
    position: absolute;
    top: 4px;
    bottom: 4px;
    width: 2px;
    margin-left: -1px;
    border-radius: 1px;
    background: var(--red);
    pointer-events: none;
  }
</style>
