import type { BlurEvent, Rect, StepEvent } from '../../../shared/events';

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
  /** Seconds of screen recording. */
  duration: number;
  /** Video size in pixels; x/y and monitor size are physical desktop pixels of the recorded monitor. */
  screen: {
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
  };
  cam: { file: string; mime: string; offset: number; video: boolean; audio: boolean } | null;
  pauses: [number, number][];
  events: (TimedStep | TimedBlur)[];
  edits: Edits | null;
  /** Rebuilt from an interrupted recording. */
  recovered?: boolean;
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
  camera: { enabled: boolean; split: number; side: 'left' | 'right' };
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
