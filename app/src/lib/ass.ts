// Builds the ASS subtitle file that draws labels, click ripples and highlights.
// The same file is burned into the MP4 by ffmpeg (libass) and previewed in the editor (JASSUB).
import { BACKGROUND, mapRect, type Layout } from './layout';
import type { Step } from './steps';
import type { Project, Rect } from './types';
import { mapThroughView, stillUntil, viewAt, type ZoomKey } from './zoom';

export const FONT = 'Inter SemiBold';

/**
 * libass sizes text so ascender + descender equal the font size; CSS uses the em square.
 * For Inter that makes libass text 2048 / 2478 of the CSS size with the same number.
 */
export const ASS_EM = 2048 / 2478;

/** Measures text width in pixels at a given font size. */
export type Measure = (text: string, size: number) => number;

const LABEL_SECONDS = 2.6;
const MIN_LABEL_SECONDS = 0.9;
const RIPPLE_MS = 550;
const HIGHLIGHT_SECONDS = 1.3;
const ACCENT = '2383E2';

/** 'RRGGBB' → ASS '&HBBGGRR&'. */
function color(hex: string): string {
  return `&H${hex.slice(4, 6)}${hex.slice(2, 4)}${hex.slice(0, 2)}&`.toUpperCase();
}

function stamp(seconds: number): string {
  const cs = Math.max(0, Math.round(seconds * 100));
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  const c = cs % 100;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(c).padStart(2, '0')}`;
}

const r1 = (n: number) => Math.round(n * 10) / 10;

/** Rounded rectangle path with its top-left at 0,0. */
export function roundedRect(w: number, h: number, r: number): string {
  const k = r * 0.448; // control-point offset for a quarter circle
  const [W, H, R] = [r1(w), r1(h), r1(Math.min(r, w / 2, h / 2))];
  const K = r1(Math.min(k, R));
  return [
    `m ${R} 0`,
    `l ${r1(W - R)} 0`,
    `b ${r1(W - K)} 0 ${W} ${K} ${W} ${R}`,
    `l ${W} ${r1(H - R)}`,
    `b ${W} ${r1(H - K)} ${r1(W - K)} ${H} ${r1(W - R)} ${H}`,
    `l ${R} ${H}`,
    `b ${K} ${H} 0 ${r1(H - K)} 0 ${r1(H - R)}`,
    `l 0 ${R}`,
    `b 0 ${K} ${K} 0 ${R} 0`,
  ].join(' ');
}

function circle(r: number): string {
  const k = r1(r * 0.552);
  const R = r1(r);
  return `m 0 ${-R} b ${k} ${-R} ${R} ${-k} ${R} 0 b ${R} ${k} ${k} ${R} 0 ${R} b ${-k} ${R} ${-R} ${k} ${-R} 0 b ${-R} ${-k} ${-k} ${-R} 0 ${-R}`;
}

/** The area outside a rounded corner, filled with the background to round the webcam. */
function cornerMask(r: number, flipX: boolean, flipY: boolean): string {
  const k = r * 0.448;
  const p = (x: number, y: number) => `${r1(flipX ? r - x : x)} ${r1(flipY ? r - y : y)}`;
  return `m ${p(0, 0)} l ${p(r, 0)} b ${p(k, 0)} ${p(0, k)} ${p(0, r)}`;
}

function escapeText(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/[{}]/g, '').replace(/\n/g, ' ');
}

export interface AssInput {
  project: Project;
  layout: Layout;
  steps: Step[];
  duration: number;
  ripple: boolean;
  highlight: boolean;
  measure: Measure;
  /** Zoom keyframes; highlights and ripples follow the zoom. */
  zoom?: ZoomKey[];
}

export const LABEL_FADE = { in: 0.14, out: 0.18, rise: 6, riseTime: 0.16 };
export const HIGHLIGHT_FADE = { in: 0.12, out: 0.32 };
export const RIPPLE = { seconds: RIPPLE_MS / 1000, from: 0.25, alpha: 0x70 / 255, accel: 0.6 };
export const PILL_COLOR = '191919';
export const PILL_ALPHA = 0x14 / 255;
export { ACCENT };

export interface Label {
  start: number;
  end: number;
  text: string;
  fontSize: number;
  x: number;
  y: number;
  w: number;
  h: number;
  radius: number;
}

export interface Highlight {
  start: number;
  end: number;
  x: number;
  y: number;
  w: number;
  h: number;
  radius: number;
  border: number;
}

export interface Ripple {
  start: number;
  end: number;
  x: number;
  y: number;
  radius: number;
}

export interface Overlay {
  labels: Label[];
  highlights: Highlight[];
  ripples: Ripple[];
}

const labelFontSize = (height: number) => Math.round(Math.max(16, height * 0.026));

/** Where and when every label, highlight and ripple appears, in output pixels and seconds. */
export function overlayItems({ project, layout, steps, duration, ripple, highlight, measure, zoom = [] }: AssInput): Overlay {
  const { height: H, screen: box } = layout;
  const fontSize = labelFontSize(H);
  const padX = Math.round(fontSize * 0.85);
  const padY = Math.round(fontSize * 0.55);
  const pillH = fontSize + padY * 2;
  const bottom = box.y + box.h - Math.round(H * 0.045);
  const out: Overlay = { labels: [], highlights: [], ripples: [] };

  const visible = steps.filter((s) => !s.deleted && s.text.trim());
  visible.forEach((step, i) => {
    const start = step.out;
    const next = visible[i + 1]?.out ?? Infinity;
    const end = Math.min(duration, Math.max(start + MIN_LABEL_SECONDS, Math.min(start + LABEL_SECONDS, next - 0.05)));
    if (end <= start) return;

    // Label: dark pill, bottom centre of the screen area.
    const text = step.text.trim().replace(/\s+/g, ' ');
    const w = Math.min(box.w - padX * 2, Math.ceil(measure(text, fontSize * ASS_EM)) + padX * 2);
    out.labels.push({
      start,
      end,
      text,
      fontSize,
      x: Math.round(box.x + (box.w - w) / 2),
      y: bottom - pillH,
      w,
      h: pillH,
      radius: pillH * 0.32,
    });

    const e = step.event;
    // Where something on screen ends up in the video at this moment, taking the zoom into account.
    const view = viewAt(zoom, start, project.screen.width, project.screen.height);
    const place = (r: Rect) => (zoom.length ? mapThroughView(r, project, view, box) : mapRect(r, project.screen, box));
    const until = Math.min(duration, zoom.length ? stillUntil(zoom, start) : Infinity);
    const inside = (r: Rect) => r.x + r.w > box.x && r.x < box.x + box.w && r.y + r.h > box.y && r.y < box.y + box.h;
    if (highlight && e.rect && e.action !== 'navigate' && inside(place(e.rect))) {
      const r = place(e.rect);
      const pad = Math.max(3, H * 0.004);
      out.highlights.push({
        start,
        end: Math.min(until, start + HIGHLIGHT_SECONDS),
        x: r.x - pad,
        y: r.y - pad,
        w: r.w + pad * 2,
        h: r.h + pad * 2,
        radius: Math.max(6, H * 0.006),
        border: Math.max(2, Math.round(H * 0.0025)),
      });
    }
    const point = e.point && place({ x: e.point.x, y: e.point.y, w: 0, h: 0 });
    if (ripple && point && inside({ ...point, w: 1, h: 1 })) {
      const p = point;
      out.ripples.push({ start, end: Math.min(until, start + RIPPLE.seconds), x: p.x, y: p.y, radius: Math.max(14, H * 0.024) });
    }
  });
  return out;
}

export function buildAss(input: AssInput): string {
  const { layout, duration } = input;
  const { width: W, height: H } = layout;
  const items = overlayItems(input);
  const fontSize = labelFontSize(H);
  const lines: string[] = [];
  const dialogue = (layer: number, start: number, end: number, text: string) =>
    lines.push(`Dialogue: ${layer},${stamp(start)},${stamp(end)},Base,,0,0,0,,${text}`);
  const ms = (s: number) => Math.round(s * 1000);
  const labelFade = `\\fad(${ms(LABEL_FADE.in)},${ms(LABEL_FADE.out)})`;

  for (const l of items.labels) {
    const rise = `0,${ms(LABEL_FADE.riseTime)}`;
    dialogue(
      10,
      l.start,
      l.end,
      `{\\an7\\move(${l.x},${l.y + LABEL_FADE.rise},${l.x},${l.y},${rise})${labelFade}\\bord0\\shad0\\1c${color(PILL_COLOR)}\\1a&H14&\\p1}${roundedRect(l.w, l.h, l.radius)}{\\p0}`,
    );
    const cx = Math.round(l.x + l.w / 2);
    const cy = l.y + l.h / 2;
    dialogue(
      11,
      l.start,
      l.end,
      `{\\an5\\move(${cx},${cy + LABEL_FADE.rise},${cx},${cy},${rise})${labelFade}\\fs${l.fontSize}\\1c&HFFFFFF&\\bord0\\shad0}${escapeText(l.text)}`,
    );
  }
  for (const h of items.highlights) {
    dialogue(
      5,
      h.start,
      h.end,
      `{\\an7\\pos(${r1(h.x)},${r1(h.y)})\\fad(${ms(HIGHLIGHT_FADE.in)},${ms(HIGHLIGHT_FADE.out)})\\1a&HFF&\\3c${color(ACCENT)}\\3a&H10&\\bord${h.border}\\shad0\\p1}${roundedRect(h.w, h.h, h.radius)}{\\p0}`,
    );
  }
  for (const r of items.ripples) {
    dialogue(
      6,
      r.start,
      r.end,
      `{\\an5\\pos(${r1(r.x)},${r1(r.y)})\\fscx25\\fscy25\\1c${color(ACCENT)}\\1a&H70&\\bord0\\shad0\\t(0,${RIPPLE_MS},${RIPPLE.accel},\\fscx100\\fscy100\\1a&HFF&)\\p1}${circle(r.radius)}{\\p0}`,
    );
  }

  if (layout.cam && layout.camRadius > 0) {
    const { x, y, w, h } = layout.cam;
    const r = layout.camRadius;
    const corners: [number, number, boolean, boolean][] = [
      [x, y, false, false],
      [x + w - r, y, true, false],
      [x, y + h - r, false, true],
      [x + w - r, y + h - r, true, true],
    ];
    for (const [cx, cy, fx, fy] of corners) {
      dialogue(1, 0, duration, `{\\an7\\pos(${cx},${cy})\\1c${color(BACKGROUND)}\\bord0\\shad0\\p1}${cornerMask(r, fx, fy)}{\\p0}`);
    }
  }

  return [
    '[Script Info]',
    'Title: Stepcast overlay',
    'ScriptType: v4.00+',
    'WrapStyle: 2',
    'ScaledBorderAndShadow: yes',
    `PlayResX: ${W}`,
    `PlayResY: ${H}`,
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Base,${FONT},${fontSize},&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    ...lines,
    '',
  ].join('\n');
}
