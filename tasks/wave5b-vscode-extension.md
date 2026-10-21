---
id: wave5b-vscode-extension
paths: packages/vscode-bridge
read: SPEC.md,docs/tins-tasks/wave5b-vscode-bridge-brief.md,docs/superpowers/specs/2026-10-20-vscode-bridge-design.md,AGENTS.md,HANDOVER.md
base: main
status: open
---

Wave 5b-part-1 - the VS Code / VSCodium bridge EXTENSION and the .vsix. This is the half the owner can install and try by hand: the extension, the bridge server it runs, the shared protocol, and the packaging script that produces a .vsix. The app side - the panel that shows the mirrored editor, and the app client that connects to the bridge - is a separate task that comes after the panel foundation lands, because the panel element type is what displays it. So: packages/vscode-bridge ONLY. Do NOT touch packages/excalidraw, excalidraw-app, or SPEC.md - the decisions for the whole wave (D-50, D-51, D-52 and the acceptance rows) are recorded when the app side lands. The design is docs/superpowers/specs/2026-10-20-vscode-bridge-design.md and the build sheet is docs/tins-tasks/wave5b-vscode-bridge-brief.md - read both, and follow the discovery and security rules they set. THE DELIVERABLE IS A .vsix FILE the owner can install in BOTH VS Code and VSCodium by double-clicking it, so the packaging step must actually run and produce the file, and the report must say exactly where it is and what it is called. No new npm dependency in the extension: it has no runtime dependency of its own, and the .vsix is written by a script that writes the zip itself, with no packaging library.
