<script lang="ts">
  // Draws the same labels, highlights and ripples as the exported ASS file, at output time `t`.
  import {
    ACCENT,
    ASS_EM,
    HIGHLIGHT_FADE,
    LABEL_FADE,
    PILL_ALPHA,
    PILL_COLOR,
    RIPPLE,
    type Overlay,
  } from '../lib/ass';

  let { items, width, height, t }: { items: Overlay; width: number; height: number; t: number | null } = $props();

  const clamp = (n: number) => Math.max(0, Math.min(1, n));
  const fade = (start: number, end: number, fin: number, fout: number) =>
    t === null ? 0 : clamp(Math.min((t - start) / fin, (end - t) / fout));
  const active = <T extends { start: number; end: number }>(list: T[]) =>
    t === null ? [] : list.filter((x) => t! >= x.start && t! < x.end);
</script>

<svg viewBox="0 0 {width} {height}" preserveAspectRatio="none" aria-hidden="true">
  {#each active(items.highlights) as h}
    <rect
      x={h.x - h.border / 2}
      y={h.y - h.border / 2}
      width={h.w + h.border}
      height={h.h + h.border}
      rx={h.radius + h.border / 2}
      fill="none"
      stroke="#{ACCENT}"
      stroke-width={h.border}
      opacity={0.94 * fade(h.start, h.end, HIGHLIGHT_FADE.in, HIGHLIGHT_FADE.out)}
    />
  {/each}

  {#each active(items.ripples) as r}
    {@const f = Math.pow(clamp((t! - r.start) / RIPPLE.seconds), RIPPLE.accel)}
    <circle
      cx={r.x}
      cy={r.y}
      r={r.radius * (RIPPLE.from + (1 - RIPPLE.from) * f)}
      fill="#{ACCENT}"
      opacity={(1 - RIPPLE.alpha) * (1 - f)}
    />
  {/each}

  {#each active(items.labels) as l}
    {@const o = fade(l.start, l.end, LABEL_FADE.in, LABEL_FADE.out)}
    {@const dy = LABEL_FADE.rise * (1 - clamp((t! - l.start) / LABEL_FADE.riseTime))}
    <g opacity={o} transform="translate(0 {dy})">
      <rect x={l.x} y={l.y} width={l.w} height={l.h} rx={l.radius} fill="#{PILL_COLOR}" opacity={1 - PILL_ALPHA} />
      <text
        x={l.x + l.w / 2}
        y={l.y + l.h / 2}
        font-size={l.fontSize * ASS_EM}
        text-anchor="middle"
        dominant-baseline="central"
        fill="#fff">{l.text}</text
      >
    </g>
  {/each}
</svg>

<style>
  svg {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    font-family: 'Stepcast Label', Inter, sans-serif;
  }
</style>
