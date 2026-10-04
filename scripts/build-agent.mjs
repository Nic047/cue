// Package Node and production dependencies; Solari's WebSockets need Node, not Bun.
import { build } from 'esbuild';
import { cp, mkdir, rm, chmod, writeFile, rename } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = dirname(dirname(fileURLToPath(import.meta.url)));
if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('Build with Node.js 22 or newer.');
if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('Cue currently packages Apple Silicon macOS only; use an arm64 Node runtime.');
const destinationRoot = join(root, 'cue-app/src-tauri/resources/agent-runtime');
const output = destinationRoot + '.staging-' + process.pid;
await mkdir(output, { recursive: true });
try {
  await writeFile(join(output, '.gitkeep'), '');
  await cp(process.execPath, join(output, 'node'));
  await chmod(join(output, 'node'), 0o755);
  let licensed = false;
  for (const license of [join(dirname(process.execPath), '..', 'LICENSE'), join(dirname(process.execPath), '..', 'share/doc/node/LICENSE')]) {
    try { await cp(license, join(output, 'NODE-LICENSE')); licensed = true; break; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  if (!licensed) throw new Error('Node LICENSE missing from this Node installation; install a complete Node distribution before bundling.');

  await writeFile(join(output, 'package.json'), JSON.stringify({ type: 'module' }));
  await build({ entryPoints: [join(root, 'orchestrator.ts')], outfile: join(output, 'orchestrator.mjs'), bundle: true, platform: 'node', format: 'esm', packages: 'external', target: 'node22' });
  const packages = execFileSync('npm', ['ls', '--omit=dev', '--parseable', '--all', '--offline'], { cwd: root, encoding: 'utf8' }).trim().split('\n').filter(path => path !== root);
  for (const path of new Set(packages)) {
    const destination = join(output, relative(root, path));
    await mkdir(dirname(destination), { recursive: true });
    await cp(path, destination, { recursive: true });
  }
  // ponytail: release builds are serial; add a build lock if concurrent packaging is introduced.
  const previous = destinationRoot + '.previous';
  await rm(previous, { recursive: true, force: true });
  await rename(destinationRoot, previous).catch(error => { if (error.code !== 'ENOENT') throw error; });
  try { await rename(output, destinationRoot); }
  catch (error) { await rename(previous, destinationRoot).catch(() => {}); throw error; }
  await rm(previous, { recursive: true, force: true });
  console.log(`Agent runtime packaged for ${process.arch}: ${packages.length} production packages.`);

} finally { await rm(output, { recursive: true, force: true }); }
