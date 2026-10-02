// Seal the bundled runtime and app before creating the downloadable alpha.
import { cp, mkdtemp, mkdir, rm, symlink, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const app = join(root, 'island-tauri/src-tauri/target/release/bundle/macos/Cue.app');
const config = JSON.parse(await readFile(join(root, 'island-tauri/src-tauri/tauri.conf.json'), 'utf8'));
const { version } = config;
const dmg = config.bundle.macOS.dmg;
const background = join(root, 'island-tauri/src-tauri', dmg.background);
const output = join(root, `landing/downloads/Cue-${version}-apple-silicon.dmg`);
if (process.platform !== 'darwin') throw new Error('Package on macOS.');
const run = (command, args) => execFileSync(command, args, { stdio: 'inherit' });
// Ad hoc signing fixes integrity; it does not provide notarization or Developer ID trust.
if (!process.argv.includes('--installer-only')) {
  run('/usr/bin/codesign', ['--force', '--sign', '-', join(app, 'Contents/Resources/agent-runtime/node')]);
  const sidecar = join(app, 'Contents/MacOS/island-agent');
  run('/usr/bin/clang', ['-Os', join(root, 'scripts/agent-launcher.c'), '-o', sidecar]);
  run('/usr/bin/codesign', ['--force', '--sign', '-', sidecar]);
  run('/usr/bin/codesign', ['--force', '--sign', '-', app]);
}
run('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=2', app]);
const python = process.env.CUE_DMG_PYTHON || '/private/tmp/cue-dmg-tools/bin/python';
try { run(python, ['-c', 'import ds_store, mac_alias']); }
catch { throw new Error('Install scripts/requirements-dmg.txt into /private/tmp/cue-dmg-tools or set CUE_DMG_PYTHON to that Python environment.'); }
const staging = await mkdtemp(join(tmpdir(), 'cue-dmg-'));
try {
  await mkdir(dirname(output), { recursive: true });
  const writable = join(staging, 'installer.dmg');
  const contents = join(staging, 'contents');
  await mkdir(contents);
  await cp(app, join(contents, 'Cue.app'), { recursive: true });
  await symlink('/Applications', join(contents, 'Applications'));
  await cp(join(root, 'island-tauri/src-tauri/icons/icon.icns'), join(contents, '.VolumeIcon.icns'));
  await mkdir(join(contents, '.background'));
  await cp(background, join(contents, '.background/background.png'));
  run('/usr/bin/hdiutil', ['create', '-volname', `Cue ${version} Installer`, '-srcfolder', contents, '-format', 'UDRW', '-fs', 'HFS+', '-ov', writable]);
  const mount = join(staging, 'mount');
  await mkdir(mount);
  run('/usr/bin/hdiutil', ['attach', '-nobrowse', '-mountpoint', mount, writable]);
  try {
    run('/usr/bin/xcrun', ['SetFile', '-a', 'C', mount]);
    run(python, [join(root, 'scripts/installer-layout.py'), mount, JSON.stringify(dmg)]);
  }
  finally { run('/usr/bin/hdiutil', ['detach', mount]); }
  run('/usr/bin/hdiutil', ['convert', writable, '-format', 'UDZO', '-ov', '-o', output]);
  run('/usr/bin/hdiutil', ['verify', output]);
  console.log(output);
} finally { await rm(staging, { recursive: true, force: true }); }
