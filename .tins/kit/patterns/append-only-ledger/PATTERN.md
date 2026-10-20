---
id: append-only-ledger
solves: A domain history that is never edited or deleted — corrections are new reversing entries that point at what they cancel; balances are derived by folding the entries; a torn last line after a crash is detected.
triggers: append-only, ledger, audit log, journal, reversal, correction, immutable history, stock movement
not_when: You must prove to a third party that history was not rewritten (add hash-chained-log on top); high write concurrency from many processes (use a database table with INSERT-only grants).
status: proven
consumers: builder-1 (ASSUMED, brief 2.2.2), builder-2 (ASSUMED, brief 2.2.2)
license: MIT, written for tins-kit
source: original
module: ledger.mjs
test: ledger.pattern-test.mjs
---
# Append-only ledger with reversal chains

Use: `const L = openLedger(path, { clock })`; `L.append({ account, amount, memo })`;
`L.reverse(seq, reason)`; `L.balance(account)`; `L.verify()`.

- One JSON object per line; `seq` strictly increases; no API edits or deletes a line.
- A reversal is a new entry `{ reverses: seq, amount: -original }`. Reversing twice is refused,
  and a reversal cannot be reversed (post a fresh entry instead) — the chain stays one level deep.
- `amount` is an integer (see money-minor-units). The clock is injected for deterministic tests.
- On open, a final line without a newline (crash mid-append) is reported by `verify()` as `torn-tail`.
