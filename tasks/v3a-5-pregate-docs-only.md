---
id: v3a-5-pregate-docs-only
paths: scripts/ops,SPEC.md,docs/next.md,tasks/v3a-5-pregate-docs-only.md
base: main
status: open
---

A change that touches documents only is checked in seconds (D-595): the pre-gate leaves out the typecheck and the tests of the code, and keeps the SPEC lint, prettier and the handoff test. Also: the decision not to rewrite the public history, and five more candidates for the kit's own improvement list.

## Public

The quick check run before a change is submitted now finishes in seconds when the change touches only documents.
