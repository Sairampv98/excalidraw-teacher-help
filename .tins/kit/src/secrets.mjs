// Secret scan. Reports class + location, NEVER the matched value (property from a real incident).
// Scope: whatever text the caller hands in. `scanSession` hands in what a session ADDED:
// added diff lines, commit messages and the record — not just the record (RF-4 / brief 2.2.4).
const RULES = [
  ['aws-access-key-id', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/],
  ['github-token', /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{60,})\b/],
  ['slack-token', /\bxox[abposr]-[A-Za-z0-9-]{10,}/],
  ['stripe-live-key', /\b[sr]k_live_[A-Za-z0-9]{16,}/],
  ['anthropic-key', /\bsk-ant-[A-Za-z0-9_-]{20,}/],
  ['openai-key', /\bsk-(?:proj-)?[A-Za-z0-9]{32,}\b/],
  ['google-api-key', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['private-key-block', /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY( BLOCK)?-----/],
  ['url-with-password', /\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:([^\s@/]{6,})@[^\s]+/i],
  ['jwt', /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
];
// Generic "name = 'value'" assignment. Only fires when the value looks random (entropy) and
// is not an obvious placeholder or an env lookup — this is the noisy rule, so it is strict.
const ASSIGN = /\b([A-Za-z0-9_]*(?:secret|passwd|password|api[_-]?key|token|private[_-]?key|access[_-]?key)[A-Za-z0-9_]*)\b\s*[:=]\s*["'`]([^"'`\s]{12,})["'`]/i;
const PLACEHOLDER = /^(?:x+|\*+|<.*>|\$\{.*\}|changeme|example|placeholder|your[_-].*|dummy.*|test.*|fake.*|redacted)$/i;

function entropy(s) {
  const f = {}; for (const c of s) f[c] = (f[c] || 0) + 1;
  return Object.values(f).reduce((h, n) => h - (n / s.length) * Math.log2(n / s.length), 0);
}

/** Scan one line; returns class name or null. */
export function classify(text) {
  for (const [name, re] of RULES) {
    const m = text.match(re);
    if (m && !(name === 'url-with-password' && PLACEHOLDER.test(m[1]))) return name;
  }
  const a = text.match(ASSIGN);
  if (a && !PLACEHOLDER.test(a[2]) && entropy(a[2]) >= 3.5) return 'generic-assignment';
  return null;
}

/** items: [{path, line, text}] -> findings [{path, line, class}] (no values, by construction). */
export function scan(items) {
  const out = [];
  for (const it of items) { const c = classify(it.text); if (c) out.push({ path: it.path, line: it.line, class: c }); }
  return out;
}

export function scanText(path, text) {
  return scan(text.split(/\r?\n/).map((t, i) => ({ path, line: i + 1, text: t })));
}

export const formatFinding = (f) => `${f.path}:${f.line}: ${f.class}`;
