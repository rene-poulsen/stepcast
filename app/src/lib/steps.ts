import { phrase } from './phrases';
import { keepRanges, toOutput, type Range } from './timeline';
import type { FormatId } from './formats';
import type { Edits, Lang, Project, TimedBlur, TimedStep, View } from './types';

export interface Step {
  /** Index in `project.events`; also the key for edits. */
  index: number;
  event: TimedStep;
  /** Seconds in the source recording. */
  time: number;
  /** Seconds in the exported video. */
  out: number;
  auto: string;
  text: string;
  deleted: boolean;
}

/** A page load right after clicking a link repeats the click, so it is left out. */
const NAVIGATE_AFTER_CLICK = 3;

/** What a recording can show: every view needs its video. */
export function viewsFor(project: Project): View[] {
  const cam = !!project.cam?.video;
  if (!project.screen) return cam ? ['cam'] : [];
  return cam ? ['both', 'screen', 'cam'] : ['screen'];
}

export function defaultEdits(project: Project, lang: Lang, format?: FormatId): Edits {
  return {
    lang,
    trim: [0, project.duration],
    steps: {},
    view: viewsFor(project)[0] ?? 'screen',
    format: format ?? (project.screen ? 'original' : '16:9'),
    camera: { arrange: 'auto', custom: null, float: null, split: 0.25, side: 'right', align: 'center', focusX: 0.5 },
    blur: true,
    ripple: true,
    highlight: true,
    zoom: false,
    keyboard: true,
  };
}

/** Saved edits with settings added in newer versions filled in. */
export function normalizeEdits(project: Project, saved: Partial<Edits> & { camera?: { enabled?: boolean } }, lang: Lang, format?: FormatId): Edits {
  const defaults = defaultEdits(project, lang, format);
  const edits: Edits = { ...defaults, ...saved, camera: { ...defaults.camera, ...saved.camera } };
  // Before views, the webcam was a switch.
  if (!saved.view && saved.camera?.enabled === false && project.screen) edits.view = 'screen';
  if (!viewsFor(project).includes(edits.view)) edits.view = defaults.view;
  if (edits.format === 'original' && !project.screen) edits.format = defaults.format;
  delete (edits.camera as { enabled?: boolean }).enabled;
  return edits;
}

export function projectKeeps(project: Project, edits: Edits): Range[] {
  return keepRanges(edits.trim, project.pauses);
}

export function buildSteps(project: Project, edits: Edits): Step[] {
  const keeps = projectKeeps(project, edits);
  const steps: Step[] = [];
  let lastClick = -Infinity;
  project.events.forEach((event, index) => {
    if (event.kind !== 'step') return;
    if (event.action === 'press' && !edits.keyboard) return;
    if (event.action === 'navigate' && event.time - lastClick < NAVIGATE_AFTER_CLICK) return;
    if (event.action !== 'navigate' && event.action !== 'enter') lastClick = event.time;
    const out = toOutput(event.time, keeps);
    if (out === null) return;
    const auto = phrase(event, edits.lang);
    const edit = edits.steps[index] ?? {};
    steps.push({ index, event, time: event.time, out, auto, text: edit.text ?? auto, deleted: edit.deleted ?? false });
  });
  return steps;
}

export interface BlurSegment {
  start: number;
  end: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Turns "from time t, source S shows these rects" events into timed rectangles. */
export function blurSegments(project: Project): BlurSegment[] {
  const open = new Map<string, { since: number; rects: TimedBlur['rects'] }>();
  const out: BlurSegment[] = [];
  if (!project.screen) return [];
  const { x, y, width, monitorWidth } = project.screen;
  const k = width / monitorWidth;
  const close = (source: string, until: number) => {
    const cur = open.get(source);
    if (!cur) return;
    for (const r of cur.rects) {
      out.push({ start: cur.since, end: until, x: Math.round((r.x - x) * k), y: Math.round((r.y - y) * k), w: Math.round(r.w * k), h: Math.round(r.h * k) });
    }
    open.delete(source);
  };
  const blurs = project.events.filter((e): e is TimedBlur => e.kind === 'blur').sort((a, b) => a.time - b.time);
  for (const e of blurs) {
    // Start a little early so a field never shows unblurred for a frame.
    const t = Math.max(0, e.time - 0.1);
    close(e.source, t + 0.2);
    if (e.rects.length) open.set(e.source, { since: t, rects: e.rects });
  }
  for (const source of [...open.keys()]) close(source, project.duration);
  return out.filter((s) => s.end > s.start);
}
