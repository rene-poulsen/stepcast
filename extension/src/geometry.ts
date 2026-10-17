// Converts page coordinates (CSS pixels in this frame's viewport) to physical screen pixels.
import type { Point, Rect } from '../../shared/events';

interface Sample {
  screenX: number;
  screenY: number;
  clientX: number;
  clientY: number;
}

let lastSample: Sample | null = null;
let zoom = 1;

export function setZoom(value: number): void {
  zoom = value > 0 ? value : 1;
}

/** Any mouse event gives the exact viewport origin (also inside iframes). */
export function sampleMouse(e: MouseEvent): void {
  lastSample = { screenX: e.screenX, screenY: e.screenY, clientX: e.clientX, clientY: e.clientY };
}

/** Top-left of this frame's viewport in screen DIPs. */
function viewportOrigin(): { x: number; y: number } {
  if (lastSample) {
    return { x: lastSample.screenX - lastSample.clientX * zoom, y: lastSample.screenY - lastSample.clientY * zoom };
  }
  // No mouse event yet: estimate from the window frame (assumes equal side and bottom borders).
  const border = Math.max(0, (window.outerWidth - window.innerWidth * zoom) / 2);
  return {
    x: window.screenX + border,
    y: window.screenY + window.outerHeight - window.innerHeight * zoom - border,
  };
}

function screenScale(): number {
  return (window.devicePixelRatio || 1) / zoom;
}

export function toScreenPoint(clientX: number, clientY: number): Point {
  const o = viewportOrigin();
  const s = screenScale();
  return { x: Math.round((o.x + clientX * zoom) * s), y: Math.round((o.y + clientY * zoom) * s) };
}

export function toScreenRect(r: DOMRect | { left: number; top: number; width: number; height: number }): Rect {
  const tl = toScreenPoint(r.left, r.top);
  const s = (window.devicePixelRatio || 1);
  return { x: tl.x, y: tl.y, w: Math.round(r.width * s), h: Math.round(r.height * s) };
}

/** The part of the element's box that is inside the viewport, or null if none is. */
export function visibleRect(el: Element): DOMRect | null {
  const r = el.getBoundingClientRect();
  const left = Math.max(0, r.left);
  const top = Math.max(0, r.top);
  const right = Math.min(window.innerWidth, r.right);
  const bottom = Math.min(window.innerHeight, r.bottom);
  if (right - left < 1 || bottom - top < 1) return null;
  return new DOMRect(left, top, right - left, bottom - top);
}
