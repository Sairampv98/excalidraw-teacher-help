---
id: v3a-4-public-lingo
paths: scripts/public-sync,scripts/ops,SPEC.md,docs/next.md,tasks/v3a-4-public-lingo.md
base: main
status: open
---

The public wording of comments and of commit messages is written by the author, alongside the private wording, when it is written (D-592 to D-594): a `public:` partner line under a comment that names the method, a `## Public` section in the task file, and warnings in the pre-gate when either is missing or out of date.

## Public

A comment in the source can carry a second line, in plain wording, that the public copy shows in place of the private note. A change can also describe itself for the public in its own description, and the author is warned before a check when that wording is missing or out of date.
