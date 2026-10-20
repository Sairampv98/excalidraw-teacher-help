import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { writeFileAtomic } from './atomic-write.mjs';

const MOD = pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), 'atomic-write.mjs')).href;

test('atomic-write: replaces content, leaves no temp files', () => {
  const d = mkdtempSync(join(tmpdir(), 'aw-'));
  try {
    const p = join(d, 'state.json');
    writeFileAtomic(p, '{"v":1}'); writeFileAtomic(p, '{"v":2}');
    assert.equal(readFileSync(p, 'utf8'), '{"v":2}');
    assert.deepEqual(readdirSync(d), ['state.json']);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('atomic-write: process killed mid-write never leaves a torn file (crash test)', { skip: process.platform === 'win32' && 'SIGKILL semantics differ on Windows' }, async () => {
  const d = mkdtempSync(join(tmpdir(), 'aw-'));
  const p = join(d, 'state.json');
  writeFileSync(p, JSON.stringify({ n: -1, pad: 'x'.repeat(200000) }));
  try {
    for (let round = 0; round < 8; round++) {
      const child = spawn(process.execPath, ['--input-type=module', '-e',
        `import { writeFileAtomic } from ${JSON.stringify(MOD)}; for (let n = 0; ; n++) writeFileAtomic(${JSON.stringify(p)}, JSON.stringify({ n, pad: 'x'.repeat(200000 + (n % 997)) }));`]);
      await new Promise((r) => setTimeout(r, 40 + round * 15));
      child.kill('SIGKILL');
      await new Promise((r) => child.on('exit', r));
      const v = JSON.parse(readFileSync(p, 'utf8')); // throws if torn
      assert.ok(Number.isInteger(v.n));
    }
  } finally { rmSync(d, { recursive: true, force: true }); }
});

// Deterministic fault injection at every syscall boundary (replaces a timing-based negative control
// that was flaky under load, RF-8). The same injection tears the naive write, proving the test can fail.
function withFault(name, fn) {
  const orig = fs[name];
  fs[name] = () => { throw Object.assign(new Error(`injected crash in ${name}`), { code: 'EIO' }); };
  syncBuiltinESMExports();
  try { return fn(); } finally { fs[name] = orig; syncBuiltinESMExports(); }
}
const naiveWrite = (p, text) => { const fd = fs.openSync(p, 'w'); try { fs.writeSync(fd, text); } finally { fs.closeSync(fd); } };

test('atomic-write: a crash at any step leaves the old content and no temp file', () => {
  const d = mkdtempSync(join(tmpdir(), 'aw-'));
  try {
    const p = join(d, 'state.json');
    for (const step of ['openSync', 'writeSync', 'fsyncSync', 'renameSync']) {
      writeFileSync(p, '{"v":"old"}');
      assert.throws(() => withFault(step, () => writeFileAtomic(p, '{"v":"new"}')), /injected crash/);
      assert.equal(readFileSync(p, 'utf8'), '{"v":"old"}', `after crash in ${step}`);
      assert.deepEqual(readdirSync(d), ['state.json'], `no temp file left after crash in ${step}`);
    }
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('atomic-write: the same injected crash DOES tear a naive open(w)+write (the test can fail)', () => {
  const d = mkdtempSync(join(tmpdir(), 'aw-'));
  try {
    const p = join(d, 'state.json'); writeFileSync(p, '{"v":"old"}');
    assert.throws(() => withFault('writeSync', () => naiveWrite(p, '{"v":"new"}')));
    assert.equal(readFileSync(p, 'utf8'), '', 'naive write truncated the file before crashing');
  } finally { rmSync(d, { recursive: true, force: true }); }
});
