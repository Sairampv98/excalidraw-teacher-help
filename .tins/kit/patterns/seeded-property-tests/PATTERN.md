---
id: seeded-property-tests
solves: Property-based tests without a dependency — a tiny seeded PRNG generates many inputs, invariants are asserted, and the failing seed is printed so the case can be replayed.
triggers: property test, fuzz, random inputs, invariant, seed, generative testing
not_when: The input space is small enough to enumerate.
status: candidate
consumers: builder-2 (ASSUMED, brief 2.2.2)
license: MIT, written for tins-kit
source: original
review_by: 2027-04-01
---
mulberry32 (8 lines) seeded from `TEST_SEED` or a printed default; run N cases; on failure print
the seed and the case index. Unverified: no module, no test.
