// Bundles the extension into dist/chrome. `node build.mjs --watch` rebuilds on change.
import { build, context } from 'esbuild';
import { cpSync, mkdirSync, rmSync } from 'node:fs';

const out = 'dist/chrome';
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync('manifest.json', `${out}/manifest.json`);
cpSync('icons', `${out}/icons`, { recursive: true });
cpSync('src/popup/popup.html', `${out}/popup/popup.html`);
cpSync('src/popup/popup.css', `${out}/popup/popup.css`);

const options = {
  entryPoints: {
    background: 'src/background.ts',
    content: 'src/content.ts',
    'popup/popup': 'src/popup/popup.ts',
  },
  outdir: out,
  bundle: true,
  format: 'iife',
  target: 'chrome116',
  logLevel: 'info',
};

if (process.argv.includes('--watch')) await (await context(options)).watch();
else await build(options);
