#!/usr/bin/env bash
#
# The setup: check what this machine is missing, and install it (D-152,
# AC-186).
#
# This is the script a teacher or a student runs on macOS or Linux. It does
# three things, in this order:
#
#   1. it REPORTS what it finds - every thing it checks, in plain words;
#   2. it ASKS before it installs anything on the machine;
#   3. it INSTALLS what is missing, and ends with a summary.
#
# It never installs software silently: without a flag it asks, with --yes it
# accepts the answers, and with --dry-run it reports and installs nothing at
# all.
#
# It needs no dependency of its own: bash and what is already on the machine.
# Checking never uses the network - only installing does.
#
# It is safe to run twice: everything it checks is idempotent, and a second
# run says "already there" rather than doing it again.
#
#   ./installer/setup.sh --dry-run
#   ./installer/setup.sh
#   ./installer/setup.sh --yes
#
# This is the faithful sibling of installer/setup.ps1: the same checks, the
# same rules, the same wording. The rules live in installer/lib/check.mjs, and
# the test pins the two scripts to it.
#
# `set -u` is deliberately NOT used: macOS still ships bash 3.2, where an
# empty array under `set -u` is an "unbound variable" error, and this script
# runs on exactly those machines.

set -o pipefail

YES=0
DRY_RUN=0

while [ $# -gt 0 ]; do
  case "$1" in
    --yes|-y)
      YES=1
      ;;
    --dry-run|--dryrun|-n)
      DRY_RUN=1
      ;;
    --help|-h)
      printf 'usage: %s [--yes] [--dry-run]\n' "$0"
      printf '  --dry-run  report only; install nothing at all\n'
      printf '  --yes      accept the defaults; do not ask\n'
      exit 0
      ;;
    *)
      printf 'setup: unknown option "%s" (try --help)\n' "$1" >&2
      exit 2
      ;;
  esac
  shift
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
EXTENSION_RELATIVE="packages/vscode-bridge/excalidraw-bridge-0.1.0.vsix"
EXTENSION_ID="excalidraw-teacher-help.excalidraw-bridge"
NODE_MINIMUM=20

# ---------------------------------------------------------------------------
# finding the facts
# ---------------------------------------------------------------------------

command_path() {
  command -v "$1" 2>/dev/null || true
}

# the version a command reported, or nothing when it is not there
tool_version() {
  local name="$1"
  local pattern="$2"
  shift 2

  local path output found

  path="$(command_path "$name")"

  if [ -z "$path" ]; then
    return 1
  fi

  output="$("$path" "$@" 2>&1 | head -n 1)"

  if [ -z "$output" ]; then
    return 1
  fi

  found="$(printf '%s' "$output" | grep -oE "$pattern" | head -n 1)"

  if [ -z "$found" ]; then
    return 1
  fi

  printf '%s' "$found"
}

# what the setup found for an editor: its CLI or its standard install path,
# and whether the extension is already installed in it
get_editor() {
  local cli="$1"
  shift

  local cli_path standard="" candidate installed="no"

  cli_path="$(command_path "$cli")"

  for candidate in "$@"; do
    if [ -n "$candidate" ] && [ -x "$candidate" ]; then
      standard="$candidate"
      break
    fi
  done

  if [ -n "$cli_path" ]; then
    if "$cli_path" --list-extensions 2>/dev/null | grep -qF "$EXTENSION_ID"; then
      installed="yes"
    fi
    printf '%s|%s' "$cli_path" "$installed"
  else
    printf '%s|%s' "$standard" "$installed"
  fi
}

