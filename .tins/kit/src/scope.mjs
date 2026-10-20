// Scope: which paths a session may change. Enforced on the git diff, not asked of the model.
export const PROTECTED = ['.tins/kit', 'tins.json', 'sessions', 'tasks'];

const norm = (p) => p.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
const under = (p, prefix) => prefix === '' || prefix === '.' || p === prefix || p.startsWith(prefix + '/');

/** allowed: null (= whole repo minus protected) or list of path prefixes. Returns violating paths. */
/** Written by kit commands themselves (`kit pattern add`); never counts against a task's scope (RF-9). */
export const KIT_MANAGED = ['.tins/patterns.lock'];

export function violations(paths, allowed) {
  const allow = allowed && allowed.length ? allowed.map(norm) : null;
  return paths.map(norm).filter((p) => !KIT_MANAGED.includes(p)).filter((p) => {
    const explicitly = allow && allow.some((a) => a !== '' && a !== '.' && under(p, a));
    if (PROTECTED.some((x) => under(p, x))) return !explicitly; // protected needs an explicit grant
    return allow ? !allow.some((a) => under(p, a)) : false;
  });
}

/** True if two scopes could touch the same file (used to refuse overlapping parallel tasks). */
export function overlaps(a, b) {
  const A = (a && a.length ? a : ['']).map(norm); const B = (b && b.length ? b : ['']).map(norm);
  return A.some((x) => B.some((y) => under(x, y) || under(y, x)));
}

/** A path from an untrusted source (relay reply) must be relative, inside the repo, no traversal. */
export function safeRelative(p) {
  const n = norm(String(p || ''));
  return !!n && !n.startsWith('/') && !/^[a-zA-Z]:/.test(n) && !n.split('/').some((s) => s === '..' || s === '') && !n.includes('\0');
}
