---
id: v3b-7a-win7-setup
paths: packages/vscode-bridge,excalidraw-app,packages/excalidraw/components/MirrorPanelSurface.tsx,packages/excalidraw/scene/panelFrames.ts,packages/excalidraw/types.ts,packages/excalidraw/locales/en.json,packages/excalidraw/tests/mirrorScreenCopy.test.tsx,installer,scripts/setup,scripts/ui/scenarios/editor-setup-dialog.mjs,docs,SPEC.md,.gitignore
base: main
status: open
---

The editor window on Windows 7 shows its picture by a screen copy.

On a Windows 7 machine with no graphics card the board could find the editor's window but not its picture. The extension now takes a copy of the screen as a fall-back. The setup window stays responsive while it works, an old bridge extension is updated, and the board names an extension that is too old. The dialog says plainly what to do next.
