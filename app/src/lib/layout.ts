import type { Box, CameraEdit, Rect } from './types';

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
}

interface Size {
  width: number;
  height: number;
}

const even = (n: number) => Math.round(n / 2) * 2;

/** Portrait and square videos stack the screen and webcam; landscape ones put them side by side. */
export const isStacked = (frame: Size) => frame.width <= frame.height;

/** The side setting for this frame's orientation: left/right side by side, top/bottom stacked. */
export function camSide(frame: Size, side: CameraEdit['side']): CameraEdit['side'] {
  if (isStacked(frame)) return side === 'left' || side === 'top' ? 'top' : 'bottom';
  return side === 'left' || side === 'top' ? 'left' : 'right';
}

/**
 * Places the screen and the webcam in a frame of the output size.
 * - Only the screen: it fills the frame (letterboxed if the format has another shape).
 * - Only the webcam: it fills the frame, cropped, with no margin or rounding.
 * - Both: side by side (landscape) or stacked (portrait, square), with the same margin
 *   between the edges, the screen and the webcam.
 */
export function computeLayout(frame: Size, screen: Size | null, camera: CameraEdit | null): Layout {
  const W = even(frame.width);
  const H = even(frame.height);
  const camFocus = Math.min(1, Math.max(0, camera?.focusX ?? 0.5));
  const base = { width: W, height: H, camFocus };

  if (!screen) {
    return { ...base, screen: null, cam: camera ? { x: 0, y: 0, w: W, h: H } : null, camRadius: 0 };
  }
  if (!camera) {
    const s = Math.min(W / screen.width, H / screen.height);
    const sw = Math.min(W, even(screen.width * s));
    const sh = Math.min(H, even(screen.height * s));
    return { ...base, screen: { x: even((W - sw) / 2), y: even((H - sh) / 2), w: sw, h: sh }, cam: null, camRadius: 0 };
  }

  const ratio = screen.height / screen.width;
  const margin = even(Math.max(8, Math.min(W, H) * 0.025));
  const side = camSide({ width: W, height: H }, camera.side);
  let box: Box;
  let cam: Box;

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
    box = { x: even((W - sw) / 2), y: screenY, w: sw, h: sh };
    cam = { x: margin, y: camFirst ? margin : margin * 2 + sh, w: W - margin * 2, h: ch };
  } else {
    // [margin] screen [margin] webcam [margin], mirrored for the left side.
    const panel = even(W * Math.min(0.45, Math.max(0.1, camera.split)));
    const areaW = W - panel - margin;
    const sw = even(Math.min(areaW, (H - margin * 2) / ratio));
    const sh = even(sw * ratio);
    const cw = even(panel - margin * 2);
    const ch = even(Math.min(H - margin * 2, (cw * 4) / 3));
    const areaX = side === 'left' ? panel : margin;
    const panelX = side === 'left' ? 0 : W - panel;
    box = { x: areaX + even((areaW - sw) / 2), y: even((H - sh) / 2), w: sw, h: sh };
    cam = { x: panelX + margin, y: even((H - ch) / 2), w: cw, h: ch };
  }
  return { ...base, screen: box, cam, camRadius: Math.round(Math.min(cam.w, cam.h) * 0.06) };
}

/** Maps a rectangle on the physical desktop to output pixels. */
export function mapRect(r: Rect, screen: { x: number; y: number; monitorWidth: number }, box: Box): Rect {
  const s = box.w / screen.monitorWidth;
  return { x: box.x + (r.x - screen.x) * s, y: box.y + (r.y - screen.y) * s, w: r.w * s, h: r.h * s };
}
