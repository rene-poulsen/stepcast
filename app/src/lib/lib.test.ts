import { describe, expect, it } from 'vitest';
import { buildAss, overlayItems, roundedRect } from './ass';
import { computeLayout, mapRect } from './layout';
import { phrase } from './phrases';
import { blurSegments, buildSteps, defaultEdits } from './steps';
import { keepRanges, outputDuration, toOutput, toSource } from './timeline';
import type { Project } from './types';

const project: Project = {
  version: 1,
  title: '',
  createdAt: '2026-10-17T12:00:00Z',
  duration: 20,
  screen: { file: 'screen.mp4', width: 1920, height: 1080, x: 1920, y: 0, monitorWidth: 1920, monitorHeight: 1080, scale: 1 },
  cam: { file: 'cam.webm', mime: 'video/webm', offset: -0.2, video: true, audio: true },
  pauses: [[8, 10]],
  events: [
    { kind: 'step', t: 0, time: 1, action: 'click', role: 'link', name: 'Products', point: { x: 2020, y: 50 }, rect: { x: 2000, y: 40, w: 80, h: 20 } },
    { kind: 'step', t: 0, time: 2, action: 'navigate', role: 'page', name: 'Products – Acme' },
    { kind: 'step', t: 0, time: 9, action: 'click', role: 'button', name: 'Hidden by pause' },
    { kind: 'step', t: 0, time: 12, action: 'enter', role: 'textbox', name: 'Username' },
    { kind: 'blur', t: 0, time: 11, source: 'a', rects: [{ x: 2020, y: 300, w: 200, h: 30 }] },
    { kind: 'blur', t: 0, time: 15, source: 'a', rects: [] },
  ],
  edits: null,
};

describe('phrases', () => {
  it('writes English and Danish labels', () => {
    expect(phrase({ action: 'click', role: 'link', name: 'About us' }, 'en')).toBe("Click 'About us' link");
    expect(phrase({ action: 'click', role: 'button', name: 'Products' }, 'en')).toBe("Click 'Products'");
    expect(phrase({ action: 'enter', role: 'textbox', name: 'Username' }, 'en')).toBe("Enter 'Username'");
    expect(phrase({ action: 'check', role: 'checkbox', name: 'I accept' }, 'en')).toBe("Check 'I accept'");
    expect(phrase({ action: 'click', role: 'tab', name: 'Pricing' }, 'da')).toBe("Åbn fanen 'Pricing'");
    expect(phrase({ action: 'select', role: 'select', name: 'Land', value: 'Danmark' }, 'da')).toBe("Vælg 'Danmark' i 'Land'");
  });
});

describe('timeline', () => {
  const keeps = keepRanges([1, 20], [[8, 10], [14, 15]]);
  it('removes pauses and trimmed parts', () => {
    expect(keeps).toEqual([[1, 8], [10, 14], [15, 20]]);
    expect(outputDuration(keeps)).toBe(16);
  });
  it('maps between source and output time', () => {
    expect(toOutput(0.5, keeps)).toBeNull();
    expect(toOutput(9, keeps)).toBeNull();
    expect(toOutput(11, keeps)).toBe(8);
    expect(toSource(8, keeps)).toBe(11);
    expect(toSource(toOutput(17, keeps)!, keeps)).toBe(17);
  });
});

describe('layout', () => {
  it('keeps the full screen without a webcam', () => {
    const l = computeLayout(1920, 1080, null);
    expect(l.screen).toEqual({ x: 0, y: 0, w: 1920, h: 1080 });
    expect(l.cam).toBeNull();
  });
  it('puts the webcam beside the screen, never on top of it', () => {
    for (const side of ['left', 'right'] as const) {
      const l = computeLayout(1920, 1080, { enabled: true, split: 0.25, side });
      const cam = l.cam!;
      const overlaps = cam.x < l.screen.x + l.screen.w && cam.x + cam.w > l.screen.x;
      expect(overlaps).toBe(false);
      expect(l.width).toBe(1920);
      expect(l.screen.w / l.screen.h).toBeCloseTo(1920 / 1080, 2);
      for (const n of [l.screen.x, l.screen.y, l.screen.w, l.screen.h, cam.x, cam.y, cam.w, cam.h]) expect(n % 2).toBe(0);
    }
  });
  it('uses the same margin at the edges and between screen and webcam', () => {
    for (const side of ['left', 'right'] as const) {
      const l = computeLayout(1920, 1080, { enabled: true, split: 0.25, side });
      const [a, b] = side === 'right' ? [l.screen, l.cam!] : [l.cam!, l.screen];
      const gaps = [a.x, b.x - (a.x + a.w), l.width - (b.x + b.w)];
      expect(gaps[0]).toBeGreaterThan(0);
      expect(new Set(gaps).size).toBe(1);
    }
  });
  it('maps desktop coordinates into the scaled screen', () => {
    const l = computeLayout(1920, 1080, { enabled: true, split: 0.25, side: 'left' });
    const r = mapRect({ x: 1920 + 960, y: 540, w: 100, h: 0 }, project.screen, l.screen);
    expect(r.x).toBeCloseTo(l.screen.x + l.screen.w / 2);
    expect(r.w).toBeCloseTo((100 * l.screen.w) / 1920);
  });
});

