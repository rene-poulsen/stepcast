<script lang="ts">
  import { listen } from '@tauri-apps/api/event';
  import { onMount } from 'svelte';
  import Editor from './components/Editor.svelte';
  import Home from './components/Home.svelte';
  import Picker from './components/Picker.svelte';
  import Pill from './components/Pill.svelte';

  const params = new URLSearchParams(location.search);
  const isPill = params.get('w') === 'pill';
  const isPicker = params.get('w') === 'picker';

  let openDir = $state<string | null>(null);

  onMount(() => {
    if (isPill || isPicker) return;
    const off = listen<string>('recording-finished', (e) => (openDir = e.payload));
    return () => {
      off.then((fn) => fn());
    };
  });
</script>

{#if isPicker}
  <Picker />
{:else if isPill}
  <Pill camera={params.get('camera') === 'true'} mic={params.get('mic') === 'true'} />
{:else if openDir}
  {#key openDir}
    <Editor dir={openDir} onclose={() => (openDir = null)} />
  {/key}
{:else}
  <Home onopen={(dir) => (openDir = dir)} />
{/if}
