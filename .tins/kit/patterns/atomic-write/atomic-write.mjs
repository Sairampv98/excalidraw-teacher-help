// Atomic file replace: temp + fsync + rename + dir fsync. Zero dependencies. See PATTERN.md.
import { openSync, writeSync, fsyncSync, closeSync, renameSync, unlinkSync } from 'node:fs';
import { dirname, basename, join } from 'node:path';
import { randomBytes } from 'node:crypto';

export function writeFileAtomic(path, data) {
  const dir = dirname(path);
  const tmp = join(dir, `.${basename(path)}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`);
  const fd = openSync(tmp, 'wx', 0o644);
  try {
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(String(data));
    let off = 0; while (off < buf.length) off += writeSync(fd, buf, off, buf.length - off);
    fsyncSync(fd);
  } catch (e) { closeSync(fd); try { unlinkSync(tmp); } catch {} throw e; }
  closeSync(fd);
  for (let i = 0; ; i++) {
    try { renameSync(tmp, path); break; } catch (e) {
      if (process.platform === 'win32' && (e.code === 'EPERM' || e.code === 'EACCES') && i < 10) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20 * (i + 1)); continue; }
      try { unlinkSync(tmp); } catch {} throw e;
    }
  }
  if (process.platform !== 'win32') { const d = openSync(dir, 'r'); try { fsyncSync(d); } finally { closeSync(d); } }
}
