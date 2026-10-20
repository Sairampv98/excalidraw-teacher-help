---
id: pure-core-cli-contract
solves: Testable command-line tools — a pure core that takes inputs (including the clock and environment) as arguments, a thin shell that does I/O, and a documented exit-code contract (0 ok, 1 domain failure, 2 usage error).
triggers: cli, command line, exit code, injectable clock, testability, deterministic, side effects
not_when: A one-off script nobody will test.
status: candidate
consumers: builder-1 (ASSUMED, brief 2.2.2)
license: MIT, written for tins-kit
source: original
review_by: 2027-04-01
---
`core(args, { now, env, readFile })` returns `{ code, stdout, stderr }`; `main()` is the only place
that touches `process`. Tests call `core` with a fixed clock. Exit codes go in SPEC.md as acceptance
rows. Unverified: no module, no test.
