import type { Box, CameraEdit, FracBox, Rect } from './types';

export const BACKGROUND = 'F4F4F2';

export interface Layout {
  width: number;
  height: number;
  /** Null when the screen isn't shown. */
  screen: Box | null;
  cam: Box | null;
  /** Corner radius of the webcam, in output pixels. */
  camRadius: number;
  /** Which part of the webcam image shows when it is cropped to its box: 0 = left, 1 = right. */
  camFocus: number;
  /**
   * The webcam may sit on top of the screen (custom and overlay layouts), so its corners are cut
   * out of the webcam itself instead of painted over with the background.
   */
  camFloat: boolean;
}

interface Size {
  width: number;
  height: number;
}

const even = (n: number) => Math.round(n / 2) * 2;
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/** Portrait and square videos stack the screen and webcam; landscape ones put them side by side. */
export const isStacked = (frame: Size) => frame.width <= frame.height;

/** The side setting for this frame's orientation: left/right side by side, top/bottom stacked. */
export function camSide(frame: Size, side: CameraEdit['side']): CameraEdit['side'] {
  if (isStacked(frame)) return side === 'left' || side === 'top' ? 'top' : 'bottom';
  return side === 'left' || side === 'top' ? 'left' : 'right';
}

/** The gap between the edges, the screen and the webcam. */
export const layoutMargin = (frame: Size) => even(Math.max(8, Math.min(frame.width, frame.height) * 0.025));

/** The smallest a hand-sized webcam can get. */
export const minCamSide = (frame: Size) => even(Math.min(frame.width, frame.height) * 0.1);

/** The smallest a hand-sized screen can get, as its width. */
export const minScreenWidth = (frame: Size) => even(frame.width * 0.2);

const camRadius = (cam: Box) => Math.round(Math.min(cam.w, cam.h) * 0.06);

/** The screen as large as it fits, centred: it touches two of the edges. */
function fitScreen(W: number, H: number, screen: Size): Box {
  const s = Math.min(W / screen.width, H / screen.height);
  const sw = Math.min(W, even(screen.width * s));
  const sh = Math.min(H, even(screen.height * s));
  return { x: even((W - sw) / 2), y: even((H - sh) / 2), w: sw, h: sh };
}

/** The default floating webcam: bottom right, a margin from the edges. */
export function defaultFloat(frame: Size): FracBox {
  const { width: W, height: H } = frame;
  const m = layoutMargin(frame);
  const w = even(Math.max(W * 0.2, Math.min(W, H) * 0.32));
  const h = even((w * 3) / 4);
  return toFrac({ x: W - m - w, y: H - m - h, w, h }, frame);
}

export function toFrac(box: Box, frame: Size): FracBox {
  return { x: box.x / frame.width, y: box.y / frame.height, w: box.w / frame.width, h: box.h / frame.height };
}

/** A hand-placed webcam in output pixels, kept inside the frame. */
function placeCam(f: FracBox, W: number, H: number): Box {
  const min = minCamSide({ width: W, height: H });
  const w = clamp(even(f.w * W), min, W);
  const h = clamp(even(f.h * H), min, H);
  return { x: clamp(even(f.x * W), 0, W - w), y: clamp(even(f.y * H), 0, H - h), w, h };
}

/** A hand-placed screen in output pixels: its width is kept, its height follows the recording's shape. */
function placeScreen(f: FracBox, ratio: number, W: number, H: number): Box {
  let w = clamp(even(f.w * W), minScreenWidth({ width: W, height: H }), W);
  let h = even(w * ratio);
  if (h > H) {
    h = H;
    w = even(h / ratio);
  }
  return { x: clamp(even(f.x * W), 0, W - w), y: clamp(even(f.y * H), 0, H - h), w, h };
}

