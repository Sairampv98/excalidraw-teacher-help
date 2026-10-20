// SPEC.md parsing. One numbering system: D-n (decisions) and AC-n (acceptance), both table rows.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROW = /^\|\s*((?:D|AC)-\d+)\s*\|(.*)\|\s*$/;

export function parseSpec(text) {
  const rows = []; const lines = text.split(/\r?\n/);
  lines.forEach((l, i) => {
    const m = l.match(ROW);
    if (m) rows.push({ id: m[1], cells: m[2].split('|').map((c) => c.trim()), line: i + 1, raw: l.trim() });
  });
  return rows;
}

/** Structural lint. Returns list of problems (strings). Empty = ok. */
export function lintSpec(text, root) {
  const problems = []; const rows = parseSpec(text); const seen = new Map();
  if (!rows.length) problems.push('SPEC.md has no D-n or AC-n rows');
  for (const r of rows) {
    if (seen.has(r.id)) problems.push(`duplicate id ${r.id} (lines ${seen.get(r.id)} and ${r.line})`);
    seen.set(r.id, r.line);
  }
  for (const r of rows.filter((x) => x.id.startsWith('D-'))) {
    const status = (r.cells[1] || '').toLowerCase();
    if (!/^(locked|open|superseded by d-\d+)$/.test(status))
      problems.push(`${r.id}: status must be "locked", "open" or "superseded by D-n" (got "${r.cells[1] || ''}")`);
    const sup = status.match(/superseded by (d-\d+)/);
    if (sup && !seen.has(sup[1].toUpperCase())) problems.push(`${r.id}: superseded by unknown ${sup[1].toUpperCase()}`);
  }
  for (const r of rows.filter((x) => x.id.startsWith('AC-'))) {
    const check = r.cells[1] || '';
    if (/^manual\b/i.test(check)) continue;
    const files = check.split(/[,\s]+/).map((s) => s.replace(/`/g, '')).filter(Boolean);
    if (!files.length) { problems.push(`${r.id}: Check column must name a file that tests it, or "manual"`); continue; }
    for (const f of files) {
      const p = join(root, f);
      if (!existsSync(p)) problems.push(`${r.id}: check file ${f} does not exist`);
      else if (!readFileSync(p, 'utf8').includes(r.id)) problems.push(`${r.id}: check file ${f} does not mention ${r.id}`);
    }
  }
  return problems;
}

/** Intent diff: which decision/acceptance rows were added, changed, removed between two SPEC texts. */
export function specDiff(before, after) {
  const a = new Map(parseSpec(before || '').map((r) => [r.id, r.raw]));
  const b = new Map(parseSpec(after || '').map((r) => [r.id, r.raw]));
  const added = [...b.keys()].filter((k) => !a.has(k));
  const removed = [...a.keys()].filter((k) => !b.has(k));
  const changed = [...b.keys()].filter((k) => a.has(k) && a.get(k) !== b.get(k));
  return { added, changed, removed };
}

/** Standing rule "no dependency without a SPEC decision", made mechanical: every package.json
 *  dependency must be named in a locked D-row. */
export function lintDependencies(specText, pkgText) {
  if (!pkgText) return [];
  const pkg = JSON.parse(pkgText);
  const decided = parseSpec(specText).filter((r) => r.id.startsWith('D-') && /^locked$/i.test(r.cells[1] || '')).map((r) => r.cells[0]).join(' ');
  return Object.keys({ ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}), ...(pkg.optionalDependencies || {}) })
    .filter((d) => !decided.includes(d)).map((d) => `dependency "${d}" is not named in any locked D-row of SPEC.md`);
}
