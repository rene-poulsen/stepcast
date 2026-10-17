import { describe, expect, it } from 'vitest';
import { buildSteps, defaultEdits } from './steps';
import type { Project } from './types';
import { mapThroughView, stillUntil, viewAt, ZOOM, zoomExpressions, zoomTrack } from './zoom';

const project: Project = {
  version: 1,
  title: '',
  createdAt: '',
  duration: 30,
  screen: { file: 'screen.mp4', width: 1920, height: 1080, x: 0, y: 0, monitorWidth: 1920, monitorHeight: 1080, scale: 1 },
  cam: null,
  pauses: [],
  events: [
    { kind: 'step', t: 0, time: 2, action: 'click', role: 'link', name: 'A', point: { x: 100, y: 100 } },
    { kind: 'step', t: 0, time: 3.5, action: 'click', role: 'button', name: 'B', point: { x: 1000, y: 600 } },
    { kind: 'step', t: 0, time: 4, action: 'press', role: 'key', name: 'Ctrl+S' },
    { kind: 'step', t: 0, time: 15, action: 'enter', role: 'textbox', name: 'C', rect: { x: 900, y: 500, w: 200, h: 40 } },
    { kind: 'step', t: 0, time: 20, action: 'navigate', role: 'page', name: 'Page' },
  ],
  edits: null,
};

const steps = buildSteps(project, defaultEdits(project, 'en'));
const keys = zoomTrack(project, steps);
const W = 1920;
const H = 1080;

/** Evaluates an ffmpeg expression with the few functions zoomExpressions uses. */
function evalFfmpeg(expr: string, t: number, zoom = 1, iw = W, ih = H): number {
  const js = expr.replace(/\bif\(/g, 'I(').replace(/\blt\(/g, 'L(').replace(/\bmax\(/g, 'Math.max(').replace(/\bmin\(/g, 'Math.min(');
  const I = (c: number, a: number, b: number) => (c ? a : b);
  const L = (a: number, b: number) => (a < b ? 1 : 0);
  return new Function('it', 'zoom', 'iw', 'ih', 'I', 'L', `return ${js};`)(t, zoom, iw, ih, I, L);
}

describe('zoom track', () => {
  it('zooms in on a click, pans to a nearby click and zooms out after the last', () => {
    expect(viewAt(keys, 0, W, H).z).toBe(1);
    expect(viewAt(keys, 2, W, H).z).toBeCloseTo(ZOOM);
    // A at (100,100) is near the corner, so the view is clamped to the top-left.
    expect(viewAt(keys, 2, W, H)).toMatchObject({ x: 0, y: 0 });
    // B is 1.5 s later: still zoomed in, now centred on B.
    const b = viewAt(keys, 3.5, W, H);
    expect(b.z).toBeCloseTo(ZOOM);
    expect(b.x + W / ZOOM / 2).toBeCloseTo(1000);
    expect(viewAt(keys, 8, W, H).z).toBe(1);
    // C is a separate zoom; key presses and page loads don't zoom.
    expect(viewAt(keys, 15, W, H).z).toBeCloseTo(ZOOM);
    expect(viewAt(keys, 20, W, H).z).toBe(1);
  });

  it('gives the same values in the ffmpeg expression as in the preview', () => {
    const e = zoomExpressions(keys)!;
    for (const t of [0, 1.5, 1.7, 2, 3.2, 3.5, 5.4, 5.8, 6.3, 14.6, 15, 17.5, 30]) {
      const v = viewAt(keys, t, W, H);
      const z = evalFfmpeg(e.z, t);
      expect(z).toBeCloseTo(v.z, 3);
      expect(evalFfmpeg(e.x, t, z)).toBeCloseTo(v.x, 1);
      expect(evalFfmpeg(e.y, t, z)).toBeCloseTo(v.y, 1);
    }
  });

  it('maps clicked elements through the zoom', () => {
    const view = viewAt(keys, 15, W, H);
    const box = { x: 0, y: 0, w: W, h: H };
    const r = mapThroughView({ x: 900, y: 500, w: 200, h: 40 }, project, view, box);
    // The field is centred, so its centre stays at the middle of the screen, 1.8× larger.
    expect(r.x + r.w / 2).toBeCloseTo(W / 2, 0);
    expect(r.w).toBeCloseTo(200 * ZOOM);
  });

  it('knows when the view starts moving again', () => {
    expect(stillUntil(keys, 15)).toBeCloseTo(16.8);
  });

  it('has no keys without clicks', () => {
    expect(zoomTrack(project, [])).toEqual([]);
    expect(zoomExpressions([])).toBeNull();
  });
});
