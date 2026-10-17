<script lang="ts">
  import { revealItemInDir } from '@tauri-apps/plugin-opener';
  import type { AppInfo } from '../lib/api';
  import { strings } from '../lib/i18n';
  import { settings } from '../lib/settings.svelte';
  import Icon from './Icon.svelte';

  let { info, connected, onclose }: { info: AppInfo; connected: boolean; onclose: () => void } = $props();

  const t = $derived(strings(settings.lang));
  let copied = $state('');

  async function copy(text: string) {
    await navigator.clipboard.writeText(text);
    copied = text;
    setTimeout(() => copied === text && (copied = ''), 1500);
  }
</script>

<div class="backdrop" role="presentation" onclick={(e) => e.target === e.currentTarget && onclose()}>
  <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="setup-title">
    <div class="head">
      <h2 id="setup-title">{t.setupTitle}</h2>
      <button class="icon-btn" onclick={onclose} aria-label={t.done}><Icon name="x" /></button>
    </div>
    <p class="muted">{t.setupBody}</p>

    <ol>
      <li>
        {t.setupStep1}
        <div class="codes">
          {#each ['chrome://extensions', 'edge://extensions'] as url}
            <button class="code" onclick={() => copy(url)}>
              <code>{url}</code><span>{copied === url ? t.copied : t.copy}</span>
            </button>
          {/each}
        </div>
      </li>
      <li>{t.setupStep2}</li>
      <li>
        {t.setupStep3}
        <div class="codes">
          <button class="code" onclick={() => copy(info.extensionDir)}>
            <code>{info.extensionDir}</code><span>{copied === info.extensionDir ? t.copied : t.copy}</span>
          </button>
          <button class="btn" onclick={() => revealItemInDir(info.extensionDir)}><Icon name="folder" /></button>
        </div>
      </li>
      <li>{t.setupStep4}</li>
    </ol>

    {#if info.platform === 'macos'}
      <p class="muted small">{t.permissionsMac}</p>
    {/if}

    <div class="foot">
      <span class="status" class:on={connected}>
        <span class="dot"></span>{connected ? t.extConnected : t.extMissing}
      </span>
      <button class="btn primary" onclick={onclose}>{t.done}</button>
    </div>
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    display: grid;
    place-items: center;
    padding: 16px;
    background: rgba(15, 15, 15, 0.35);
    z-index: 10;
  }

  .dialog {
    width: 100%;
    max-width: 560px;
    max-height: 100%;
    overflow-y: auto;
    padding: 24px;
    border-radius: 12px;
    background: var(--bg);
    box-shadow: 0 16px 48px rgba(0, 0, 0, 0.2);
  }

  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  h2 {
    font-size: 18px;
  }

  ol {
    margin: 16px 0;
    padding-left: 20px;
  }

  li {
    margin-bottom: 12px;
  }

  .codes {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 6px;
  }

  .code {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
    max-width: 100%;
    height: 32px;
    padding: 0 10px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface);
  }

  .code code {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 12.5px;
  }

  .code span {
    color: var(--accent);
    font-size: 12px;
  }

  .small {
    font-size: 13px;
  }

  .foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-top: 8px;
  }

  .status {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    color: var(--muted);
  }

  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--faint);
  }

  .status.on .dot {
    background: var(--green);
  }

  .status.on {
    color: var(--text);
  }
</style>