# the checks and the things to install - the same rules as
# installer/lib/check.mjs, in bash: the setup has to run on a machine with no
# Node at all, and Node is one of the things it installs
get_plan() {
  local node_version yarn_version corepack_version
  node_version="$(tool_version node '[0-9]+\.[0-9]+\.[0-9]+' --version || true)"
  yarn_version="$(tool_version yarn '[0-9]+\.[0-9]+\.[0-9]+' --version || true)"
  corepack_version="$(tool_version corepack '[0-9]+\.[0-9]+\.[0-9]+' --version || true)"

  local vscode codium
  vscode="$(get_editor code \
    "/usr/share/code/code" \
    "/usr/bin/code" \
    "/snap/bin/code" \
    "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code")"
  codium="$(get_editor codium \
    "/usr/share/codium/codium" \
    "/usr/bin/codium" \
    "/snap/bin/codium" \
    "/Applications/VSCodium.app/Contents/Resources/app/bin/codium")"

  VSCODE_PATH="${vscode%|*}"
  VSCODE_INSTALLED="${vscode##*|}"
  CODIUM_PATH="${codium%|*}"
  CODIUM_INSTALLED="${codium##*|}"

  local extension_built="no" dependencies_installed="no"

  if [ -f "$REPO_ROOT/$EXTENSION_RELATIVE" ]; then
    extension_built="yes"
  fi

  if [ -d "$REPO_ROOT/node_modules" ]; then
    dependencies_installed="yes"
  fi

  local winget="no" brew="no"

  if command -v winget >/dev/null 2>&1; then
    winget="yes"
  fi

  if command -v brew >/dev/null 2>&1; then
    brew="yes"
  fi

  # the runtimes the panel's Run can execute
  local python_command="" python_version="" java_version=""
  python_command="$(command_path python3 || true)"

  if [ -z "$python_command" ]; then
    python_command="$(command_path python || true)"
  fi

  if [ -n "$python_command" ]; then
    python_version="$("$python_command" --version 2>&1 | head -n 1)"
  fi

  if command -v java >/dev/null 2>&1; then
    java_version="$(java -version 2>&1 | head -n 1)"
  fi

  local runtime_node="missing" runtime_python="missing" runtime_java="missing"

  if [ -n "$node_version" ]; then
    runtime_node="ok"
  fi

  if printf '%s' "$python_version" | grep -qE 'Python [0-9]+\.[0-9]+'; then
    runtime_python="ok"
  fi

  if printf '%s' "$java_version" | grep -qi 'version'; then
    runtime_java="ok"
  fi

  # --- the checks ---------------------------------------------------------
  local node_present="missing" node_text="Node.js is not on the PATH"

  if [ -n "$node_version" ]; then
    local node_major="${node_version%%.*}"
    if [ "$node_major" -ge "$NODE_MINIMUM" ] 2>/dev/null; then
      node_present="ok"
      node_text="$node_version ($NODE_MINIMUM or newer)"
    else
      node_text="Node.js $node_version is older than $NODE_MINIMUM, which the toolchain wants"
    fi
  fi

  local yarn_present="missing"
  local yarn_text="Yarn is not on the PATH and Corepack is not available to provide it"

  if [ -n "$yarn_version" ]; then
    yarn_present="ok"
    yarn_text="$yarn_version"
  elif [ -n "$corepack_version" ]; then
    yarn_present="ok"
    yarn_text="not on the PATH yet - Corepack $corepack_version can provide it"
  fi

  local vscode_present="missing"
  local vscode_text="VS Code was not found (no code command and no standard install path)"

  if [ -n "$VSCODE_PATH" ]; then
    vscode_present="ok"
    vscode_text="$VSCODE_PATH"
  fi

  local codium_present="missing"
  local codium_text="VSCodium was not found (no codium command and no standard install path)"

  if [ -n "$CODIUM_PATH" ]; then
    codium_present="ok"
    codium_text="$CODIUM_PATH"
  fi

  local extension_present="missing"
  local extension_text="the extension has not been built yet"

  if [ "$extension_built" = "yes" ]; then
    extension_present="ok"
    extension_text="$EXTENSION_RELATIVE is built"
  fi

  local dependencies_present="missing"
  local dependencies_text="the app's dependencies are not installed (no node_modules)"

  if [ "$dependencies_installed" = "yes" ]; then
    dependencies_present="ok"
    dependencies_text="node_modules is there"
  fi

  local runtimes_present="missing"
  local runtimes_text="node $runtime_node, python $runtime_python, java $runtime_java"

  if [ "$runtime_node" = "ok" ] && [ "$runtime_python" = "ok" ] && [ "$runtime_java" = "ok" ]; then
    runtimes_present="ok"
  fi

  CHECKS=(
    "node|Node.js|$node_present|$node_text"
    "yarn|Yarn|$yarn_present|$yarn_text"
    "vscode|VS Code|$vscode_present|$vscode_text"
    "vscodium|VSCodium|$codium_present|$codium_text"
    "extension|The extension|$extension_present|$extension_text"
    "dependencies|The app's dependencies|$dependencies_present|$dependencies_text"
    "runtimes|Runtimes for Run|$runtimes_present|$runtimes_text"
  )

  # --- what the setup would install ---------------------------------------
  ACTIONS=()

  if [ "$node_present" != "ok" ]; then
    if [ "$winget" = "yes" ]; then
      ACTIONS+=("node.install|Install Node.js|through winget|yes|")
    elif [ "$brew" = "yes" ]; then
      ACTIONS+=("node.install|Install Node.js|through brew|yes|")
    else
      ACTIONS+=("node.install|Install Node.js|no package manager is available, so this one is yours to do|no|Install Node.js $NODE_MINIMUM or newer from https://nodejs.org and run this script again.")
    fi
  fi

  if [ -z "$yarn_version" ] && [ -n "$corepack_version" ]; then
    ACTIONS+=("yarn.corepack|Enable Yarn through Corepack|Corepack $corepack_version is on the PATH|yes|")
  fi

  if [ "$extension_built" != "yes" ]; then
    if [ "$node_present" = "ok" ]; then
      ACTIONS+=("extension.build|Build the extension|$EXTENSION_RELATIVE|yes|")
    else
      ACTIONS+=("extension.build|Build the extension|$EXTENSION_RELATIVE|no|Node.js is needed to build the extension - install Node.js first, then run this script again.")
    fi
  fi

  if [ -n "$VSCODE_PATH" ] && [ "$VSCODE_INSTALLED" != "yes" ]; then
    ACTIONS+=("extension.install.vscode|Install the extension into VS Code|the editor does not have it yet|yes|")
  fi

  if [ -n "$CODIUM_PATH" ] && [ "$CODIUM_INSTALLED" != "yes" ]; then
    ACTIONS+=("extension.install.vscodium|Install the extension into VSCodium|the editor does not have it yet|yes|")
  fi

  # The editor itself, when it is not on the machine at all.
  if [ -z "$VSCODE_PATH" ]; then
    if [ "$brew" = "yes" ]; then
      ACTIONS+=("editor.install.vscode|Install VS Code|through brew|yes|")
    elif [ "$winget" = "yes" ]; then
      ACTIONS+=("editor.install.vscode|Install VS Code|through winget|yes|")
    else
      ACTIONS+=("editor.install.vscode|Install VS Code|no package manager is available, so this one is yours to do|no|Install VS Code from https://code.visualstudio.com and run this script again.")
    fi
  fi

  if [ -z "$CODIUM_PATH" ]; then
    if [ "$brew" = "yes" ]; then
      ACTIONS+=("editor.install.vscodium|Install VSCodium|through brew|yes|")
    elif [ "$winget" = "yes" ]; then
      ACTIONS+=("editor.install.vscodium|Install VSCodium|through winget|yes|")
    else
      ACTIONS+=("editor.install.vscodium|Install VSCodium|no package manager is available, so this one is yours to do|no|Install VSCodium from https://vscodium.com and run this script again.")
    fi
  fi

  if [ "$dependencies_installed" != "yes" ]; then
    if [ -n "$yarn_version" ] || [ -n "$corepack_version" ]; then
      ACTIONS+=("dependencies.install|Install the app's dependencies|with yarn, in the repository root|yes|")
    else
      ACTIONS+=("dependencies.install|Install the app's dependencies|with yarn, in the repository root|no|Yarn is needed to install the app's dependencies - install Yarn first, then run this script again.")
    fi
  fi

  if [ "$runtime_python" != "ok" ]; then
    if [ "$brew" = "yes" ]; then
      ACTIONS+=("runtime.python|Install Python|through brew|yes|")
    else
      ACTIONS+=("runtime.python|Install Python|brew is not on the PATH, so this one is yours to do|no|Install Python from https://excalidraw.com and run this script again.")
    fi
  fi

  if [ "$runtime_java" != "ok" ]; then
    if [ "$brew" = "yes" ]; then
      ACTIONS+=("runtime.java|Install Java|through brew|yes|")
    else
      ACTIONS+=("runtime.java|Install Java|brew is not on the PATH, so this one is yours to do|no|Install Java from https://excalidraw.com and run this script again.")
    fi
  fi
}