/** Side by side (landscape) or stacked (portrait, square), with the same margin everywhere. */
function autoBoxes(W: number, H: number, screen: Size, camera: CameraEdit): { screen: Box; cam: Box } {
  const ratio = screen.height / screen.width;
  const margin = layoutMargin({ width: W, height: H });
  const side = camSide({ width: W, height: H }, camera.side);

  if (isStacked({ width: W, height: H })) {
    // [margin] screen [margin] webcam [margin], or the webcam first; the webcam takes the rest.
    const inner = H - margin * 3;
    let sw = W - margin * 2;
    let sh = even(sw * ratio);
    if (sh > inner * 0.6) {
      sh = even(inner * 0.6);
      sw = even(sh / ratio);
    }
    const ch = inner - sh;
    const camFirst = side === 'top';
    const screenY = camFirst ? margin * 2 + ch : margin;
    return {
      screen: { x: even((W - sw) / 2), y: screenY, w: sw, h: sh },
      cam: { x: margin, y: camFirst ? margin : margin * 2 + sh, w: W - margin * 2, h: ch },
    };
  }
  // [margin] screen [margin] webcam [margin], mirrored for the left side.
  const panel = even(W * Math.min(0.45, Math.max(0.1, camera.split)));
  const areaW = W - panel - margin;
  const sw = even(Math.min(areaW, (H - margin * 2) / ratio));
  const sh = even(sw * ratio);
  const cw = even(panel - margin * 2);
  const ch = even(Math.min(H - margin * 2, (cw * 4) / 3));
  const areaX = side === 'left' ? panel : margin;
  const panelX = side === 'left' ? 0 : W - panel;
  const sy = even((H - sh) / 2);
  // Lined up with the screen's top or bottom edge, but never past the margin.
  const align = camera.align ?? 'center';
  const cy = align === 'top' ? sy : align === 'bottom' ? sy + sh - ch : even((H - ch) / 2);
  return {
    screen: { x: areaX + even((areaW - sw) / 2), y: sy, w: sw, h: sh },
    cam: { x: panelX + margin, y: clamp(cy, margin, H - margin - ch), w: cw, h: ch },
  };
}

/**
 * Places the screen and the webcam in a frame of the output size.
 * - Only the screen: it fills the frame (letterboxed if the format has another shape).
 * - Only the webcam: it fills the frame, cropped, with no margin or rounding.
 * - Both, `auto`: side by side (landscape) or stacked (portrait, square), with the same margin
 *   between the edges, the screen and the webcam.
 * - Both, `custom`: where the user put them (the `auto` boxes until they move one).
 * - Both, `overlay`: the screen fills the frame with no margin and the webcam floats on top.
 */
export function computeLayout(frame: Size, screen: Size | null, camera: CameraEdit | null): Layout {
  const W = even(frame.width);
  const H = even(frame.height);
  const camFocus = Math.min(1, Math.max(0, camera?.focusX ?? 0.5));
  const base = { width: W, height: H, camFocus, camFloat: false };

  if (!screen) {
    return { ...base, screen: null, cam: camera ? { x: 0, y: 0, w: W, h: H } : null, camRadius: 0 };
  }
  if (!camera) {
    return { ...base, screen: fitScreen(W, H, screen), cam: null, camRadius: 0 };
  }

  const arrange = camera.arrange ?? 'auto';
  if (arrange === 'overlay') {
    const cam = placeCam(camera.float ?? defaultFloat({ width: W, height: H }), W, H);
    return { ...base, screen: fitScreen(W, H, screen), cam, camRadius: camRadius(cam), camFloat: true };
  }
  if (arrange === 'custom' && camera.custom) {
    const box = placeScreen(camera.custom.screen, screen.height / screen.width, W, H);
    const cam = placeCam(camera.custom.cam, W, H);
    return { ...base, screen: box, cam, camRadius: camRadius(cam), camFloat: true };
  }
  const { screen: box, cam } = autoBoxes(W, H, screen, camera);
  return { ...base, screen: box, cam, camRadius: camRadius(cam), camFloat: arrange === 'custom' };
}

/**
 * The line a dragged edge or centre snaps to, if one is within `threshold`:
 * the frame edges, a margin in from them, or the middle.
 */
export function snapTo(value: number, size: number, margin: number, threshold: number): number | null {
  let best: number | null = null;
  for (const line of [0, margin, size / 2, size - margin, size]) {
    if (Math.abs(value - line) <= threshold && (best === null || Math.abs(value - line) < Math.abs(value - best))) best = line;
  }
  return best;
}

/** Maps a rectangle on the physical desktop to output pixels. */
export function mapRect(r: Rect, screen: { x: number; y: number; monitorWidth: number }, box: Box): Rect {
  const s = box.w / screen.monitorWidth;
  return { x: box.x + (r.x - screen.x) * s, y: box.y + (r.y - screen.y) * s, w: r.w * s, h: r.h * s };
}
