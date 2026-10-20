// Money as integer minor units (paise, cents, pence). Zero dependencies. See PATTERN.md.
const check = (n) => { if (!Number.isSafeInteger(n)) throw new RangeError(`not a safe integer amount: ${n}`); return n; };

/** "1,234.50" -> 123450 (scale 2). Throws on more decimals than the scale allows. */
export function parse(text, scale = 2) {
  const s = String(text).trim().replace(/,/g, '');
  const m = s.match(/^([+-])?(\d+)(?:\.(\d*))?$/);
  if (!m) throw new SyntaxError(`not an amount: ${JSON.stringify(text)}`);
  const frac = m[3] || '';
  if (frac.length > scale) throw new RangeError(`${text} has more than ${scale} decimals`);
  const n = Number(m[2] + frac.padEnd(scale, '0'));
  return check(m[1] === '-' ? -n : n);
}

export function format(minor, scale = 2) {
  check(minor);
  const neg = minor < 0; const digits = String(Math.abs(minor)).padStart(scale + 1, '0');
  const out = scale ? `${digits.slice(0, -scale)}.${digits.slice(-scale)}` : digits;
  return neg ? `-${out}` : out;
}

export const sum = (xs) => check(xs.reduce((a, b) => check(a + check(b)), 0));

/** minor * decimal-string quantity, rounded to a whole minor unit. mode: half-even | half-up | down */
export function multiply(minor, qty, mode = 'half-even') {
  check(minor);
  if (typeof qty !== 'string') throw new TypeError('quantity must be a decimal string (floats are refused)');
  const m = qty.trim().match(/^([+-])?(\d+)(?:\.(\d+))?$/);
  if (!m) throw new SyntaxError(`quantity must be a decimal string, got ${JSON.stringify(qty)}`);
  const qs = (m[3] || '').length; const q = BigInt((m[1] || '') + m[2] + (m[3] || ''));
  const p = BigInt(minor) * q; const d = 10n ** BigInt(qs);
  let r = p / d; const rem = p % d; const twice = (rem < 0n ? -rem : rem) * 2n; const sign = p < 0n ? -1n : 1n;
  if (mode === 'half-up' && twice >= d) r += sign;
  else if (mode === 'half-even' && (twice > d || (twice === d && r % 2n !== 0n))) r += sign;
  else if (!['half-up', 'half-even', 'down'].includes(mode)) throw new RangeError(`unknown rounding ${mode}`);
  return check(Number(r));
}

/** Split total by integer ratios; largest-remainder so parts always sum to total. */
export function allocate(total, ratios) {
  check(total);
  if (!ratios.length || ratios.some((r) => !Number.isInteger(r) || r < 0) || !ratios.some((r) => r > 0)) throw new RangeError('ratios must be non-negative integers, not all zero');
  const T = BigInt(total); const R = ratios.map(BigInt); const S = R.reduce((a, b) => a + b, 0n);
  const parts = R.map((r) => (T * r) / S); let left = T - parts.reduce((a, b) => a + b, 0n);
  const order = R.map((r, i) => [((T * r) % S) * (T < 0n ? -1n : 1n), i]).sort((a, b) => (b[0] > a[0] ? 1 : b[0] < a[0] ? -1 : a[1] - b[1]));
  const step = left < 0n ? -1n : 1n;
  for (let k = 0; left !== 0n; k++) { parts[order[k % order.length][1]] += step; left -= step; }
  return parts.map(Number);
}
