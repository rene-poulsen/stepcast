// Messages between the browser extension and the Stepcast app.
// The Rust side stores events as JSON and only reads `kind` and `t`.

/** A rectangle in physical screen pixels (virtual desktop coordinates). */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Point {
  x: number;
  y: number;
}

export type Action =
  | 'click'
  | 'enter'
  | 'check'
  | 'uncheck'
  | 'select'
  | 'upload'
  | 'navigate'
  | 'expand'
  | 'collapse'
  | 'press';

export type Role =
  | 'link'
  | 'button'
  | 'tab'
  | 'menuitem'
  | 'checkbox'
  | 'radio'
  | 'switch'
  | 'option'
  | 'select'
  | 'textbox'
  | 'file'
  | 'accordion'
  | 'page'
  | 'key'
  | 'generic';

/** Something the user did that becomes a label in the video. */
export interface StepEvent {
  kind: 'step';
  /** Unix epoch milliseconds. */
  t: number;
  action: Action;
  role: Role;
  /** Accessible name of the element ("Products", "Username"). Never a typed value. */
  name: string;
  /** Only for <select>: the visible text of the chosen option. */
  value?: string;
  rect?: Rect;
  point?: Point;
}

/** From time `t`, the sensitive areas reported by `source` (one tab/frame) are exactly `rects`. */
export interface BlurEvent {
  kind: 'blur';
  t: number;
  source: string;
  rects: Rect[];
}

export type RecorderEvent = StepEvent | BlurEvent;

export type ExtToApp =
  | { type: 'hello'; browser: string; version: string }
  | { type: 'event'; event: RecorderEvent }
  | { type: 'ping' };

export type AppToExt = { type: 'state'; recording: boolean } | { type: 'pong' };

export const APP_PORT = 47615;
