// Runs in every page and frame. Silent until the Stepcast app reports that it is recording.
import type { Action, RecorderEvent, Role, Rect } from '../../shared/events';
import { sampleMouse, setZoom, toScreenPoint, toScreenRect, visibleRect } from './geometry';
import {
  changeAction,
  clickAction,
  findClickTarget,
  isNativeFormControl,
  isTextEntry,
  nameOf,
  roleOf,
  shortcutLabel,
} from './naming';

type FromBackground =
  | { type: 'state'; recording: boolean; zoom?: number }
  | { type: 'zoom'; zoom: number }
  | { type: 'pick-blur' };

const DEBOUNCE_MS = 400;
const BLUR_POLL_MS = 200;
const BLUR_PAD = 6;

let recording = false;
let lastEmit: { el: Element; action: Action; at: number } | null = null;
let blurTimer: number | undefined;
let blurSelectors: string[] = [];
let lastBlurKey = '';
const source = `${Math.random().toString(36).slice(2)}:${location.href.slice(0, 80)}`;

function send(event: RecorderEvent): void {
  chrome.runtime.sendMessage({ type: 'event', event }).catch(() => {});
}

function emitStep(el: Element, action: Action, role: Role, extra: { value?: string; clientX?: number; clientY?: number } = {}): void {
  const now = Date.now();
  if (lastEmit && lastEmit.el === el && lastEmit.action === action && now - lastEmit.at < DEBOUNCE_MS) return;
  lastEmit = { el, action, at: now };

  const name = nameOf(el);
  if (!name && action !== 'enter') return;
  const box = visibleRect(el);
  send({
    kind: 'step',
    t: now,
    action,
    role,
    name,
    value: extra.value,
    rect: box ? toScreenRect(box) : undefined,
    point: extra.clientX !== undefined ? toScreenPoint(extra.clientX, extra.clientY ?? 0) : undefined,
  });
}

function onClick(e: MouseEvent): void {
  if (!recording || !(e.target instanceof Element)) return;
  sampleMouse(e);
  const el = findClickTarget(e.target);
  if (!el || isNativeFormControl(el)) return;
  const role = roleOf(el);
  const coords = e.detail > 0 ? { clientX: e.clientX, clientY: e.clientY } : {};
  emitStep(el, clickAction(el, role), role, coords);
}

function onFocusIn(e: FocusEvent): void {
  if (!recording || !(e.target instanceof Element)) return;
  if (isTextEntry(e.target)) emitStep(e.target, 'enter', 'textbox');
}

function onChange(e: Event): void {
  if (!recording || !(e.target instanceof Element)) return;
  const change = changeAction(e.target);
  if (change) emitStep(e.target, change.action, change.role, { value: change.value });
}

const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
let lastKey = { label: '', at: 0 };

function onKeyDown(e: KeyboardEvent): void {
  if (!recording || e.repeat) return;
  const label = shortcutLabel(e, isMac);
  if (!label) return;
  const now = Date.now();
  if (label === lastKey.label && now - lastKey.at < DEBOUNCE_MS) return;
  lastKey = { label, at: now };
  const focused = document.activeElement;
  // Enter on a button or link also clicks it, and the click already has a label.
  if (label === 'Enter' && focused && ['button', 'link', 'accordion', 'tab', 'menuitem'].includes(roleOf(focused))) return;
  const box = focused && focused !== document.body ? visibleRect(focused) : null;
  send({ kind: 'step', t: now, action: 'press', role: 'key', name: label, rect: box ? toScreenRect(box) : undefined });
}

// --- Sensitive areas -----------------------------------------------------

function sensitiveElements(): Element[] {
  const found = new Set<Element>(document.querySelectorAll('input[type="password"]'));
  for (const selector of blurSelectors) {
    try {
      document.querySelectorAll(selector).forEach((el) => found.add(el));
    } catch {
      // Ignore selectors that no longer parse.
    }
  }
  return [...found];
}

function reportBlur(): void {
  if (!recording) return;
  const rects: Rect[] = [];
  if (document.visibilityState === 'visible') {
    for (const el of sensitiveElements()) {
      const box = visibleRect(el);
      if (!box) continue;
      const r = toScreenRect(box);
      rects.push({ x: r.x - BLUR_PAD, y: r.y - BLUR_PAD, w: r.w + BLUR_PAD * 2, h: r.h + BLUR_PAD * 2 });
    }
  }
  const key = JSON.stringify(rects);
  if (key === lastBlurKey) return;
  lastBlurKey = key;
  send({ kind: 'blur', t: Date.now(), source, rects });
}

