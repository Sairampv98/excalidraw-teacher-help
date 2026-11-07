---
id: wave9h-1-offline-engines
paths: excalidraw-app/public,scripts/vendor,scripts/ui,scripts/clips,public,excalidraw-app/engines,excalidraw-app/bridge,excalidraw-app/ocr,excalidraw-app/sidebar,excalidraw-app/tests,excalidraw-app/vite.config.mts,excalidraw-app/package.json,.gitignore,.prettierignore,.eslintignore,SPEC.md,docs,tasks,sessions
base: main
status: merged
---

The PDF reader, the reading of words in a picture and Python in the browser load their engines from copies the app carries, so they work with no internet; the engine files are fetched once at build time and checked by their hashes.