# ---------------------------------------------------------------------------
# the report
# ---------------------------------------------------------------------------

show_report() {
  local width=0
  local entry label

  for entry in "${CHECKS[@]}"; do
    label="$(printf '%s' "$entry" | cut -d'|' -f2)"

    if [ "${#label}" -gt "$width" ]; then
      width=${#label}
    fi
  done

  printf '\n'
  printf 'Excalidraw setup - what this machine already has\n'
  printf '\n'

  for entry in "${CHECKS[@]}"; do
    local state text
    state="$(printf '%s' "$entry" | cut -d'|' -f3)"
    label="$(printf '%s' "$entry" | cut -d'|' -f2)"
    text="$(printf '%s' "$entry" | cut -d'|' -f4-)"

    if [ "$state" = "ok" ]; then
      printf '  [%-7s] %-*s  %s\n' "$state" "$width" "$label" "$text"
    else
      printf '  [%-7s] %-*s  %s\n' "missing" "$width" "$label" "$text"
    fi
  done

  printf '\n'

  if [ "${#ACTIONS[@]}" -eq 0 ]; then
    printf 'What the setup would install: nothing - everything is already there.\n'
  else
    printf 'What the setup would install (%s):\n' "${#ACTIONS[@]}"

    local index=0

    for entry in "${ACTIONS[@]}"; do
      index=$((index + 1))

      local action_label action_detail action_automatic action_instruction
      action_label="$(printf '%s' "$entry" | cut -d'|' -f2)"
      action_detail="$(printf '%s' "$entry" | cut -d'|' -f3)"
      action_automatic="$(printf '%s' "$entry" | cut -d'|' -f4)"
      action_instruction="$(printf '%s' "$entry" | cut -d'|' -f5-)"

      printf '  %s. %s - %s\n' "$index" "$action_label" "$action_detail"

      if [ "$action_automatic" != "yes" ] && [ -n "$action_instruction" ]; then
        printf '     %s\n' "$action_instruction"
      fi
    done
  fi
}

summary_text() {
  local missing=0 present=0 entry state

  for entry in "${CHECKS[@]}"; do
    state="$(printf '%s' "$entry" | cut -d'|' -f3)"

    if [ "$state" = "ok" ]; then
      present=$((present + 1))
    else
      missing=$((missing + 1))
    fi
  done

  if [ "$missing" -eq 0 ]; then
    printf 'Summary: all %s checks are already in place. Nothing to install.\n' "${#CHECKS[@]}"
    return
  fi

  local verb="are" noun="things"

  if [ "$missing" -eq 1 ]; then
    verb="is"
  fi

  if [ "${#ACTIONS[@]}" -eq 1 ]; then
    noun="thing"
  fi

  printf 'Summary: %s of %s checks are already in place, %s %s missing. %s %s would be installed.\n' \
    "$present" "${#CHECKS[@]}" "$missing" "$verb" "${#ACTIONS[@]}" "$noun"
}

# ---------------------------------------------------------------------------
# the run
# ---------------------------------------------------------------------------

printf '\n'
printf 'Excalidraw setup\n'
printf 'Checking what this machine has. Nothing is installed until you say so.\n'

get_plan
show_report
printf '\n'

# --- the dry run stops here ------------------------------------------------
# Everything below this line installs software. The guard above it is what
# makes --dry-run install nothing at all.
if [ "$DRY_RUN" -eq 1 ]; then
  printf 'Dry run: nothing was installed.\n'
  summary_text
  printf '\n'
  exit 0
fi

# --- nothing to do ----------------------------------------------------------
if [ "${#ACTIONS[@]}" -eq 0 ]; then
  printf 'Everything is already there. Nothing to install.\n'
  summary_text
  printf '\n'
  exit 0
fi

# --- ask ---------------------------------------------------------------------
if [ "$YES" -ne 1 ]; then
  if [ ! -t 0 ]; then
    printf 'There is no terminal to ask on, so nothing was installed. Run it again with --yes, or with --dry-run.\n'
    summary_text
    printf '\n'
    exit 0
  fi

  printf 'Install %s thing(s) now? [Y/n] ' "${#ACTIONS[@]}"
  read -r answer

  case "$(printf '%s' "$answer" | tr '[:upper:]' '[:lower:]')" in
    ""|y|yes)
      ;;
    *)
      printf 'Nothing was installed.\n'
      summary_text
      printf '\n'
      exit 0
      ;;
  esac
