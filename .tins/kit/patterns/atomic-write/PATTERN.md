---
id: atomic-write
solves: A file is either the old version or the new version after a crash, never half-written — write a temp file in the same directory, fsync it, rename over the target, fsync the directory.
triggers: atomic write, save file, temp file, rename, fsync, crash, corruption, durable
not_when: Many writers update the same file concurrently (use a database or a lock file); appending to a log (see append-only-ledger); the target is on a network filesystem where rename is not atomic.
status: proven
consumers: builder-1 (ASSUMED, brief 2.2.2), builder-2 (ASSUMED, brief 2.2.2)
license: MIT, written for tins-kit
source: original
module: atomic-write.mjs
test: atomic-write.pattern-test.mjs
---
# Atomic file write

Use: `import { writeFileAtomic } from './atomic-write.mjs'; writeFileAtomic(path, text)`.

1. Temp file in the *same directory* (rename across filesystems is a copy, not atomic).
2. `fsync` the temp file before rename, or the rename can land before the data.
3. `rename` over the target. POSIX: atomic. Windows: `fs.renameSync` replaces; may fail with EPERM
   if another process holds the file open — the module retries briefly, then throws.
4. `fsync` the directory so the rename itself is durable (skipped on Windows, where it is unsupported).

What the test proves: a process killed mid-write (SIGKILL loop) never leaves a torn file.
What it does not prove: power-loss durability (needs a real power cut or a fault-injecting FS).
