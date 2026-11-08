---
id: wave10a-1-gui-installer
paths: installer,scripts/release,scripts/env,packages/vscode-bridge/tests/offline.test.ts,package.json,.gitignore,.prettierignore,.eslintignore,SPEC.md,docs,tasks,sessions
base: main
status: open
---

Setups for Windows with a click-through wizard: one for Windows 10 and 11 (the whole classroom, and a smaller one for students that carries the tools alone), a small one that downloads what it installs and checks the hash of every file, and one for Windows 7 with Service Pack 1, 32 and 64 bit. The tools (Python, Java, Node, C and C++, VS Code) go in for the user alone with no administrator rights (Windows 7 asks for one for its updates and the editor). Repairs found by trying them on clean machines: the C compiler could not work from a folder with a space in its path, the uninstaller now takes out everything it put in and the PATH comes back as it was, Enter on the first page no longer removes the program, a tool that cannot be installed is named and gives exit code 4, and the board window fits a small screen.
