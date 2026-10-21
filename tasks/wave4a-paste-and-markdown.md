---
id: wave4a-paste-and-markdown
paths: packages/excalidraw,excalidraw-app,SPEC.md
read: SPEC.md,excalidraw-app/sidebar/insertIntoScene.ts,excalidraw-app/sidebar/DocumentsTab.tsx,excalidraw-app/App.tsx,packages/excalidraw/components/App.tsx,packages/excalidraw/types.ts,docs/superpowers/specs/2026-10-21-paste-and-markdown-design.md,docs/tins-tasks/wave4a-paste-and-markdown-brief.md,AGENTS.md,HANDOVER.md
base: main
status: merged
---

Wave 4a - the paste path and the markdown viewer text. Two of the owners nine observations. (1) A right-click paste of armed code must keep the code-card format: the armed paste is decided inside the library paste path through the existing props.onPaste hook, so the keyboard paste and the context menu paste behave identically, and the armed paste is consumed only when the clipboard still holds the stashed code. (2) Selecting prose in the markdown viewer copies it to the clipboard automatically, on the mouse-up or key-up that ends the selection, and a link text is covered by the same code. The design is docs/superpowers/specs/2026-10-21-paste-and-markdown-design.md and the build sheet is docs/tins-tasks/wave4a-paste-and-markdown-brief.md - read both before writing code. Add the locked rows D-17, D-18, D-19 and D-20 to SPEC.md together with the acceptance rows AC-23, AC-24 and AC-25.
