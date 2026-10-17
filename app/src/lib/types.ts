import type { BlurEvent, Rect, StepEvent } from '../../../shared/events';
import type { FormatId } from './formats';

export type Lang = 'en' | 'da';

export type TimedStep = StepEvent & { time: number };
export type TimedBlur = BlurEvent & { time: number };

export interface Monitor {
  index: number;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  scale: number;
  primary: boolean;
}

/** Part of a monitor, in physical pixels from its top-left corner. */
export interface Area {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface WindowRect extends Area {
  title: string;
}

export interface Project {
  version: 1;
  title: string;
  createdAt: string;
  /** Seconds of recording (from the first screen frame, or the start of a webcam-only recording). */
  duration: number;
  /** Null when only the webcam was recorded. */
  screen: Screen | null;
  /** `offset`: seconds from the recording's start to the camera file's start (usually negative). */
  cam: { file: string; mime: string; offset: number; video: boolean; audio: boolean } | null;
  pauses: [number, number][];
  events: (TimedStep | TimedBlur)[];
  edits: Edits | null;
  /** Rebuilt from an interrupted recording. */
  recovered?: boolean;
}

/** Video size in pixels; x/y and monitor size are physical desktop pixels of the recorded monitor. */
export interface Screen {
  file: string;
  width: number;
  height: number;
  x: number;
  y: number;
  monitorWidth: number;
  monitorHeight: number;
  scale: number;
  /** Only an area of the monitor was recorded. */
  area?: boolean;
}

/** What the video shows: screen and webcam, only the screen, or only the webcam. */
export type View = 'both' | 'screen' | 'cam';

/**
 * How the screen and webcam are placed: `auto` side by side or stacked with margins, `custom` both
 * placed by hand, `overlay` the screen fills the frame and the webcam floats on top.
 */
export type Arrange = 'auto' | 'custom' | 'overlay';

/** A box in fractions of the output frame, so it carries over between formats. */
export interface FracBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CameraEdit {
  arrange: Arrange;
  /** Hand-placed boxes for `custom`; null until the user moves something (it starts from `auto`). */
  custom: { screen: FracBox; cam: FracBox } | null;
  /** The floating webcam for `overlay`; null for the default bottom corner. */
  float: FracBox | null;
  /** Share of the width taken by the webcam panel (side-by-side layouts). */
  split: number;
  /** Where the webcam goes; left/right in landscape formats, top/bottom in portrait ones. */
  side: 'left' | 'right' | 'top' | 'bottom';
  /** Side by side: the webcam centred in the frame, or lined up with the top or bottom of the screen. */
  align: 'center' | 'top' | 'bottom';
  /** Which part of the webcam image shows when it is cropped: 0 = left edge, 1 = right edge. */
  focusX: number;
}

export interface StepEdit {
  text?: string;
  deleted?: boolean;
}

export interface Edits {
  lang: Lang;
  /** Source seconds to keep: [start, end]. */
  trim: [number, number];
  /** Keyed by the event's index in `project.events`. */
  steps: Record<number, StepEdit>;
  view: View;
  format: FormatId;
  camera: CameraEdit;
  blur: boolean;
  ripple: boolean;
  highlight: boolean;
  /** Zoom in on each click. Off unless the user turns it on. */
  zoom: boolean;
  /** Labels for Enter, Esc and shortcuts like Ctrl+S. */
  keyboard: boolean;
}

export interface ProjectSummary {
  dir: string;
  title: string;
  createdAt: string;
  duration: number;
  steps: number;
  thumb: string | null;
  exported: boolean;
  recovered: boolean;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type { Rect };
