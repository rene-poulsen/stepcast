import type { Box, Rect } from './types';

export const BACKGROUND = 'F4F4F2';

export interface Layout {
  width: number;
  height: number;
  screen: Box;
  cam: Box | null;
  /** Corner radius of the webcam, in output pixels. */
  camRadius: number;
}

const even = (n: number) => Math.round(n / 2) * 2;

/**
 * The video keeps the recorded screen's size. With a webcam, the screen is scaled down
 * to leave a side panel (`split` = panel share of the width) and is centred vertically.
 */
export function computeLayout(
  width: number,
  height: number,
  camera: { enabled: boolean; split: number; side: 'left' | 'right' } | null,
): Layout {
  const W = even(width);
  const H = even(height);
  if (!camera?.enabled) {
    return { width: W, height: H, screen: { x: 0, y: 0, w: W, h: H }, cam: null, camRadius: 0 };
  }
  const panel = even(W * Math.min(0.45, Math.max(0.1, camera.split)));
  const area = W - panel;
  const sw = even(area);
  const sh = even((H * sw) / W);
  const margin = even(Math.max(8, H * 0.025));
  const cw = even(panel - margin * 2);
  const ch = even(Math.min(H - margin * 2, (cw * 4) / 3));

  const screenX = camera.side === 'left' ? panel : 0;
  const panelX = camera.side === 'left' ? 0 : area;
  return {
    width: W,
    height: H,
    screen: { x: screenX, y: even((H - sh) / 2), w: sw, h: sh },
    cam: { x: panelX + margin, y: even((H - ch) / 2), w: cw, h: ch },
    camRadius: Math.round(Math.min(cw, ch) * 0.06),
  };
}

/** Maps a rectangle on the physical desktop to output pixels. */
export function mapRect(r: Rect, screen: { x: number; y: number; monitorWidth: number }, box: Box): Rect {
  const s = box.w / screen.monitorWidth;
  return { x: box.x + (r.x - screen.x) * s, y: box.y + (r.y - screen.y) * s, w: r.w * s, h: r.h * s };
}
