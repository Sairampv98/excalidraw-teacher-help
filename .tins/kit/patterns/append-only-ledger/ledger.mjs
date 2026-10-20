// Append-only ledger with reversal chains. Zero dependencies. See PATTERN.md.
import { existsSync, readFileSync, openSync, writeSync, fsyncSync, closeSync } from 'node:fs';

export function openLedger(path, { clock = () => new Date().toISOString() } = {}) {
  const load = () => {
    if (!existsSync(path)) return { entries: [], torn: false };
    const text = readFileSync(path, 'utf8'); const torn = text.length > 0 && !text.endsWith('\n');
    const lines = text.split('\n'); if (torn || lines[lines.length - 1] === '') lines.pop();
    return { entries: lines.filter(Boolean).map((l) => JSON.parse(l)), torn };
  };
  let { entries, torn } = load();
  const write = (e) => {
    if (torn) throw new Error('ledger has a torn final line; repair before appending');
    const fd = openSync(path, 'a'); try { writeSync(fd, JSON.stringify(e) + '\n'); fsyncSync(fd); } finally { closeSync(fd); }
    entries.push(e); return e;
  };
  const nextSeq = () => (entries.length ? entries[entries.length - 1].seq + 1 : 1);
  const api = {
    append({ account, amount, memo = '' }) {
      if (typeof account !== 'string' || !account) throw new TypeError('account required');
      if (!Number.isSafeInteger(amount)) throw new TypeError('amount must be an integer (minor units)');
      return write({ seq: nextSeq(), ts: clock(), account, amount, memo });
    },
    reverse(seq, reason) {
      const o = entries.find((e) => e.seq === seq);
      if (!o) throw new Error(`no entry ${seq}`);
      if (o.reverses) throw new Error(`entry ${seq} is itself a reversal; post a new entry instead`);
      if (entries.some((e) => e.reverses === seq)) throw new Error(`entry ${seq} already reversed`);
      if (!reason) throw new Error('reason required');
      return write({ seq: nextSeq(), ts: clock(), account: o.account, amount: -o.amount, memo: reason, reverses: seq });
    },
    balance: (account) => entries.filter((e) => e.account === account).reduce((a, e) => a + e.amount, 0),
    entries: () => entries.map((e) => ({ ...e })),
    verify() {
      const problems = []; if (torn) problems.push('torn-tail');
      entries.forEach((e, i) => {
        if (e.seq !== i + 1) problems.push(`seq gap at line ${i + 1}`);
        if (e.reverses) {
          const o = entries.find((x) => x.seq === e.reverses);
          if (!o || o.seq >= e.seq) problems.push(`entry ${e.seq} reverses unknown or later ${e.reverses}`);
          else if (o.amount !== -e.amount || o.account !== e.account) problems.push(`entry ${e.seq} does not cancel ${o.seq}`);
        }
      });
      return problems;
    },
  };
  return api;
}
