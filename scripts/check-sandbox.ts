import assert from 'node:assert/strict';
import { buildSandboxTools } from '../sandbox-tools.js';
let exitCode = 0;
const events: boolean[] = [];
let args: string[] = [];
const tools = buildSandboxTools({ sandbox: { commands: { run: async (_: string, options: { args: string[] }) => { args = options.args; return { stdout: '', stderr: '', exitCode }; } } } as any, hooks: { onToolDone: (_, ok) => events.push(ok) } });
const execute = async (name: 'run_command' | 'run_shell' | 'install_package' | 'list_dir', input: any) => (tools[name].execute as any)(input, {});
assert.equal((await execute('run_command', { command: 'true', args: [] })).ok, true);
exitCode = 1;
for (const [name, input] of [['run_command', { command: 'false', args: [] }], ['run_shell', { command: 'exit 1' }], ['install_package', { manager: 'pip', packageName: 'missing' }]] as const) {
  assert.equal((await execute(name, input)).ok, false);
  assert.equal(events.at(-1), false);
}
await execute('list_dir', { path: '/tmp/a b; echo bad' });
assert.deepEqual(args, ['-la', '--', '/tmp/a b; echo bad']);
console.log('Sandbox checks passed: exit codes, matching events, literal paths.');
const { completionError } = await import('../orchestrator.js');
const step = (toolName: string, ok: boolean, input: unknown = {}) => ({
  toolCalls: [{ toolCallId: "call", toolName, input }],
  toolResults: [{ toolCallId: "call", toolName, output: { ok } }],
});
assert.ok(completionError('It worked!', []));
assert.ok(completionError('It worked!', [step('run_shell', false), step('read_file', true)]));
assert.equal(completionError('42', [step('run_shell', true)]), undefined);
assert.ok(completionError('Not fixed', [step('run_shell', false, { command: 'exit 7' }), step('run_shell', true, { command: 'echo unrelated' })]));
assert.equal(completionError('Fixed', [step('run_shell', false, { command: 'python app.py' }), step('run_shell', true, { command: 'python app.py' })]), undefined);
assert.ok(completionError('Done', [step('wait', true)]));
console.log('Completion checks passed: prose alone fails, execution evidence required, retries recover.');
const { mkdtemp, readFile, readdir, rm } = await import('node:fs/promises');
const { tmpdir } = await import('node:os');
const { join } = await import('node:path');
const home = await mkdtemp(join(tmpdir(), 'cue-export-check-'));
const oldHome = process.env.HOME;
process.env.HOME = home;
try {
  let exported = '';
  let previewExpires = '';
  let timeout = 0;
  const artifactTools = buildSandboxTools({
    sandbox: {
      files: { download: async () => new TextEncoder().encode('2,3,5,7') },
      commands: { run: async () => ({ exitCode: 0 }) },
      previewUrl: async () => ({ url: 'https://preview.example.test' }),
      setTimeout: async (ms: number) => { timeout = ms; return { expiresAt: '2030-01-01T00:10:00Z' }; },
    } as any,
    onExport: (_, url) => { exported = url; },
    onPreview: (_, expires) => { previewExpires = expires; },
  });
  assert.equal((await (artifactTools.export_file.execute as any)({ path: '/tmp/primes.csv' }, {})).ok, true);
  const id = (await readdir(join(home, 'Downloads/Cue')))[0];
  assert.equal(exported, 'cue-file:' + id);
  assert.equal(await readFile(join(home, 'Downloads/Cue', id), 'utf8'), '2,3,5,7');
  assert.equal((await (artifactTools.expose_port.execute as any)({ port: 3000 }, {})).ok, true);
  assert.equal(timeout, 600_000);
  assert.equal(previewExpires, '2030-01-01T00:10:00Z');
} finally {
  if (oldHome === undefined) delete process.env.HOME; else process.env.HOME = oldHome;
  await rm(home, { recursive: true, force: true });
}
console.log('Artifact checks passed: durable local export and ten-minute preview timeout.');
const { buildBrowserTools } = await import('../browser-tools.js');
let browserOk = false;
const browserTools = buildBrowserTools({
  page: {
    title: async () => 'Example Domain', url: () => 'https://example.com',
    locator: () => ({ innerText: async () => 'Example Domain', evaluateAll: async () => [] }),
  } as any,
  browser: {} as any,
  hooks: { onToolDone: (_, ok) => { browserOk = ok; } },
});
assert.equal((await (browserTools.read_page.execute as any)({ maxChars: 100, offset: 0, waitForNetworkIdle: false }, {})).ok, true);
assert.equal(browserOk, true);
console.log('Browser read result and progress event agree.');
let navigationCalls = 0;
const navigationTools = buildBrowserTools({
  page: {
    goto: async () => { navigationCalls++; },
    title: async () => 'Example', url: () => 'https://example.com',
  } as any,
  browser: { contexts: () => { navigationCalls++; throw new Error('Unexpected new tab'); } } as any,
});
for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'data:text/html,hello', 'https://user:secret@example.com', 'not a URL', '']) {
  for (const name of ['navigate', 'new_tab'] as const) {
    assert.equal((await (navigationTools[name].execute as any)({ url, waitUntil: 'domcontentloaded' }, {})).ok, false);
  }
}
assert.equal(navigationCalls, 0, 'Invalid URLs must not reach the browser');
assert.equal((await (navigationTools.navigate.execute as any)({ url: 'https://example.com', waitUntil: 'domcontentloaded' }, {})).ok, true);
assert.equal(navigationCalls, 1);
console.log('Browser navigation rejects unsafe schemes and embedded credentials before opening a page.');
let waiting = false;
const processTools = buildSandboxTools({ sandbox: { commands: {
  start: async () => ({ cmdId: 'server-1', wait: () => { waiting = true; return Promise.reject(new Error('channel closed')); } }),
  run: async () => ({ exitCode: 1 }),
} } as any });
const processResult = await (processTools.run_command.execute as any)({ command: 'python3', args: ['-m', 'http.server', '3000'], background: true }, {});
assert.equal(processResult.status, 'started');
assert.equal(waiting, true);
assert.equal((await (processTools.expose_port.execute as any)({ port: 3000 }, {})).ok, false);
console.log('Persistent startup returns immediately; unavailable ports do not produce previews.');
