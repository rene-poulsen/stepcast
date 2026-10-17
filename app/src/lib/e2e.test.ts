// Writes overlay.ass and spec.json for a recording folder, like the editor does before exporting.
// Used by the Rust `export_e2e` test:  STEPCAST_E2E_DIR=<folder> npx vitest run e2e
// Optional: STEPCAST_FORMAT=9:16, STEPCAST_VIEW=both|screen|cam, STEPCAST_ARRANGE=auto|custom|overlay,
// STEPCAST_ZOOM=1, STEPCAST_LANG=da.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'vitest';
import { exportSpec, render } from './exporter';
import type { FormatId } from './formats';
import { normalizeEdits } from './steps';
import type { Arrange, Edits, Project, View } from './types';

const dir = process.env.STEPCAST_E2E_DIR;

describe.runIf(!!dir)('export inputs', () => {
  it('writes overlay.ass and spec.json', () => {
    const project = JSON.parse(readFileSync(join(dir!, 'project.json'), 'utf8')) as Project;
    const env = process.env;
    const saved: Partial<Edits> = { ...project.edits };
    if (env.STEPCAST_FORMAT) saved.format = env.STEPCAST_FORMAT as FormatId;
    if (env.STEPCAST_VIEW) saved.view = env.STEPCAST_VIEW as View;
    const base = normalizeEdits(project, saved, (env.STEPCAST_LANG as 'en' | 'da') ?? 'en');
    if (env.STEPCAST_ARRANGE) base.camera.arrange = env.STEPCAST_ARRANGE as Arrange;
    const edits = { ...base, zoom: env.STEPCAST_ZOOM === '1' || base.zoom };
    const r = render(project, edits, (text, size) => text.length * size * 0.56);
    writeFileSync(join(dir!, 'overlay.ass'), r.ass);
    writeFileSync(join(dir!, 'spec.json'), JSON.stringify(exportSpec(project, edits, r), null, 2));
  });
});
