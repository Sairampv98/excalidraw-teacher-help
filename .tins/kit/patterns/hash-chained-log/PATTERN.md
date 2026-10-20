---
id: hash-chained-log
solves: Tamper-evident event log — each entry stores the hash of the previous entry, so editing or deleting any past entry breaks verification from that point on.
triggers: hash chain, tamper-evident, tamper, audit trail, integrity, event log, blockchain
not_when: Nobody outside the system needs evidence of non-tampering — a plain append-only-ledger is enough.
status: candidate
consumers: builder-2 (ASSUMED, brief 2.2.2)
license: MIT, written for tins-kit
source: original
review_by: 2027-04-01
---
Entry = `{seq, prev, data}`; `hash = sha256(prev + canonicalJSON(data))`; first `prev` is 64 zeros.
Verify by recomputing from the start. Anchor the latest hash somewhere the writer cannot edit
(a signed tag, an email, a second system) or an attacker simply rewrites the whole chain.
Unverified: no module, no test. Second consumer needed before promotion.
