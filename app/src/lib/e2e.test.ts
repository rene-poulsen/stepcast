// Writes overlay.ass and spec.json for a recording folder, like the editor does before exporting.
// Used by the Rust `export_e2e` test:  STEPCAST_E2E_DIR=<folder> npx vitest run e2e
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'vitest';
import { exportSpec, render } from './exporter';
import { defaultEdits } from './steps';
import type { Project } from './types';

const dir = process.env.STEPCAST_E2E_DIR;

describe.runIf(!!dir)('export inputs', () => {
  it('writes overlay.ass and spec.json', () => {
    const project = JSON.parse(readFileSync(join(dir!, 'project.json'), 'utf8')) as Project;
    const base = { ...defaultEdits(project, (process.env.STEPCAST_LANG as 'en' | 'da') ?? 'en'), ...project.edits };
    const edits = { ...base, zoom: process.env.STEPCAST_ZOOM === '1' || base.zoom };
    const r = render(project, edits, (text, size) => text.length * size * 0.56);
    writeFileSync(join(dir!, 'overlay.ass'), r.ass);
    writeFileSync(join(dir!, 'spec.json'), JSON.stringify(exportSpec(project, edits, r), null, 2));
  });
});
