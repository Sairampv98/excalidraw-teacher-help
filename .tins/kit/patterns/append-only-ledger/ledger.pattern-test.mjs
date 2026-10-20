import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openLedger } from './ledger.mjs';

const fixed = () => { let t = 0; return () => `2026-01-01T00:00:${String(t++).padStart(2, '0')}Z`; };
const tmp = () => join(mkdtempSync(join(tmpdir(), 'led-')), 'l.jsonl');

test('ledger: balance derived; reversal chain; persistence', () => {
  const p = tmp();
  try {
    const L = openLedger(p, { clock: fixed() });
    L.append({ account: 'stock:tuna', amount: 5000 }); L.append({ account: 'stock:tuna', amount: -1200 });
    L.reverse(2, 'counted wrong');
    assert.equal(L.balance('stock:tuna'), 5000);
    assert.throws(() => L.reverse(2, 'again'), /already reversed/);
    assert.throws(() => L.reverse(3, 'undo the undo'), /itself a reversal/);
    assert.throws(() => L.append({ account: 'x', amount: 1.5 }), /integer/);
    const R = openLedger(p); assert.equal(R.balance('stock:tuna'), 5000); assert.deepEqual(R.verify(), []);
    assert.equal(R.entries()[2].ts, '2026-01-01T00:00:02Z');
  } finally { rmSync(join(p, '..'), { recursive: true, force: true }); }
});

test('ledger: torn tail detected and blocks appends; tampering detected', () => {
  const p = tmp();
  try {
    const L = openLedger(p); L.append({ account: 'a', amount: 1 });
    appendFileSync(p, '{"seq":2,"acc');
    const R = openLedger(p); assert.deepEqual(R.verify(), ['torn-tail']);
    assert.throws(() => R.append({ account: 'a', amount: 1 }), /torn/);
    writeFileSync(p, readFileSync(p, 'utf8').split('\n')[0] + '\n' + JSON.stringify({ seq: 3, account: 'a', amount: -9, reverses: 1 }) + '\n');
    assert.deepEqual(openLedger(p).verify(), ['seq gap at line 2', 'entry 3 does not cancel 1']);
  } finally { rmSync(join(p, '..'), { recursive: true, force: true }); }
});
