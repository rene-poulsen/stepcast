<script lang="ts">
  import { strings } from '../lib/i18n';
  import { settings } from '../lib/settings.svelte';
  import { installUpdate, update } from '../lib/update.svelte';
  import Icon from './Icon.svelte';

  const t = $derived(strings(settings.lang));
  let dismissed = $state(false);
  let showNotes = $state(false);
</script>

{#if update.available && !dismissed}
  <div class="banner">
    <Icon name="sparkle" />
    <div class="text">
      <strong>{t.updateAvailable} · v{update.available.version}</strong>
      {#if update.available.body}
        <button class="notes-toggle" onclick={() => (showNotes = !showNotes)}>{showNotes ? '−' : '+'}</button>
      {/if}
      {#if showNotes && update.available.body}
        <pre class="notes">{update.available.body}</pre>
      {/if}
      {#if update.error}<span class="error">{update.error}</span>{/if}
    </div>
    {#if update.installing}
      <span class="muted">{t.updating} {Math.round(update.progress * 100)}%</span>
    {:else}
      <button class="btn ghost" onclick={() => (dismissed = true)}>{t.later}</button>
      <button class="btn primary" onclick={installUpdate}>{t.updateNow}</button>
    {/if}
  </div>
{/if}

<style>
  .banner {
    display: flex;
    align-items: center;
    gap: 12px;
    max-width: 720px;
    margin: 16px auto 0;
    padding: 10px 10px 10px 14px;
    border-radius: var(--radius);
    background: var(--accent-soft);
    color: var(--accent);
  }

  .text {
    flex: 1;
    color: var(--text);
  }

  .notes-toggle {
    margin-left: 6px;
    border: 0;
    background: none;
    color: var(--muted);
  }

  .notes {
    margin: 6px 0 0;
    font: inherit;
    font-size: 13px;
    white-space: pre-wrap;
    color: var(--muted);
  }

  .error {
    display: block;
    color: var(--red);
    font-size: 12px;
  }
</style>
