<script lang="ts">
  // Output formats as small tiles in their own shape, with where each one is used.
  import type { Format, FormatId } from '../lib/formats';
  import { strings } from '../lib/i18n';
  import type { Lang } from '../lib/types';

  let {
    formats,
    value = $bindable(),
    lang,
    onchange,
  }: { formats: Format[]; value: FormatId; lang: Lang; onchange?: () => void } = $props();

  const t = $derived(strings(lang));
  const selected = $derived(formats.find((f) => f.id === value) ?? formats[0]);
  /** Tile shape: `original` is drawn as the usual 16:10 screen. */
  const shape = (f: Format) => {
    const [w, h] = f.width ? [f.width, f.height] : [16, 10];
    const k = 22 / Math.max(w, h);
    return `width:${Math.round(w * k)}px;height:${Math.round(h * k)}px`;
  };
</script>

<div class="formats" role="radiogroup" aria-label={t.format}>
  {#each formats as f (f.id)}
    <button
      role="radio"
      aria-checked={f.id === value}
      class:on={f.id === value}
      title="{t.formatNames[f.id]} · {f.platforms || t.originalHint}"
      onclick={() => {
        value = f.id;
        onchange?.();
      }}
    >
      <span class="shape" class:original={!f.width} style={shape(f)}></span>
      <span class="ratio">{f.width ? f.id : t.formatNames.original}</span>
    </button>
  {/each}
</div>
<p class="caption">
  <strong>{t.formatNames[selected.id]}</strong>
  <span>{selected.platforms || t.originalHint}</span>
</p>

<style>
  .formats {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(38px, 1fr));
    gap: 4px;
  }

  button {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: flex-end;
    gap: 6px;
    height: 58px;
    padding: 6px 2px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--bg);
    color: var(--muted);
    font-size: 10.5px;
    font-variant-numeric: tabular-nums;
    overflow: hidden;
  }

  button:hover {
    background: var(--hover);
  }

  button.on {
    border-color: var(--accent);
    background: var(--accent-soft);
    color: var(--text);
  }

  .shape {
    flex: none;
    border: 1.5px solid currentColor;
    border-radius: 3px;
  }

  .shape.original {
    border-style: dashed;
  }

  .ratio {
    white-space: nowrap;
  }

  .caption {
    display: flex;
    gap: 6px;
    margin: 8px 0 0;
    font-size: 12px;
    color: var(--muted);
  }

  .caption strong {
    color: var(--text);
    font-weight: 500;
  }
</style>
