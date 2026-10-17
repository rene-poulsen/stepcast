// Turns a project + edits into the overlay and the spec the Rust export runs.
import type { ExportSpec } from './api';
import { buildAss, overlayItems, type AssInput, type Measure, type Overlay } from './ass';
import { BACKGROUND, computeLayout, type Layout } from './layout';
import { blurSegments, buildSteps, projectKeeps, type Step } from './steps';
import { outputDuration, type Range } from './timeline';
import type { Edits, Project } from './types';
import { zoomExpressions, zoomTrack, type ZoomKey } from './zoom';

export interface Render {
  layout: Layout;
  keeps: Range[];
  duration: number;
  steps: Step[];
  overlay: Overlay;
  ass: string;
  /** Empty when zoom is off. */
  zoom: ZoomKey[];
}

export function projectLayout(project: Project, edits: Edits): Layout {
  return computeLayout(project.screen.width, project.screen.height, project.cam?.video ? edits.camera : null);
}

export function render(project: Project, edits: Edits, measure: Measure): Render {
  const layout = projectLayout(project, edits);
  const keeps = projectKeeps(project, edits);
  const duration = outputDuration(keeps);
  const steps = buildSteps(project, edits);
  const zoom = edits.zoom ? zoomTrack(project, steps) : [];
  const input: AssInput = { project, layout, steps, duration, ripple: edits.ripple, highlight: edits.highlight, measure, zoom };
  return { layout, keeps, duration, steps, zoom, overlay: overlayItems(input), ass: buildAss(input) };
}

export function exportSpec(project: Project, edits: Edits, r: Render): ExportSpec {
  const cam = project.cam;
  const useCam = cam && (r.layout.cam || cam.audio);
  return {
    width: r.layout.width,
    height: r.layout.height,
    srcWidth: project.screen.width,
    srcHeight: project.screen.height,
    keeps: r.keeps,
    blurs: edits.blur ? blurSegments(project) : [],
    screenBox: r.layout.screen,
    cam: useCam
      ? { box: r.layout.cam ?? { x: 0, y: 0, w: 2, h: 2 }, offset: cam.offset, video: !!r.layout.cam, audio: cam.audio }
      : null,
    background: BACKGROUND,
    duration: r.duration,
    zoom: zoomExpressions(r.zoom),
  };
}

/** A file name from the title: "Reset your password" → "Reset your password.mp4". */
export function fileName(title: string, fallback: string, ext: string): string {
  const clean = title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 80);
  return `${clean || fallback}.${ext}`;
}
