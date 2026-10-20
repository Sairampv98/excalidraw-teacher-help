import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse, format, multiply, allocate, sum } from './money.mjs';

test('money: no float drift (0.1 + 0.2)', () => assert.equal(format(sum([parse('0.10'), parse('0.20')])), '0.30'));
test('money: parse/format round trip and scales', () => {
  for (const s of ['0.00', '12.34', '-5.01', '1234567.89']) assert.equal(format(parse(s)), s);
  assert.equal(parse('1,234.5'), 123450); assert.equal(parse('7', 0), 7); assert.equal(format(1234, 3), '1.234');
  assert.throws(() => parse('1.234')); assert.throws(() => parse('abc')); assert.throws(() => parse('1e3'));
});
test('money: multiply by decimal quantity with explicit rounding', () => {
  assert.equal(multiply(1999, '1.250'), 2499); // 2498.75 -> 2499
  assert.equal(multiply(5, '0.5', 'half-even'), 2); assert.equal(multiply(5, '0.5', 'half-up'), 3); assert.equal(multiply(7, '0.5', 'half-even'), 4);
  assert.equal(multiply(-5, '0.5', 'half-up'), -3); assert.equal(multiply(999, '0.333', 'down'), 332);
  assert.throws(() => multiply(100, 1.5), /decimal string/); assert.throws(() => multiply(100, '1e2'));
});
test('money: allocate never loses a unit', () => {
  assert.deepEqual(allocate(1000, [1, 1, 1]), [334, 333, 333]);
  for (const [t, r] of [[1, [1, 1]], [-1000, [1, 2, 3]], [99999, [7, 0, 3]], [5, [1, 1, 1, 1, 1, 1, 1]]]) assert.equal(allocate(t, r).reduce((a, b) => a + b, 0), t);
});
test('money: unsafe integers refused', () => assert.throws(() => sum([Number.MAX_SAFE_INTEGER, 1])));
