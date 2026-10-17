// Keeps one WebSocket to the Stepcast app and relays page events to it.
import { APP_PORT, type AppToExt, type ExtToApp } from '../../shared/events';

const URL = `ws://127.0.0.1:${APP_PORT}`;
const KEEPALIVE_MS = 20_000;

let socket: WebSocket | null = null;
let recording = false;
let keepalive: ReturnType<typeof setInterval> | undefined;
let lastTitle = new Map<number, string>();

function isConnected(): boolean {
  return socket?.readyState === WebSocket.OPEN;
}

function sendToApp(msg: ExtToApp): void {
  if (isConnected()) socket!.send(JSON.stringify(msg));
}

function connect(): void {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;
  let ws: WebSocket;
  try {
    ws = new WebSocket(URL);
  } catch {
    return;
  }
  socket = ws;
  ws.onopen = () => {
    const browser = navigator.userAgent.includes('Edg/') ? 'edge' : 'chrome';
    sendToApp({ type: 'hello', browser, version: chrome.runtime.getManifest().version });
    clearInterval(keepalive);
    keepalive = setInterval(() => sendToApp({ type: 'ping' }), KEEPALIVE_MS);
    updateBadge();
  };
  ws.onmessage = (e) => {
    const msg = JSON.parse(String(e.data)) as AppToExt;
    if (msg.type === 'state') setRecording(msg.recording);
  };
  ws.onclose = () => {
    if (socket === ws) socket = null;
    clearInterval(keepalive);
    setRecording(false);
    updateBadge();
  };
}

async function setRecording(next: boolean): Promise<void> {
  if (next === recording) return;
  recording = next;
  await chrome.storage.session.set({ recording });
  updateBadge();
  if (recording) lastTitle = new Map();
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (tab.id === undefined) continue;
    const zoom = await chrome.tabs.getZoom(tab.id).catch(() => 1);
    chrome.tabs.sendMessage(tab.id, { type: 'state', recording, zoom }).catch(() => {});
  }
}

function updateBadge(): void {
  chrome.action.setBadgeText({ text: recording ? 'REC' : '' });
  chrome.action.setBadgeBackgroundColor({ color: '#e5484d' });
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg.type === 'event') {
    sendToApp({ type: 'event', event: msg.event });
  } else if (msg.type === 'get-state') {
    const tabId = sender.tab?.id;
    if (tabId === undefined) {
      reply({ recording, zoom: 1 });
      return;
    }
    chrome.tabs
      .getZoom(tabId)
      .catch(() => 1)
      .then((zoom) => reply({ recording, zoom }));
    return true;
  } else if (msg.type === 'popup-status') {
    connect();
    reply({ connected: isConnected(), recording });
  }
  return undefined;
});

chrome.tabs.onZoomChange.addListener(({ tabId, newZoomFactor }) => {
  chrome.tabs.sendMessage(tabId, { type: 'zoom', zoom: newZoomFactor }).catch(() => {});
});

// "Open 'Pricing – Acme'" when a page finishes loading during a recording.
chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (!recording || info.status !== 'complete' || !tab.active || !tab.title) return;
  if (lastTitle.get(tabId) === tab.title) return;
  const first = !lastTitle.has(tabId);
  lastTitle.set(tabId, tab.title);
  if (first && tab.url?.startsWith('chrome')) return;
  sendToApp({ type: 'event', event: { kind: 'step', t: Date.now(), action: 'navigate', role: 'page', name: tab.title } });
});

// Service workers sleep; the alarm wakes this one up to reconnect when the app starts.
chrome.alarms.create('reconnect', { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener(connect);
chrome.runtime.onStartup.addListener(connect);
chrome.runtime.onInstalled.addListener(connect);
chrome.storage.session.get('recording').then((s) => {
  recording = s.recording === true;
});
connect();
