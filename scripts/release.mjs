// Bumps the version everywhere, commits, tags and pushes. GitHub Actions does the rest.
//
//   npm run release -- 0.2.0
//
// Needs docs/releases/v0.2.0.md (the release notes users see in the app and on GitHub).
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const version = process.argv[2]?.replace(/^v/, '');
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const fail = (msg) => {
  console.error(`✗ ${msg}`);
  process.exit(1);
};

if (!version || !/^\d+\.\d+\.\d+$/.test(version)) fail('Usage: npm run release -- 1.2.3');
if (git('rev-parse', '--abbrev-ref', 'HEAD') !== 'main') fail('Release from the main branch.');
if (git('status', '--porcelain')) fail('Commit or stash your changes first.');
if (git('tag', '--list', `v${version}`)) fail(`Tag v${version} already exists.`);
const notes = join(root, 'docs', 'releases', `v${version}.md`);
if (!existsSync(notes)) fail(`Write the release notes first: docs/releases/v${version}.md`);

const json = (file, update) => {
  const path = join(root, file);
  const data = JSON.parse(readFileSync(path, 'utf8'));
  update(data);
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n');
  return file;
};
const text = (file, pattern, replacement) => {
  const path = join(root, file);
  const before = readFileSync(path, 'utf8');
  const after = before.replace(pattern, replacement);
  if (before === after) fail(`Could not find the version in ${file}`);
  writeFileSync(path, after);
  return file;
};

const files = [
  json('package.json', (d) => (d.version = version)),
  json('app/package.json', (d) => (d.version = version)),
  json('extension/package.json', (d) => (d.version = version)),
  json('extension/manifest.json', (d) => (d.version = version)),
  json('app/src-tauri/tauri.conf.json', (d) => (d.version = version)),
  text('app/src-tauri/Cargo.toml', /^version = ".*"$/m, `version = "${version}"`),
];
// Keep Cargo.lock in step with Cargo.toml.
execFileSync('cargo', ['update', '--workspace', '--offline'], { cwd: join(root, 'app', 'src-tauri'), stdio: 'inherit' });
files.push('app/src-tauri/Cargo.lock');

git('add', ...files);
git('commit', '-m', `chore: release v${version}`);
git('tag', '-a', `v${version}`, '-m', `v${version}`);
git('push', 'origin', 'main', '--follow-tags');
console.log(`✓ Pushed v${version}. GitHub Actions is building the release:`);
console.log(`  https://github.com/rene-poulsen/stepcast/actions`);
