import assert from 'node:assert/strict';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const bundle = join(root, 'island-tauri/src-tauri/target/release/bundle/macos/Cue.app/Contents');
const isolated = await mkdtemp(join(tmpdir(), 'cue-packaged-check-'));
try {
  await cp(join(bundle, 'Resources/agent-runtime'), join(isolated, 'runtime'), { recursive: true });
  await cp(join(bundle, 'MacOS/island-agent'), join(isolated, 'island-agent'));
  const result = spawnSync(join(isolated, 'island-agent'), [], {
    cwd: isolated, timeout: 30_000, encoding: 'utf8',
    env: { PATH: '/usr/bin:/bin', HOME: process.env.HOME, CUE_AGENT_RUNTIME: join(isolated, 'runtime') },
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /Nutzung:/);
  assert.doesNotMatch(result.stderr, /ERR_MODULE_NOT_FOUND|Cannot find module/);
  console.log('Packaged sidecar starts outside the repository with bundled Node and dependencies.');
} finally {
  await rm(isolated, { recursive: true, force: true });
}