fi

# ---------------------------------------------------------------------------
# the installing
# ---------------------------------------------------------------------------

# The paths the installing needs. They live here, below the dry-run guard, so
# that nothing above the guard can install anything.
EXTENSION_FILE="$REPO_ROOT/$EXTENSION_RELATIVE"
BUILD_SCRIPT="$REPO_ROOT/packages/vscode-bridge/scripts/build-vsix.mjs"

installed=()

for entry in "${ACTIONS[@]}"; do
  action_id="$(printf '%s' "$entry" | cut -d'|' -f1)"
  action_label="$(printf '%s' "$entry" | cut -d'|' -f2)"
  action_automatic="$(printf '%s' "$entry" | cut -d'|' -f4)"
  action_instruction="$(printf '%s' "$entry" | cut -d'|' -f5-)"

  if [ "$action_automatic" != "yes" ]; then
    printf '\n-> %s - this one is yours to do\n' "$action_label"
    printf '   %s\n' "$action_instruction"
    continue
  fi

  printf '\n-> %s\n' "$action_label"

  case "$action_id" in
    node.install)
      if command -v winget >/dev/null 2>&1; then
        winget install --id OpenJS.NodeJS --accept-source-agreements --accept-package-agreements
      else
        brew install node
      fi
      installed+=("Node.js")
      ;;
    yarn.corepack)
      corepack enable
      installed+=("Yarn")
      ;;
    extension.build)
      node "$BUILD_SCRIPT"
      installed+=("the extension")
      ;;
    extension.install.vscode)
      "$VSCODE_PATH" --install-extension "$EXTENSION_FILE" --force
      installed+=("the extension in VS Code")
      ;;
    extension.install.vscodium)
      "$CODIUM_PATH" --install-extension "$EXTENSION_FILE" --force
      installed+=("the extension in VSCodium")
      ;;
    dependencies.install)
      (cd "$REPO_ROOT" && yarn install --frozen-lockfile)
      installed+=("the app's dependencies")
      ;;
    runtime.python)
      brew install python@3.12
      installed+=("Python")
      ;;
    runtime.java)
      brew install --cask temurin
      installed+=("Java")
      ;;
    editor.install.vscode)
      if command -v winget >/dev/null 2>&1; then
        winget install --id Microsoft.VisualStudioCode --accept-source-agreements --accept-package-agreements
      else
        brew install --cask visual-studio-code
      fi
      installed+=("VS Code")
      ;;
    editor.install.vscodium)
      if command -v winget >/dev/null 2>&1; then
        winget install --id VSCodium.VSCodium --accept-source-agreements --accept-package-agreements
      else
        brew install --cask vscodium
      fi
      installed+=("VSCodium")
      ;;
  esac
done

# ---------------------------------------------------------------------------
# the summary
# ---------------------------------------------------------------------------

printf '\n'
printf 'What was installed:\n'

if [ "${#installed[@]}" -eq 0 ]; then
  printf '  nothing\n'
else
  for item in "${installed[@]}"; do
    printf '  %s\n' "$item"
  done
fi

get_plan
show_report
printf '\n'
summary_text
printf '\n'
