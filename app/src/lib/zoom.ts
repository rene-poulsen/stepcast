// "Zoom to clicks": the screen zooms in on each click and zooms out again after a pause.
// The same keyframes drive the export (an ffmpeg zoompan expression) and the editor preview.
import type { Step } from './steps';
import type { Project, Rect } from './types';

export const ZOOM = 1.8;
const ZOOM_IN = 0.6;
const ZOOM_OUT = 0.7;
const PAN = 0.5;
const HOLD = 1.8;
/** Clicks closer together than this pan from one to the next instead of zooming out in between. */
const GROUP_GAP = ZOOM_IN + HOLD + ZOOM_OUT;

/** At output time `t`, zoom `z` centred on (cx, cy) in screen-video pixels. */
export interface ZoomKey {
  t: number;
  z: number;
  cx: number;
  cy: number;
}

/** The visible part of the screen video: top-left corner and zoom. */
export interface View {
  z: number;
  x: number;
  y: number;
}

const ACTIONS_THAT_ZOOM = new Set(['click', 'enter', 'check', 'uncheck', 'select', 'upload', 'expand', 'collapse']);

/** Desktop pixels → screen-video pixels. */
function toVideo(project: Project, x: number, y: number): { x: number; y: number } {
  const k = project.screen.width / project.screen.monitorWidth;
  return { x: (x - project.screen.x) * k, y: (y - project.screen.y) * k };
}

export function zoomTrack(project: Project, steps: Step[]): ZoomKey[] {
  const { width: W, height: H } = project.screen;
  const clamp = (v: number, size: number, z: number) => Math.min(Math.max(v, size / (2 * z)), size - size / (2 * z));
  const home = { cx: W / 2, cy: H / 2 };

  const targets = steps
    .filter((s) => !s.deleted && ACTIONS_THAT_ZOOM.has(s.event.action) && (s.event.point || s.event.rect))
    .map((s) => {
      const e = s.event;
      const p = e.point ?? { x: e.rect!.x + e.rect!.w / 2, y: e.rect!.y + e.rect!.h / 2 };
      const v = toVideo(project, p.x, p.y);
      return { t: s.out, x: v.x, y: v.y, cx: clamp(v.x, W, ZOOM), cy: clamp(v.y, H, ZOOM) };
    })
    // Clicks outside the recorded area (when recording an area) don't zoom.
    .filter((p) => p.x >= 0 && p.y >= 0 && p.x <= W && p.y <= H);

  const keys: ZoomKey[] = [];
  const push = (k: ZoomKey) => {
    const last = keys[keys.length - 1];
    keys.push({ ...k, t: Math.max(k.t, last?.t ?? 0) });
  };
  targets.forEach((target, i) => {
    const prev = targets[i - 1];
    if (!prev || target.t - prev.t > GROUP_GAP) {
      push({ t: target.t - ZOOM_IN, z: 1, ...home });
    } else {
      const last = keys[keys.length - 1];
      push({ t: target.t - PAN, z: ZOOM, cx: last.cx, cy: last.cy });
    }
    push({ t: target.t, z: ZOOM, cx: target.cx, cy: target.cy });
    const next = targets[i + 1];
    if (!next || next.t - target.t > GROUP_GAP) {
      push({ t: target.t + HOLD, z: ZOOM, cx: target.cx, cy: target.cy });
      push({ t: target.t + HOLD + ZOOM_OUT, z: 1, ...home });
    }
  });
  return keys;
}

const smooth = (p: number) => p * p * (3 - 2 * p);

function valueAt(keys: ZoomKey[], t: number, prop: 'z' | 'cx' | 'cy'): number | null {
  if (!keys.length) return null;
  if (t <= keys[0].t) return keys[0][prop];
  for (let i = 1; i < keys.length; i++) {
    const a = keys[i - 1];
    const b = keys[i];
    if (t < b.t) {
      const span = b.t - a.t;
      return span < 1e-3 ? b[prop] : a[prop] + (b[prop] - a[prop]) * smooth((t - a.t) / span);
    }
  }
  return keys[keys.length - 1][prop];
}

export function viewAt(keys: ZoomKey[], t: number, width: number, height: number): View {
  const z = valueAt(keys, t, 'z') ?? 1;
  const cx = valueAt(keys, t, 'cx') ?? width / 2;
  const cy = valueAt(keys, t, 'cy') ?? height / 2;
  return {
    z,
    x: Math.min(Math.max(0, cx - width / z / 2), width - width / z),
    y: Math.min(Math.max(0, cy - height / z / 2), height - height / z),
  };
}

/** When the view next starts to move after `t`, so effects drawn for a still view can end there. */
export function stillUntil(keys: ZoomKey[], t: number): number {
  for (let i = 1; i < keys.length; i++) {
    const a = keys[i - 1];
    const b = keys[i];
    const moves = a.z !== b.z || a.cx !== b.cx || a.cy !== b.cy;
    if (moves && a.t > t + 0.01) return a.t;
  }
  return Infinity;
}

/** Desktop rectangle → output pixels, through the zoom view and into the screen box. */
export function mapThroughView(
  r: Rect,
  project: Project,
  view: View,
  box: { x: number; y: number; w: number; h: number },
): Rect {
  const p = toVideo(project, r.x, r.y);
  const k = project.screen.width / project.screen.monitorWidth;
  const s = (box.w / project.screen.width) * view.z;
  return { x: box.x + (p.x - view.x) * s, y: box.y + (p.y - view.y) * s, w: r.w * k * s, h: r.h * k * s };
}

const num = (n: number) => `(${Number(n.toFixed(3))})`;

/** The same curve as `valueAt`, as an ffmpeg expression of the input time `it`. */
function expression(keys: ZoomKey[], prop: 'z' | 'cx' | 'cy'): string {
  let e = num(keys[keys.length - 1][prop]);
  for (let i = keys.length - 1; i > 0; i--) {
    const a = keys[i - 1];
    const b = keys[i];
    const span = b.t - a.t;
    if (span < 1e-3) continue;
    let seg: string;
    if (a[prop] === b[prop]) seg = num(a[prop]);
    else {
      const p = `((it-${num(a.t)})/${num(span)})`;
      seg = `${num(a[prop])}+${num(b[prop] - a[prop])}*${p}*${p}*(3-2*${p})`;
    }
    e = `if(lt(it,${num(b.t)}),${seg},${e})`;
  }
  return `if(lt(it,${num(keys[0].t)}),${num(keys[0][prop])},${e})`;
}

/** zoompan expressions for the export, or null when there is nothing to zoom. */
export function zoomExpressions(keys: ZoomKey[]): { z: string; x: string; y: string } | null {
  if (!keys.length) return null;
  return {
    z: expression(keys, 'z'),
    x: `max(0,min(iw-iw/zoom,${expression(keys, 'cx')}-iw/zoom/2))`,
    y: `max(0,min(ih-ih/zoom,${expression(keys, 'cy')}-ih/zoom/2))`,
  };
}
