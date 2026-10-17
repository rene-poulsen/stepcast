// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StepEvent } from '../../shared/events';

const html = readFileSync(resolve(process.cwd(), 'test/playground.html'), 'utf8');
const sent: StepEvent[] = [];
let toContent: (msg: unknown) => void = () => {};

beforeAll(async () => {
  document.documentElement.innerHTML = html.replace(/^[\s\S]*?<html[^>]*>/, '').replace(/<\/html>\s*$/, '');
  vi.stubGlobal('chrome', {
    runtime: {
      sendMessage: (msg: { type: string; event?: StepEvent }) => {
        if (msg.type === 'event' && msg.event?.kind === 'step') sent.push(msg.event);
        return Promise.resolve(undefined);
      },
      onMessage: { addListener: (fn: (msg: unknown) => void) => (toContent = fn) },
    },
    storage: { local: { get: () => Promise.resolve({}), set: () => Promise.resolve() } },
  });
  vi.stubGlobal('requestAnimationFrame', (fn: () => void) => setTimeout(fn, 0));
  await import('../src/content');
  toContent({ type: 'state', recording: true, zoom: 1 });
});

beforeEach(() => {
  sent.length = 0;
  vi.useFakeTimers({ now: Date.now() + 10_000, toFake: ['Date'] });
});

const $ = (sel: string) => document.querySelector(sel) as HTMLElement;
const click = (el: Element) => el.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1, clientX: 10, clientY: 10 }));
const labels = () => sent.map((e) => `${e.action}:${e.name}${e.value ? '=' + e.value : ''}`);

describe('content script', () => {
  it('reports link and button clicks', () => {
    click($('nav a[href="#about"]'));
    click($('#save'));
    expect(labels()).toEqual(['click:About us', 'click:Save changes']);
    expect(sent[0].point).toBeDefined();
  });

  it('reports a text field once, on focus, not on the click', () => {
    $('#username').focus();
    click($('#username'));
    expect(labels()).toEqual(['enter:Username']);
  });

  it('reports a label click on a checkbox once, as a check', () => {
    const label = $('#terms').closest('label')!;
    click(label);
    const box = $('#terms') as HTMLInputElement;
    box.checked = true;
    box.dispatchEvent(new Event('change', { bubbles: true }));
    expect(labels()).toEqual(['check:I accept the terms & conditions']);
  });

  it('reports the chosen option of a select', () => {
    const select = $('#country') as HTMLSelectElement;
    select.selectedIndex = 1;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    expect(labels()).toEqual(['select:Country=Sweden']);
  });

  it('ignores a double click on the same element', () => {
    click($('#tab-pricing'));
    click($('#tab-pricing'));
    expect(labels()).toEqual(['click:Pricing']);
  });

  it('stays silent when not recording', () => {
    toContent({ type: 'state', recording: false });
    click($('#save'));
    expect(sent).toEqual([]);
    toContent({ type: 'state', recording: true, zoom: 1 });
  });
});

describe('keyboard', () => {
  const press = (target: Element, init: KeyboardEventInit) =>
    target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ...init }));

  it('labels shortcuts and Enter in a field, not typing', () => {
    const field = $('#username');
    press(field, { key: 'r' });
    press(field, { key: 's', ctrlKey: true });
    press(field, { key: 'Enter' });
    expect(labels()).toEqual(['press:Ctrl+S', 'press:Enter']);
  });

  it('leaves Enter on a button to the click label', () => {
    $('#save').focus();
    press($('#save'), { key: 'Enter' });
    expect(sent).toEqual([]);
  });
});
