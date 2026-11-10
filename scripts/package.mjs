import {glob, mkdir, rm} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {stdio: 'inherit', ...options});
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run(process.execPath, ['scripts/check.mjs']);
const archive = 'output/Evans-Chrome.zip';
await mkdir('output', {recursive: true});
await rm(archive, {force: true});
run('zip', ['-q', archive, 'README.md', 'LICENSE']);
const files = await Array.fromAsync(glob([
  'manifest.json', '*.html', '*.js', 'core/*.js', 'ui/*.js', 'ui/*.css',
  'assets/icon*.png', 'assets/mark.svg',
], {cwd: 'extension'}));
run('zip', ['-q', `../${archive}`, ...files.sort()], {cwd: 'extension'});
console.log(`Extensión empaquetada: ${archive}`);
