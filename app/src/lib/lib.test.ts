import { describe, expect, it } from 'vitest';
import { buildAss, overlayItems, roundedRect } from './ass';
import { exportSpec, projectLayout, render } from './exporter';
import { outputSize } from './formats';
import { computeLayout, mapRect, type Layout } from './layout';
import { phrase } from './phrases';
import { blurSegments, buildSteps, defaultEdits, normalizeEdits, viewsFor } from './steps';
import { keepRanges, outputDuration, toOutput, toSource } from './timeline';
import type { Box, CameraEdit, Edits, Project, Screen } from './types';

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
const screen = project.screen as Screen;
const camOnly: Project = { ...project, screen: null, events: [], pauses: [] };
const cam = (side: CameraEdit['side'] = 'right'): CameraEdit => ({ split: 0.25, side, focusX: 0.5 });
const HD = { width: 1920, height: 1080 };
const VERTICAL = { width: 1080, height: 1920 };
const boxes = (l: Layout) => [l.screen, l.cam].filter((b): b is Box => !!b);
const measure = (t: string, size: number) => t.length * size * 0.5;

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
    const l = computeLayout(HD, HD, null);
    expect(l.screen).toEqual({ x: 0, y: 0, w: 1920, h: 1080 });
    expect(l.cam).toBeNull();
  });
  it('puts the webcam beside the screen, never on top of it', () => {
    for (const side of ['left', 'right'] as const) {
      const l = computeLayout(HD, HD, cam(side));
      const [s, c] = [l.screen!, l.cam!];
      const overlaps = c.x < s.x + s.w && c.x + c.w > s.x;
      expect(overlaps).toBe(false);
      expect(l.width).toBe(1920);
      expect(s.w / s.h).toBeCloseTo(1920 / 1080, 2);
      for (const n of [s.x, s.y, s.w, s.h, c.x, c.y, c.w, c.h]) expect(n % 2).toBe(0);
    }
  });
  it('uses the same margin at the edges and between screen and webcam', () => {
    for (const side of ['left', 'right'] as const) {
      const l = computeLayout(HD, HD, cam(side));
      const [a, b] = side === 'right' ? [l.screen!, l.cam!] : [l.cam!, l.screen!];
      const gaps = [a.x, b.x - (a.x + a.w), l.width - (b.x + b.w)];
      expect(gaps[0]).toBeGreaterThan(0);
      expect(new Set(gaps).size).toBe(1);
    }
  });
  it('stacks the screen and webcam in portrait formats, with equal margins', () => {
    for (const side of ['top', 'bottom'] as const) {
      const l = computeLayout(VERTICAL, HD, cam(side));
      const [a, b] = side === 'bottom' ? [l.screen!, l.cam!] : [l.cam!, l.screen!];
      const gaps = [a.y, b.y - (a.y + a.h), l.height - (b.y + b.h), l.cam!.x, l.width - (l.cam!.x + l.cam!.w)];
      expect(new Set(gaps).size).toBe(1);
      expect(l.screen!.w / l.screen!.h).toBeCloseTo(16 / 9, 1);
      for (const n of boxes(l).flatMap((b) => [b.x, b.y, b.w, b.h])) expect(n % 2).toBe(0);
    }
    // A left/right setting from a landscape format means top/bottom here.
    expect(computeLayout(VERTICAL, HD, cam('right'))).toEqual(computeLayout(VERTICAL, HD, cam('bottom')));
  });
  it('fills the whole frame with the webcam alone, without margin or rounding', () => {
    const l = computeLayout(VERTICAL, null, cam());
    expect(l.cam).toEqual({ x: 0, y: 0, w: 1080, h: 1920 });
    expect(l.screen).toBeNull();
    expect(l.camRadius).toBe(0);
  });
  it('letterboxes the screen alone in another format', () => {
    const l = computeLayout({ width: 1080, height: 1080 }, HD, null);
    expect(l.screen).toEqual({ x: 0, y: 236, w: 1080, h: 608 });
  });
  it('maps desktop coordinates into the scaled screen', () => {
    const l = computeLayout(HD, HD, cam('left'));
    const r = mapRect({ x: 1920 + 960, y: 540, w: 100, h: 0 }, screen, l.screen!);
    expect(r.x).toBeCloseTo(l.screen!.x + l.screen!.w / 2);
    expect(r.w).toBeCloseTo((100 * l.screen!.w) / 1920);
  });
});

