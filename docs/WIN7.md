# Windows 7

There is a setup for Windows 7 **with Service Pack 1**, 32 and 64 bit (`ClassroomSetup-Win7.exe` and its `payload` folder). It is tried on a clean Windows 7 Professional with Service Pack 1, from the 32-bit and from the 64-bit disc.

## What it puts in

Everything is 32-bit, which runs on both kinds of Windows 7. It is the set of the last versions that run on Windows 7:

|  |  |
| --- | --- |
| The board | the same app, in **Chromium 109** (the last Chromium for Windows 7), which the setup unpacks beside it; your own browser is not changed |
| VSCodium (the editor) | 1.70.2, with the connection to the board; the MIT-licensed build of VS Code, installed for you alone |
| Python | 3.8.10 |
| Java | 8 (Temurin) |
| C and C++ | GCC 16.2 (32-bit) |
| Node.js | 12.22.12 |
| Windows updates | the servicing stack and the convenience rollup for Windows 7 (they bring the universal C runtime that Python 3.8 asks for) |

## How to use it

1. Copy the **whole folder** (the setup and the `payload` folder beside it) to the computer, or run it from the disc or the stick it came on. The setup is small because the files are beside it: a 32-bit program cannot open a single file of a gigabyte or more.
2. Run `ClassroomSetup-Win7.exe` and click through. It asks Windows for an administrator once, for the Windows updates; the editor is installed for you alone and asks for nothing.
3. If it put in a Windows update, its last page says **Restart Windows to finish**. Restart, then run the setup again: it puts in Python, which needs the update. The tools that are already in place stay.
4. To take it away: **Uninstall** in the Start menu, or `Uninstall.exe` in the install folder. It lists what was installed with a tick for each, so one tool can be taken away and the rest kept (`Uninstall.exe /silent /remove=python` does the same from a script).

The install folder is `%LOCALAPPDATA%\Programs\ExcalidrawClassroom` (no space in its name: the C compiler cannot work from a path that has one; if you choose a folder with a space, the compiler is put in `C:\ClassroomTools` instead, and the uninstall removes it).

## What it needs

Windows 7 **Service Pack 1** (build 7601). Without it the setup says so and stops; install Service Pack 1 first (Windows Update, or the file from Microsoft).

## What does not work on Windows 7

- **The assistant** (the MCP server): it needs a newer Node.js than Windows 7 can run. The setup's first screen says so before anything is chosen.
- **The picture of the editor's window** in the board says "Waiting for the editor's window": the helper scripts for it need PowerShell 3, and Windows 7 has 2. The text of the open file is mirrored all the same. A small update will fix this.
- **The better text reader (Indra OCR)** is not in this setup (it needs Python 3.12). The reader built into the board needs no Python.
- Windows 7 itself is no longer updated by Microsoft. Use this setup on a computer that is not on a network you do not trust.

## Pen tablets

See the note in [INSTALL.md](./INSTALL.md): a tablet works as a mouse with no driver; the maker's driver adds pressure.