let blurFrame = 0;
function scheduleBlur(): void {
  if (!recording || blurFrame) return;
  blurFrame = requestAnimationFrame(() => {
    blurFrame = 0;
    reportBlur();
  });
}

async function loadBlurSelectors(): Promise<void> {
  const key = `blur:${location.host}`;
  const stored = await chrome.storage.local.get(key);
  blurSelectors = (stored[key] as string[] | undefined) ?? [];
}

// --- Recording state -----------------------------------------------------

function setRecording(next: boolean): void {
  if (next === recording) return;
  recording = next;
  window.clearInterval(blurTimer);
  if (recording) {
    lastBlurKey = '';
    loadBlurSelectors().finally(reportBlur);
    blurTimer = window.setInterval(reportBlur, BLUR_POLL_MS);
  } else if (lastBlurKey && lastBlurKey !== '[]') {
    send({ kind: 'blur', t: Date.now(), source, rects: [] });
    lastBlurKey = '';
  }
}

// --- Picking an element to blur ------------------------------------------

function cssPath(el: Element): string {
  if (el.id && /^[A-Za-z][\w-]*$/.test(el.id)) return `#${el.id}`;
  const parts: string[] = [];
  let cur: Element | null = el;
  while (cur && cur !== document.documentElement && parts.length < 6) {
    if (cur.id && /^[A-Za-z][\w-]*$/.test(cur.id)) {
      parts.unshift(`#${cur.id}`);
      break;
    }
    const tag = cur.tagName.toLowerCase();
    const parent: Element | null = cur.parentElement;
    const same = parent ? Array.from(parent.children).filter((c) => c.tagName === cur!.tagName) : [];
    parts.unshift(same.length > 1 ? `${tag}:nth-of-type(${same.indexOf(cur) + 1})` : tag);
    cur = parent;
  }
  return parts.join(' > ');
}

function pickBlurElement(): void {
  const box = document.createElement('div');
  box.style.cssText =
    'position:fixed;z-index:2147483647;pointer-events:none;border:2px solid #2383e2;background:rgba(35,131,226,.15);border-radius:6px;transition:all 60ms';
  document.documentElement.appendChild(box);

  const move = (e: MouseEvent) => {
    const r = (e.target as Element).getBoundingClientRect();
    Object.assign(box.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
  };
  const done = () => {
    box.remove();
    document.removeEventListener('mousemove', move, true);
    document.removeEventListener('click', pick, true);
    document.removeEventListener('keydown', key, true);
  };
  const pick = async (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    done();
    const k = `blur:${location.host}`;
    const stored = await chrome.storage.local.get(k);
    const list = new Set((stored[k] as string[] | undefined) ?? []);
    list.add(cssPath(e.target as Element));
    await chrome.storage.local.set({ [k]: [...list] });
    blurSelectors = [...list];
    reportBlur();
  };
  const key = (e: KeyboardEvent) => {
    if (e.key === 'Escape') done();
  };
  document.addEventListener('mousemove', move, true);
  document.addEventListener('click', pick, true);
  document.addEventListener('keydown', key, true);
}

// --- Wiring ----------------------------------------------------------------

document.addEventListener('mousemove', sampleMouse, { capture: true, passive: true });
document.addEventListener('click', onClick, true);
document.addEventListener('focusin', onFocusIn, true);
document.addEventListener('change', onChange, true);
document.addEventListener('keydown', onKeyDown, true);
window.addEventListener('scroll', scheduleBlur, { capture: true, passive: true });
window.addEventListener('resize', scheduleBlur, { passive: true });
document.addEventListener('visibilitychange', reportBlur);

chrome.runtime.onMessage.addListener((msg: FromBackground) => {
  if (msg.type === 'state') {
    if (msg.zoom) setZoom(msg.zoom);
    setRecording(msg.recording);
  } else if (msg.type === 'zoom') {
    setZoom(msg.zoom);
    scheduleBlur();
  } else if (msg.type === 'pick-blur' && window === window.top) {
    pickBlurElement();
  }
});

chrome.runtime
  .sendMessage({ type: 'get-state' })
  .then((state?: { recording: boolean; zoom: number }) => {
    if (!state) return;
    setZoom(state.zoom);
    setRecording(state.recording);
  })
  .catch(() => {});
