---
id: wave9c-5-publish-clean
paths: scripts/public-sync,package.json,SPEC.md,docs
base: main
status: merged
---

The public repository is checked before it is published. Every file it would hold refers to what it needs, and the sentences that are not ordinary wording go through a reviewed list.

Two things stopped the publication of the second version.

- The root package file pointed at a script that is never published, so the published tree referred to something it did not hold. That script is out of the root package file now, and the command that builds the release files is written down in the handoff notes instead.
- Three sentences of the history named the way this project is built and were not in the reviewed list of rewrites. They are in it now.

Two tests keep both true: the published tree refers to nothing it does not hold, and every such sentence of the history is in the list.
