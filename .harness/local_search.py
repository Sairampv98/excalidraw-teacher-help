"""Local, zero-token code search for this repository (MCP server for VS Code).

Searching locally costs zero tokens; only the few lines the editor actually needs
get sent to the model. Adapted from the token-saving harness for this fork:

  * the definition pattern understands TypeScript/JavaScript, not just Python;
  * the paths that are large or generated are skipped explicitly;
  * every result is capped, so no single call can flood the model.

Run it:
    .venv\\Scripts\\python .harness\\local_search.py

It waits silently for a client. Press Ctrl+C to stop it.
"""
import os
import subprocess
from mcp.server.fastmcp import FastMCP

mcp = FastMCP("local-search")
ROOT = os.getcwd()          # VS Code starts us in the project folder
MAX_CHARS = 4000            # hard cap on what goes back to the model
MAX_HITS_PER_FILE = 5

# Directories that are large, generated, or vendored. ripgrep already honours
# .gitignore, so this only needs what is NOT ignored.
EXCLUDE_GLOBS = [
    "!.harness",
    "!.venv",
    "!scripts/woff2",
    "!htr-sandbox",
    "!.mavis-snapbak",
    "!packages/excalidraw/types",
]


def _rg(args):
    r = subprocess.run(
        ["rg", "--no-heading", "-n", "--glob", "!.harness"] + EXCLUDE_GLOBS + args,
        cwd=ROOT,
        capture_output=True,
        text=True,
        stdin=subprocess.DEVNULL,   # without this, ripgrep waits forever (L7)
        timeout=20,
    )
    out = r.stdout.strip()
    if not out:
        return "no matches"
    if len(out) > MAX_CHARS:
        out = out[:MAX_CHARS] + "\n...(cut off - search for something more specific)"
    return out


@mcp.tool()
def search_code(pattern: str) -> str:
    """Search all project files for a word or regex. Returns file:line: text.
    Use this FIRST to find where something lives."""
    return _rg(["--max-count", str(MAX_HITS_PER_FILE), "-e", pattern, "."])


@mcp.tool()
def find_definition(name: str) -> str:
    """Find where a function, class, interface or const called `name` is defined."""
    pat = (
        r"(def|class|function|func|interface|struct|enum|type)\s+" + name + r"\b"
        r"|\b(const|let|var)\s+" + name + r"\b"
        r"|\bexport\s+(default\s+)?(async\s+)?function\s+" + name + r"\b"
        r"|\b" + name + r"\s*[:=]\s*(function|\(|async|=>)"
    )
    return _rg(["-e", pat, "."])


@mcp.tool()
def list_files(subfolder: str = ".") -> str:
    """List file paths (respects .gitignore). Use a subfolder to narrow it."""
    return _rg(["--files", subfolder])


@mcp.tool()
def read_lines(path: str, start: int, end: int) -> str:
    """Read only lines start..end of one file (max 150 lines at a time)."""
    end = min(end, start + 149)
    full = os.path.realpath(os.path.join(ROOT, path))
    if not full.startswith(os.path.realpath(ROOT)):
        return "path is outside the project"
    with open(full, encoding="utf-8", errors="replace") as f:
        lines = f.readlines()
    chunk = lines[start - 1:end]
    return "".join(f"{start + i}: {l}" for i, l in enumerate(chunk)) or "no lines there"


if __name__ == "__main__":
    mcp.run()
