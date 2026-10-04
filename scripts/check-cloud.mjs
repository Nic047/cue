// Real-provider acceptance check. Uses existing keys; creates short-lived cloud sessions.
import 'dotenv/config';
import assert from 'node:assert/strict';
import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const output = '/private/tmp/cue-cloud-acceptance';
await mkdir(output, { recursive: true });
const home = join(output, 'home');
await mkdir(home, { recursive: true });
const runtime = join(output, 'runtime');
await cp(join(root, 'cue-app/src-tauri/target/release/bundle/macos/cue.app/Contents/Resources/agent-runtime'), runtime, { recursive: true });
const env = { PATH: '/usr/bin:/bin', HOME: home };
for (const name of ['SOLARI_API_KEY', 'AI_GATEWAY_API_KEY', 'GROQ_API_KEY', 'CHEAP_MODEL', 'FALLBACK_MODEL', 'PLANNER_MODEL']) if (process.env[name]) env[name] = process.env[name];
assert.ok(env.SOLARI_API_KEY && env.AI_GATEWAY_API_KEY, 'Missing provider keys');
const secrets = [env.SOLARI_API_KEY, env.AI_GATEWAY_API_KEY, env.GROQ_API_KEY].filter(Boolean);
const redact = (text) => secrets.reduce((value, secret) => value.replaceAll(secret, '[REDACTED]'), text);
const cases = {
  browser: 'Open https://example.com in a browser. Report its exact heading and main paragraph, and include its source link. Do not ask questions.',
  parallel: 'Execute these two independent tasks in parallel as TWO agents: 1. Open https://example.com in a browser and report the exact heading. 2. In a Python sandbox calculate the first 20 prime numbers, save them to primes.csv, and export the CSV to my Mac with export_file. Include all values and the exported file link. Do not ask questions.',
  failure: 'In a sandbox, execute sh -c "exit 7" exactly once. Do not retry, repair, or replace the failed command. Report its failure honestly. Do not ask questions.',
  preview: 'In a sandbox write index.html containing the heading Hello Cue acceptance test. Start a persistent Python HTTP server on port 3000 bound to 0.0.0.0, expose port 3000 using expose_port, and return the preview URL and expiration. Do not ask questions.',
};
const results = JSON.parse(await readFile(join(output, 'results.json'), 'utf8').catch(() => '[]'));
for (const name of (process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(cases))) {
  assert.ok(cases[name], 'Unknown case');
  console.log('START ' + name);
  const started = Date.now();
  const child = spawn(join(runtime, 'node'), [join(runtime, 'orchestrator.mjs'), cases[name]], { cwd: output, env, stdio: ['pipe', 'pipe', 'pipe'] });
  child.stdin.end();
  let stdout = '', stderr = '', timedOut = false;
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  let forceKill;
  const timer = setTimeout(() => { timedOut = true; child.kill('SIGTERM'); forceKill = setTimeout(() => child.kill('SIGKILL'), 6000); }, 180_000);
  const code = await new Promise((resolve, reject) => { child.once('close', resolve); child.once('error', reject); });
  clearTimeout(timer); clearTimeout(forceKill);
  const events = stdout.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  await writeFile(join(output, name + '.jsonl'), redact(stdout));
  await writeFile(join(output, name + '.log'), redact(stderr));
  const record = { name, code, timedOut, durationMs: Date.now() - started, passed: false };
  try {
    assert.equal(timedOut, false, 'Timed out');
    assert.equal(code, 0, 'Agent process failed');
    const plan = events.find(event => event.type === 'plan');
    const done = events.filter(event => event.type === 'task_done');
    const answer = events.find(event => event.type === 'answer');
    assert.ok(plan?.tasks?.length, 'No task plan');
    assert.equal(done.length, plan.tasks.length, 'Missing task completion');
    for (const task of plan.tasks) {
      assert.ok(events.some(event => event.type === 'task_start' && event.taskId === task.id), 'Missing start ID');
      assert.ok(done.some(event => event.taskId === task.id), 'Missing completion ID');
    }
    assert.ok(answer, 'Missing final answer');
    const text = (answer.text ?? '') + '\n' + (answer.detail ?? '');
    if (name === 'failure') {
      assert.ok(done.every(task => task.ok === false), 'Failure reported as success');
      assert.ok(events.some(event => event.type === 'step' && event.ok === false && ['run_command', 'run_shell'].includes(event.tool)), 'No command failure event');
    } else {
      assert.ok(done.every(task => task.ok === true), 'A task failed');
      if (name === 'browser' || name === 'parallel') assert.match(text, /Example Domain/i);
      if (name === 'browser') assert.match(text, /https:\/\/example.com/);
      if (name === 'parallel') {
        assert.equal(plan.tasks.length, 2);
        assert.deepEqual(new Set(plan.tasks.map(task => task.type)), new Set(['browser', 'sandbox']));
        const id = text.match(/cue-file:([a-zA-Z0-9._-]+)/)?.[1];
        assert.ok(id, 'No exported file link');
        const csv = await readFile(join(home, 'Downloads/Cue', id), 'utf8');
        const numbers = csv.match(/\d+/g)?.map(Number);
        assert.deepEqual(numbers, [2,3,5,7,11,13,17,19,23,29,31,37,41,43,47,53,59,61,67,71]);
        record.exportedFile = join(home, 'Downloads/Cue', id);
      }
      if (name === 'preview') {
        const url = text.match(/\[Preview\]\((https?:\/\/[^)]+)\)/)?.[1];
        assert.ok(url, 'No preview link');
        const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
        assert.equal(response.status, 200, 'Preview unavailable after agent exit');
        assert.match(await response.text(), /Hello Cue acceptance test/);
        record.previewUrl = url;
        record.expiresAt = text.match(/Preview available until ([^\s.]+(?:\.[0-9]+)?Z)/)?.[1];
      }
    }
    record.passed = true;
  } catch (error) { record.error = error.message; }
  const previous = results.findIndex(result => result.name === name);
  if (previous !== -1) results.splice(previous, 1);
  results.push(record);
  await writeFile(join(output, 'results.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(record));
  if (!record.passed) console.log('DETAIL ' + redact(stderr.slice(-1600)));
}
console.log('Evidence: ' + output);
process.exitCode = results.some(result => !result.passed) ? 1 : 0;
