// Toolbar popup: connection status and "pick element to blur".
export {};
const dot = document.getElementById('dot')!;
const statusText = document.getElementById('status')!;

async function refresh(): Promise<void> {
  const s = (await chrome.runtime.sendMessage({ type: 'popup-status' })) as { connected: boolean; recording: boolean };
  dot.className = 'dot' + (s.recording ? ' rec' : s.connected ? ' on' : '');
  statusText.textContent = s.recording ? 'Recording' : s.connected ? 'Connected to Stepcast' : 'Stepcast app is not running';
}

async function activeTab(): Promise<chrome.tabs.Tab | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

document.getElementById('pick')!.addEventListener('click', async () => {
  const tab = await activeTab();
  if (tab?.id === undefined) return;
  await chrome.tabs.sendMessage(tab.id, { type: 'pick-blur' }).catch(() => {});
  window.close();
});

document.getElementById('clear')!.addEventListener('click', async () => {
  const tab = await activeTab();
  if (!tab?.url) return;
  await chrome.storage.local.remove(`blur:${new URL(tab.url).host}`);
  statusText.textContent = 'Cleared';
});

refresh();
setTimeout(refresh, 600);