describe('steps', () => {
  const edits = defaultEdits(project, 'en');
  it('skips page loads right after a click and steps inside pauses', () => {
    const steps = buildSteps(project, edits);
    expect(steps.map((s) => s.text)).toEqual(["Click 'Products' link", "Enter 'Username'"]);
    expect(steps[1].out).toBe(10);
  });
  it('applies text edits and deletions', () => {
    const steps = buildSteps(project, { ...edits, steps: { 0: { text: 'Open the product list' }, 3: { deleted: true } } });
    expect(steps[0].text).toBe('Open the product list');
    expect(steps[1].deleted).toBe(true);
  });
  it('turns blur events into timed rectangles on the recorded monitor', () => {
    expect(blurSegments(project)).toEqual([{ start: 10.9, end: 15.1, x: 100, y: 300, w: 200, h: 30 }]);
  });
});

describe('ass', () => {
  it('draws a closed rounded rectangle', () => {
    expect(roundedRect(100, 40, 10)).toMatch(/^m 10 0 l 90 0 b .* b 0 4\.5 4\.5 0 10 0$/);
  });
  it('produces labels, ripple, highlight and webcam corners', () => {
    const edits = defaultEdits(project, 'da');
    const layout = computeLayout(1920, 1080, edits.camera);
    const ass = buildAss({
      project,
      layout,
      steps: buildSteps(project, edits),
      duration: 18,
      ripple: true,
      highlight: true,
      measure: (t, size) => t.length * size * 0.55,
    });
    expect(ass).toContain('PlayResX: 1920');
    expect(ass).toContain("Klik på linket 'Products'");
    expect(ass).toContain("Udfyld 'Username'");
    expect(ass.match(/^Dialogue: 1,/gm)).toHaveLength(4);
    expect(ass).toContain('\\t(0,550');
    expect(ass).toContain('Dialogue: 10,0:00:01.00,0:00:03.60,');
  });
});

describe('area recordings', () => {
  it('labels clicks outside the area but draws no ripple or highlight for them', () => {
    const area: Project = {
      ...project,
      cam: null,
      screen: { ...project.screen, x: 2000, y: 100, width: 800, height: 600, monitorWidth: 800, monitorHeight: 600, area: true },
      events: [
        { kind: 'step', t: 0, time: 1, action: 'click', role: 'button', name: 'Inside', point: { x: 2100, y: 200 }, rect: { x: 2050, y: 180, w: 100, h: 40 } },
        { kind: 'step', t: 0, time: 4, action: 'click', role: 'button', name: 'Outside', point: { x: 1950, y: 50 }, rect: { x: 1900, y: 30, w: 80, h: 40 } },
      ],
    };
    const edits = { ...defaultEdits(area, 'en'), camera: { enabled: false, split: 0.25, side: 'right' as const } };
    const items = overlayItems({
      project: area,
      layout: computeLayout(800, 600, null),
      steps: buildSteps(area, edits),
      duration: 10,
      ripple: true,
      highlight: true,
      measure: (t, size) => t.length * size * 0.5,
    });
    expect(items.labels.map((l) => l.text)).toEqual(["Click 'Inside'", "Click 'Outside'"]);
    expect(items.ripples).toHaveLength(1);
    expect(items.highlights).toHaveLength(1);
    expect(items.ripples[0]).toMatchObject({ x: 100, y: 100 });
  });
});