describe('formats and views', () => {
  it('sizes the video from the format', () => {
    expect(outputSize('original', screen)).toEqual(HD);
    expect(outputSize('9:16', screen)).toEqual(VERTICAL);
    expect(outputSize('original', null)).toEqual(HD);
  });
  it('offers only the views a recording has', () => {
    expect(viewsFor(project)).toEqual(['both', 'screen', 'cam']);
    expect(viewsFor({ ...project, cam: null })).toEqual(['screen']);
    expect(viewsFor(camOnly)).toEqual(['cam']);
  });
  it('fills in edits saved by older versions', () => {
    const { view: _view, format: _format, ...rest } = defaultEdits(project, 'en');
    const saved = { ...rest, camera: { enabled: false, split: 0.3, side: 'left' as const } } as unknown as Partial<Edits>;
    const e = normalizeEdits(project, saved, 'en');
    expect(e.view).toBe('screen');
    expect(e.format).toBe('original');
    expect(e.camera).toEqual({ split: 0.3, side: 'left', focusX: 0.5 });
    expect(normalizeEdits(camOnly, { format: 'original', view: 'both' }, 'en')).toMatchObject({ view: 'cam', format: '16:9' });
  });
  it('can show only the webcam of a screen recording', () => {
    const l = projectLayout(project, { ...defaultEdits(project, 'en'), view: 'cam', format: '9:16' });
    expect(l.screen).toBeNull();
    expect(l.cam).toEqual({ x: 0, y: 0, w: 1080, h: 1920 });
  });
  it('exports a webcam-only recording without screen, steps or blur', () => {
    const edits = { ...defaultEdits(camOnly, 'en', '9:16'), camera: { ...cam(), focusX: 0.2 } };
    const r = render(camOnly, edits, measure);
    const spec = exportSpec(camOnly, edits, r);
    expect(spec.screenBox).toBeNull();
    expect(spec.blurs).toEqual([]);
    expect(spec.cam).toMatchObject({ box: { x: 0, y: 0, w: 1080, h: 1920 }, video: true, audio: true, focusX: 0.2 });
    expect(r.overlay).toEqual({ labels: [], highlights: [], ripples: [] });
    expect(r.ass).not.toContain('Dialogue:');
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
    const layout = computeLayout(HD, HD, edits.camera);
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
  it('sizes labels by the short side, so vertical videos match landscape ones', () => {
    const edits = defaultEdits(project, 'en');
    const label = (frame: { width: number; height: number }) =>
      overlayItems({
        project,
        layout: computeLayout(frame, HD, null),
        steps: buildSteps(project, edits),
        duration: 18,
        ripple: false,
        highlight: false,
        measure,
      }).labels[0].fontSize;
    expect(label(HD)).toBe(28);
    expect(label(VERTICAL)).toBe(28);
  });
});

describe('area recordings', () => {
  it('labels clicks outside the area but draws no ripple or highlight for them', () => {
    const area: Project = {
      ...project,
      cam: null,
      screen: { ...screen, x: 2000, y: 100, width: 800, height: 600, monitorWidth: 800, monitorHeight: 600, area: true },
      events: [
        { kind: 'step', t: 0, time: 1, action: 'click', role: 'button', name: 'Inside', point: { x: 2100, y: 200 }, rect: { x: 2050, y: 180, w: 100, h: 40 } },
        { kind: 'step', t: 0, time: 4, action: 'click', role: 'button', name: 'Outside', point: { x: 1950, y: 50 }, rect: { x: 1900, y: 30, w: 80, h: 40 } },
      ],
    };
    const size = { width: 800, height: 600 };
    const items = overlayItems({
      project: area,
      layout: computeLayout(size, size, null),
      steps: buildSteps(area, defaultEdits(area, 'en')),
      duration: 10,
      ripple: true,
      highlight: true,
      measure,
    });
    expect(items.labels.map((l) => l.text)).toEqual(["Click 'Inside'", "Click 'Outside'"]);
    expect(items.ripples).toHaveLength(1);
    expect(items.highlights).toHaveLength(1);
    expect(items.ripples[0]).toMatchObject({ x: 100, y: 100 });
  });
});
