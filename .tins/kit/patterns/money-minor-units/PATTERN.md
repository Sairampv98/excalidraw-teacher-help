---
id: money-minor-units
solves: Exact money arithmetic — amounts are integers in the currency's minor unit; parsing, formatting, multiplying by a decimal quantity with explicit rounding, and splitting a total without losing a unit.
triggers: money, currency, price, amount, cents, minor unit, decimal, rounding, float
not_when: You need sub-minor-unit precision as a stored value (FX rates, per-gram unit prices) — store those as scaled integers with an explicit scale column, then use multiply() at the boundary.
status: proven
consumers: fish-inventory (ASSUMED, brief 2.2.2), builder-2 (ASSUMED, brief 2.2.2)
license: MIT, written for tins-kit
source: original
module: money.mjs
test: money.pattern-test.mjs
---
# Money as integer minor units

Use: `import { parse, format, multiply, allocate, sum } from './money.mjs'`.

- Store `amount_minor` as an integer (DB: `bigint`; JSON: number, guarded by `Number.isSafeInteger`).
- `parse("12.34")` → `1234`. Too many decimals throws instead of rounding silently.
- `multiply(1999, "1.250", "half-even")` — quantity is a decimal *string*, never a float.
- `allocate(1000, [1, 1, 1])` → `[334, 333, 333]` — sums back to the total.
- Never `parseFloat`, `toFixed` or `Number * 100` on a money value.

Pitfall: different currencies have different scales (JPY 0, INR/USD 2, KWD 3). Pass `scale`.
