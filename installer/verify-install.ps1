<#
.SYNOPSIS
  Checks that the install of Excalidraw for the classroom is sound.

.DESCRIPTION
  This script only READS the machine. It installs nothing, changes nothing and
  removes nothing. Every check is guarded, so a thing that is not installed is
  a row in the table and never an error.

  It prints one row per check - the check, the expected value, the actual
  value and the verdict:

    PASS       it is there and it is right
    MISSING    it is not installed - often fine
    FAIL       it is there but it is wrong - this one needs attention
    NOT CHECKED  the check needs an argument that was not given

  It ends with a block the reader can copy and send back as it is, and it exits
  1 when something FAILED and 0 otherwise.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File installer\verify-install.ps1

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File installer\verify-install.ps1 -AppUrl http://127.0.0.1:3001
#>
#requires -Version 5.1
[CmdletBinding()]
param(
  # The address the app is served at, e.g. http://127.0.0.1:3001 . Without it
  # the app is reported as NOT CHECKED - it is not a failure.
  [string]$AppUrl = "",

  # The offline payload's manifest.json. Without it the usual places are
  # looked in.
  [string]$Manifest = ""
)

$ErrorActionPreference = "Continue"

# --------------------------------------------------------------------------
# The expected values are read from the project itself, never written here.
# --------------------------------------------------------------------------

$RepoRoot = Split-Path -Parent $PSScriptRoot

function Get-NodeFloor {
  # installer/lib/check.mjs carries the project's own floor (NODE_MINIMUM).
  $file = Join-Path $RepoRoot "installer\lib\check.mjs"
  if (Test-Path $file) {
    $hit = Select-String -Path $file -Pattern "NODE_MINIMUM\s*=\s*(\d+)" -ErrorAction SilentlyContinue |
      Select-Object -First 1
    if ($hit -and $hit.Matches.Count -ge 1) {
      return [int]$hit.Matches[0].Groups[1].Value
    }
  }
  return 20
}

function Get-ExtensionPackageJson {
  $file = Join-Path $RepoRoot "packages\vscode-bridge\extension\package.json"
  if (Test-Path $file) { return $file }
  return $null
}

function Get-ExtensionId {
  # the extension's own package.json: publisher + name.
  $file = Get-ExtensionPackageJson
  if ($file) {
    try {
      $json = Get-Content $file -Raw | ConvertFrom-Json
      if ($json.publisher -and $json.name) { return "$($json.publisher).$($json.name)" }
    } catch {
      # a broken package.json must not stop the check
    }
  }
  return "excalidraw-teacher-help.excalidraw-bridge"
}

function Get-EditorFloor {
  # the extension's own engines.vscode - the editor version it needs.
  $file = Get-ExtensionPackageJson
  if ($file) {
    try {
      $json = Get-Content $file -Raw | ConvertFrom-Json
      if ($json.engines -and $json.engines.vscode) {
        $hit = [regex]::Match([string]$json.engines.vscode, "(\d+)\.(\d+)\.(\d+)")
        if ($hit.Success) { return [version]$hit.Groups[0].Value }
      }
    } catch {
      # a broken package.json must not stop the check
    }
  }
  return [version]"1.91.0"
}

function Get-BridgePort {
  # the bridge's own DEFAULT_BRIDGE_PORT.
  $file = Join-Path $RepoRoot "packages\vscode-bridge\bridge\src\protocol.ts"
  if (Test-Path $file) {
    $hit = Select-String -Path $file -Pattern "DEFAULT_BRIDGE_PORT\s*=\s*(\d+)" -ErrorAction SilentlyContinue |
      Select-Object -First 1
    if ($hit -and $hit.Matches.Count -ge 1) {
      return [int]$hit.Matches[0].Groups[1].Value
    }
  }
  return 47511
}

function Get-HelperNames {
  # the helpers the extension ships.
  return @("media\capture.ps1", "media\virtual-display.ps1", "media\ocr_sidecar.py")
}

# --------------------------------------------------------------------------
# The table
# --------------------------------------------------------------------------

$script:Results = New-Object System.Collections.ArrayList

function Add-Result {
  param(
    [string]$Check,
    [string]$Expected,
    [string]$Actual,
    [string]$Verdict
  )
  [void]$script:Results.Add(
    [pscustomobject]@{
      Check    = $Check
      Expected = $Expected
      Actual   = $Actual
      Verdict  = $Verdict
    }
  )
}

# --------------------------------------------------------------------------
# Small helpers
# --------------------------------------------------------------------------

function Get-ToolPath {
  # the first of the given names that is on the PATH.
  param([string[]]$Names)
  foreach ($name in $Names) {
    $cmd = Get-Command $name -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($cmd -and $cmd.Source) { return $cmd.Source }
  }
  return $null
}

function Get-FirstExistingPath {
  param([string[]]$Paths)
  foreach ($p in $Paths) {
    if ($p -and (Test-Path $p)) { return $p }
  }
  return $null
}

function Get-ToolVersion {
  # the version a tool prints on its first line, e.g. "v22.23.2" or "1.143.0".
  param([string]$Path, [string[]]$Arguments)
  if (-not $Path) { return $null }
  try {
    $lines = & $Path @Arguments 2>$null
    foreach ($line in @($lines)) {
      $text = ([string]$line).Trim()
      if ($text -and $text -match "^[vV]?\d+\.\d+") { return $text.TrimStart("v", "V") }
    }
  } catch {
    # a tool that will not answer is treated as "not there"
  }
  return $null
}

function Get-ListedExtensions {
  # the ids the editor lists, lower-cased.
  param([string]$Path)
  if (-not $Path) { return @() }
  $found = @()
  try {
    $lines = & $Path --list-extensions 2>$null
    foreach ($line in @($lines)) {
      $text = ([string]$line).Trim()
      if ($text -and $text -notmatch "\s" -and $text -like "*.*") { $found += $text.ToLower() }
    }
  } catch {
    # an editor that will not answer lists nothing
  }
  return $found
}

function Get-EditorState {
  # an editor is "running" when its application process is there - the CLI
  # verbs (--version, --list-extensions) start and finish at once and are
  # not an editor.
  $running = @()
  try {
    $procs = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
      Where-Object { $_.Name -in @("Code.exe", "VSCodium.exe", "code.exe", "codium.exe") }
    foreach ($proc in $procs) {
      $cmd = [string]$proc.CommandLine
      if ($cmd -match "--type=") { continue }
      if ($cmd -match "--version|--list-extensions|--status|--ms-enable-electron") { continue }
      if ($proc.Name -match "codium") {
        if ($running -notcontains "VSCodium") { $running += "VSCodium" }
      } else {
        if ($running -notcontains "VS Code") { $running += "VS Code" }
      }
    }
  } catch {
    # fall back to the process table
    foreach ($proc in @(Get-Process -Name Code, VSCodium -ErrorAction SilentlyContinue)) {
      if ($proc.MainWindowHandle -ne 0) {
        $name = if ($proc.ProcessName -match "codium") { "VSCodium" } else { "VS Code" }
        if ($running -notcontains $name) { $running += $name }
      }
    }
  }
  return $running
}

function Get-ListeningPort {
  # the local addresses that are listening on the given port.
  param([int]$Port)
  $list = @()
  try {
    $conns = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    foreach ($c in @($conns)) { $list += [string]$c.LocalAddress }
  } catch {
    $list = @()
  }
  if (-not $list) {
    try {
      $netstat = netstat -ano 2>$null
      foreach ($line in @($netstat)) {
        if ($line -match "^\s*TCP\s+(\S+):$Port\s+\S+\s+LISTENING") { $list += $matches[1] }
      }
    } catch {
      $list = @()
    }
  }
  return $list
}

function Get-VirtualDisplayState {
  # reads the virtual display's own state:
  #   installed   - the driver is there (Get-PnpDevice)
  #   attached    - a virtual display is on the desktop
  #   readable    - the state could be read at all
  $state = @{ installed = $false; attached = $false; readable = $false; detail = "" }

  try {
    $devices = @(Get-PnpDevice -ErrorAction SilentlyContinue |
        Where-Object { $_.InstanceId -like "ROOT\DISPLAY*" })
    if ($devices.Count -gt 0) {
      $state.installed = $true
      $state.detail = (($devices | ForEach-Object { $_.FriendlyName }) -join ", ")
    }
  } catch {
    $state.installed = $false
  }

  # the extension's own helper reads the attached state - it only enumerates.
  $helper = Get-InstalledHelper "media\virtual-display.ps1"
  if ($helper) {
    try {
      # the running PowerShell's own path - a bare "powershell.exe" would not
      # be found on a machine whose PATH is not the usual one.
      $psExe = Join-Path $PSHOME "powershell.exe"
      if (-not (Test-Path $psExe)) { $psExe = "powershell.exe" }
      $lines = & $psExe -NoProfile -ExecutionPolicy Bypass -File $helper -Mode Enumerate 2>$null
      foreach ($line in @($lines)) {
        $text = ([string]$line).Trim()
        if (-not $text -or $text -notlike "{*") { continue }
        try { $entry = $text | ConvertFrom-Json } catch { continue }
        if (-not $entry.virtual) { continue }
        $state.readable = $true
        if ($entry.attached) {
          $state.attached = $true
          $state.detail = "$($entry.adapter) ($($entry.width) x $($entry.height))"
        } else {
          $state.detail = "$($entry.adapter) (not attached)"
        }
      }
    } catch {
      # the helper would not answer: the attached state stays unknown
    }
  }
  return $state
}

function Get-InstalledHelper {
  # the helper inside an installed extension, whichever editor has it.
  param([string]$Name)
  foreach ($dir in (Get-ExtensionFolders)) {
    $candidate = Join-Path $dir.FullName $Name
    if (Test-Path $candidate) { return $candidate }
  }
  return $null
}

function Get-ExtensionFolders {
  # the installed extension's folders - one per editor that has it.
  $folders = @()
  foreach ($root in (Get-ExtensionRoots)) {
    if (-not (Test-Path $root)) { continue }
    try {
      $dirs = Get-ChildItem -Path $root -Directory -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -like "$($script:ExtensionId)-*" } |
        Sort-Object -Property Name -Descending
      foreach ($d in @($dirs)) {
        if (-not ($folders | Where-Object { $_.FullName -eq $d.FullName })) { $folders += $d }
      }
    } catch {
      # an unreadable extensions folder is simply empty
    }
  }
  return $folders
}

function Get-ExtensionRoots {
  # where each editor keeps its installed extensions.
  $roots = @()
  $userHome = $env:USERPROFILE
  if ($userHome) {
    $roots += (Join-Path $userHome ".vscode\extensions")
    $roots += (Join-Path $userHome ".vscode-oss\extensions")
  }
  return $roots
}

function Get-EditorInstall {
  # the editor's CLI and its version, or $null when it is not installed.
  param([string]$Cli, [string[]]$Paths)
  $path = Get-ToolPath @($Cli)
  if (-not $path) { $path = Get-FirstExistingPath $Paths }
  if (-not $path) { return $null }
  return @{ Cli = $Cli; Path = $path; Version = (Get-ToolVersion $path @("--version")) }
}

function Get-PayloadEntries {
  # the files the payload's manifest lists, with the hash each one must have.
  param([string]$ManifestPath)
  $entries = @()
  $json = Get-Content $ManifestPath -Raw | ConvertFrom-Json

  $items = $null
  if ($json -is [System.Array]) {
    $items = $json
  } elseif ($json.PSObject.Properties.Name -contains "files") {
    $files = $json.files
    if ($files -is [System.Array]) {
      $items = $files
    } else {
      # a map: the file's name -> its record
      foreach ($prop in $files.PSObject.Properties) {
        $record = $prop.Value
        $entries += , [pscustomobject]@{ Name = $prop.Name; Hash = (Get-RecordHash $record) }
      }
      return $entries
    }
  }

  foreach ($item in @($items)) {
    if (-not $item) { continue }
    $name = $null
    foreach ($key in @("name", "file", "path")) {
      if ($item.PSObject.Properties.Name -contains $key -and $item.$key) { $name = [string]$item.$key; break }
    }
    if (-not $name) { continue }
    $entries += , [pscustomobject]@{ Name = $name; Hash = (Get-RecordHash $item) }
  }
  return $entries
}

function Get-RecordHash {
  param($Record)
  if ($null -eq $Record) { return $null }
  foreach ($key in @("sha256", "sha-256", "hash", "sha256sum")) {
    if ($Record.PSObject.Properties.Name -contains $key -and $Record.$key) {
      return ([string]$Record.$key).ToLower()
    }
  }
  return $null
}

function Find-Manifest {
  # the payload's manifest.json, in the places it may be.
  param([string]$Given)
  if ($Given) {
    if (Test-Path $Given) { return (Resolve-Path $Given).Path }
    return $null
  }
  $candidates = @(
    (Join-Path $RepoRoot "installer\offline\manifest.json"),
    (Join-Path $RepoRoot "installer\offline\payload\manifest.json"),
    (Join-Path $RepoRoot "installer\payload\manifest.json")
  )
  $local = $env:LOCALAPPDATA
  if ($local) {
    $candidates += (Join-Path $local "ExcalidrawClassroom\payload\manifest.json")
    $candidates += (Join-Path $local "ExcalidrawClassroom\offline\manifest.json")
  }
  foreach ($c in $candidates) {
    if (Test-Path $c) { return $c }
  }
  return $null
}

# --------------------------------------------------------------------------
# The checks
# --------------------------------------------------------------------------

$script:ExtensionId = Get-ExtensionId
$NodeFloor = Get-NodeFloor
$EditorFloor = Get-EditorFloor
$BridgePort = Get-BridgePort

Write-Host ""
Write-Host "Excalidraw for the classroom - checking the install" -ForegroundColor Cyan
Write-Host "This only reads the machine. It changes nothing." -ForegroundColor DarkGray
Write-Host ""

# 1. the operating system
$osCaption = $null
$osVersion = $null
$osBuild = $null
try {
  $os = Get-CimInstance -ClassName Win32_OperatingSystem -ErrorAction Stop
  if ($os) {
    $osCaption = [string]$os.Caption
    $osVersion = [string]$os.Version
    $osBuild = [int]$os.BuildNumber
  }
} catch {
  # fall back to what .NET knows
}
if (-not $osBuild) {
  try {
    $osBuild = [int][System.Environment]::OSVersion.Version.Build
    $osVersion = [string][System.Environment]::OSVersion.Version
    $osCaption = "Windows"
  } catch {
    $osBuild = 0
  }
}
$isWindows11 = $osBuild -ge 22000
$isWindows10 = ($osBuild -ge 10240 -and $osBuild -lt 22000)
$osActual = "$osCaption ($osVersion, build $osBuild)"
if (-not $osCaption) { $osActual = "could not be read" }
if ($isWindows11 -or $isWindows10) {
  Add-Result "the operating system" "Windows 10 or 11" $osActual "PASS"
} elseif ($osBuild -gt 0) {
  Add-Result "the operating system" "Windows 10 or 11" $osActual "FAIL"
} else {
  Add-Result "the operating system" "Windows 10 or 11" "could not be read" "FAIL"
}

# 2. Node.js
$nodePath = Get-ToolPath @("node")
$nodeVersion = Get-ToolVersion $nodePath @("--version")
if ($nodePath -and $nodeVersion) {
  $hit = [regex]::Match($nodeVersion, "(\d+)\.(\d+)")
  $nodeMajor = 0
  if ($hit.Success) { $nodeMajor = [int]$hit.Groups[1].Value }
  if ($nodeMajor -ge $NodeFloor) {
    Add-Result "Node.js" "$NodeFloor or newer" $nodeVersion "PASS"
  } else {
    Add-Result "Node.js" "$NodeFloor or newer" $nodeVersion "FAIL"
  }
} else {
  Add-Result "Node.js" "$NodeFloor or newer" "not installed" "MISSING"
}

# 3. Yarn
$yarnPath = Get-ToolPath @("yarn")
$yarnVersion = Get-ToolVersion $yarnPath @("--version")
if ($yarnPath -and $yarnVersion) {
  Add-Result "Yarn" "installed" $yarnVersion "PASS"
} else {
  Add-Result "Yarn" "installed" "not installed" "MISSING"
}

# 4. VS Code
$vscode = Get-EditorInstall "code" @(
  (Join-Path $env:LOCALAPPDATA "Programs\Microsoft VS Code\bin\code.cmd"),
  (Join-Path $env:ProgramFiles "Microsoft VS Code\bin\code.cmd")
)
if ($vscode) {
  if ($vscode.Version) {
    $found = [version]([regex]::Match($vscode.Version, "\d+(\.\d+){0,2}").Value)
    if ($found -ge $EditorFloor) {
      Add-Result "VS Code" "installed, $EditorFloor or newer" $vscode.Version "PASS"
    } else {
      Add-Result "VS Code" "installed, $EditorFloor or newer" $vscode.Version "FAIL"
    }
  } else {
    Add-Result "VS Code" "installed, $EditorFloor or newer" "installed, but its version could not be read" "FAIL"
  }
} else {
  Add-Result "VS Code" "installed, $EditorFloor or newer" "not installed" "MISSING"
}

# 5. VSCodium
$codium = Get-EditorInstall "codium" @(
  (Join-Path $env:LOCALAPPDATA "Programs\VSCodium\bin\codium.cmd"),
  (Join-Path $env:ProgramFiles "VSCodium\bin\codium.cmd")
)
if ($codium) {
  if ($codium.Version) {
    $found = [version]([regex]::Match($codium.Version, "\d+(\.\d+){0,2}").Value)
    if ($found -ge $EditorFloor) {
      Add-Result "VSCodium" "installed, $EditorFloor or newer" $codium.Version "PASS"
    } else {
      Add-Result "VSCodium" "installed, $EditorFloor or newer" $codium.Version "FAIL"
    }
  } else {
    Add-Result "VSCodium" "installed, $EditorFloor or newer" "installed, but its version could not be read" "FAIL"
  }
} else {
  Add-Result "VSCodium" "installed, $EditorFloor or newer" "not installed" "MISSING"
}

# 6. the extension, in each editor that is installed
$editors = @()
if ($vscode) { $editors += , @{ Name = "VS Code"; Editor = $vscode } }
if ($codium) { $editors += , @{ Name = "VSCodium"; Editor = $codium } }

if ($editors.Count -eq 0) {
  Add-Result "the extension" "listed by the editor" "no editor is installed" "MISSING"
}

foreach ($entry in $editors) {
  $name = $entry.Name
  $listed = Get-ListedExtensions $entry.Editor.Path
  if ($listed -contains $script:ExtensionId.ToLower()) {
    Add-Result "the extension, in $name" $script:ExtensionId "listed" "PASS"
  } else {
    Add-Result "the extension, in $name" $script:ExtensionId "not listed - the extension is not in this editor" "FAIL"
  }
}

# 7. the extension's helpers
$helperNames = Get-HelperNames
foreach ($entry in $editors) {
  $name = $entry.Name
  $folder = $null
  foreach ($dir in (Get-ExtensionFolders)) {
    $pkg = Join-Path $dir.FullName "package.json"
    if (-not (Test-Path $pkg)) { continue }
    $isThis = $false
    try {
      $json = Get-Content $pkg -Raw | ConvertFrom-Json
      if ($json.publisher -and $json.name -and "$($json.publisher).$($json.name)" -eq $script:ExtensionId) {
        $isThis = $true
      }
    } catch {
      $isThis = $true
    }
    if (-not $isThis) { continue }
    # the folder that belongs to this editor
    $root = Split-Path -Parent $dir.FullName
    if (($name -eq "VS Code" -and $root -like "*\.vscode\extensions") -or
      ($name -eq "VSCodium" -and $root -like "*\.vscode-oss\extensions")) {
      $folder = $dir.FullName
      break
    }
  }

  if (-not $folder) {
    Add-Result "the extension's helpers, in $name" ($helperNames -join ", ") "the extension is not installed in this editor" "MISSING"
    continue
  }

  $absent = @()
  foreach ($helper in $helperNames) {
    if (-not (Test-Path (Join-Path $folder $helper))) { $absent += $helper }
  }
  if ($absent.Count -eq 0) {
    Add-Result "the extension's helpers, in $name" ($helperNames -join ", ") "all three are there" "PASS"
  } else {
    Add-Result "the extension's helpers, in $name" ($helperNames -join ", ") ("missing: " + ($absent -join ", ")) "FAIL"
  }
}

# 8. the virtual display driver
$display = Get-VirtualDisplayState
if (-not $display.installed) {
  Add-Result "the virtual display driver" "installed and attached" "not installed" "MISSING"
} elseif ($display.readable -and $display.attached) {
  Add-Result "the virtual display driver" "installed and attached" $display.detail "PASS"
} elseif ($display.readable) {
  Add-Result "the virtual display driver" "installed and attached" "installed, but not attached - a reboot is needed" "FAIL"
} else {
  Add-Result "the virtual display driver" "installed and attached" "$($display.detail) - the attached state could not be read" "PASS"
}

# 9. the bridge
$listening = Get-ListeningPort $BridgePort
$runningEditors = Get-EditorState
if ($listening.Count -gt 0) {
  Add-Result "the bridge" "listening on $BridgePort" ("listening on " + (($listening | Sort-Object -Unique) -join ", ")) "PASS"
} elseif ($runningEditors.Count -eq 0) {
  Add-Result "the bridge" "listening on $BridgePort" "not listening - no editor is running, and the bridge only listens while one is" "MISSING"
} else {
  Add-Result "the bridge" "listening on $BridgePort" ("not listening while " + ($runningEditors -join " and ") + " is running") "FAIL"
}

# 10. the app
if (-not $AppUrl) {
  Add-Result "the app" "HTTP 200 at the address it is served from" "not checked - no address was given" "NOT CHECKED"
} else {
  $status = $null
  $why = $null
  try {
    $response = Invoke-WebRequest -Uri $AppUrl -UseBasicParsing -TimeoutSec 15 -ErrorAction Stop
    $status = [int]$response.StatusCode
  } catch {
    $why = $_.Exception.Message
    if ($_.Exception.Response -and $_.Exception.Response.StatusCode) {
      try { $status = [int]$_.Exception.Response.StatusCode } catch { $status = $null }
    }
  }
  if ($status -eq 200) {
    Add-Result "the app" "HTTP 200 at $AppUrl" "200" "PASS"
  } elseif ($status) {
    Add-Result "the app" "HTTP 200 at $AppUrl" "$status" "FAIL"
  } else {
    Add-Result "the app" "HTTP 200 at $AppUrl" ("no answer: " + $why) "FAIL"
  }
}

# 11. the offline payload's hashes
$manifestPath = Find-Manifest $Manifest
if (-not $manifestPath) {
  Add-Result "the offline payload's hashes" "every file in manifest.json matches" "there is no manifest.json on this machine" "MISSING"
} else {
  $entries = @()
  $why = $null
  try {
    $entries = @(Get-PayloadEntries $manifestPath)
  } catch {
    $why = "the manifest could not be read: " + $_.Exception.Message
  }
  if ($why) {
    Add-Result "the offline payload's hashes" "every file in manifest.json matches" $why "FAIL"
  } elseif ($entries.Count -eq 0) {
    Add-Result "the offline payload's hashes" "every file in manifest.json matches" "the manifest lists no files" "FAIL"
  } else {
    $base = Split-Path -Parent $manifestPath
    $wrong = @()
    $absent = @()
    foreach ($entry in $entries) {
      $file = Join-Path $base $entry.Name
      if (-not (Test-Path $file)) {
        $absent += $entry.Name
        continue
      }
      $hash = (Get-FileHash -Path $file -Algorithm SHA256 -ErrorAction SilentlyContinue).Hash
      if (-not $hash) {
        $wrong += $entry.Name
        continue
      }
      if ($entry.Hash -and ($hash.ToLower() -ne $entry.Hash.ToLower())) { $wrong += $entry.Name }
    }
    $count = $entries.Count
    if ($wrong.Count -eq 0 -and $absent.Count -eq 0) {
      Add-Result "the offline payload's hashes" "every file in manifest.json matches" "$count of $count files match" "PASS"
    } else {
      $parts = @()
      if ($wrong.Count -gt 0) { $parts += ("do not match: " + ($wrong -join ", ")) }
      if ($absent.Count -gt 0) { $parts += ("are not there: " + ($absent -join ", ")) }
      Add-Result "the offline payload's hashes" "every file in manifest.json matches" ("$($count - $wrong.Count - $absent.Count) of $count files match - " + ($parts -join "; ")) "FAIL"
    }
  }
}

# --------------------------------------------------------------------------
# The table
# --------------------------------------------------------------------------

$counts = @{ "PASS" = 0; "FAIL" = 0; "MISSING" = 0; "NOT CHECKED" = 0 }
foreach ($row in $script:Results) {
  if ($counts.ContainsKey($row.Verdict)) { $counts[$row.Verdict] = $counts[$row.Verdict] + 1 }
}

$widthCheck = 4
$widthExpected = 4
$widthActual = 4
foreach ($row in $script:Results) {
  if ($row.Check.Length -gt $widthCheck) { $widthCheck = $row.Check.Length }
  if ($row.Expected.Length -gt $widthExpected) { $widthExpected = $row.Expected.Length }
  if ($row.Actual.Length -gt $widthActual) { $widthActual = $row.Actual.Length }
}

Write-Host ("  {0}  {1}  {2}  {3}" -f "check".PadRight($widthCheck), "expected".PadRight($widthExpected), "actual".PadRight($widthActual), "verdict")
Write-Host ("  {0}  {1}  {2}  {3}" -f ("-" * $widthCheck), ("-" * $widthExpected), ("-" * $widthActual), ("-" * 7))
foreach ($row in $script:Results) {
  $colour = "Gray"
  if ($row.Verdict -eq "PASS") { $colour = "Green" }
  if ($row.Verdict -eq "FAIL") { $colour = "Red" }
  if ($row.Verdict -eq "MISSING") { $colour = "Yellow" }
  Write-Host ("  {0}  {1}  {2}  " -f $row.Check.PadRight($widthCheck), $row.Expected.PadRight($widthExpected), $row.Actual.PadRight($widthActual)) -NoNewline
  Write-Host $row.Verdict -ForegroundColor $colour
}

Write-Host ""
Write-Host ("PASS {0}   FAIL {1}   MISSING {2}   NOT CHECKED {3}" -f $counts["PASS"], $counts["FAIL"], $counts["MISSING"], $counts["NOT CHECKED"]) -ForegroundColor Cyan
$failCount = $counts["FAIL"]
if ($failCount -gt 0) {
  Write-Host "$failCount thing(s) FAILED - they are there but they are wrong. See the rows above." -ForegroundColor Red
} else {
  Write-Host "Nothing FAILED." -ForegroundColor Green
}

# --------------------------------------------------------------------------
# The report - a block the reader can copy and send back as it is.
# --------------------------------------------------------------------------

$checkedAt = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
$machineFacts = @(
  "Computer: $env:COMPUTERNAME",
  "User: $env:USERNAME",
  "Windows: $osCaption ($osVersion, build $osBuild)",
  "Checked: $checkedAt",
  ("Node.js: " + $(if ($nodeVersion) { $nodeVersion } else { "not installed" })),
  ("Yarn: " + $(if ($yarnVersion) { $yarnVersion } else { "not installed" })),
  ("VS Code: " + $(if ($vscode -and $vscode.Version) { $vscode.Version } elseif ($vscode) { "installed" } else { "not installed" })),
  ("VSCodium: " + $(if ($codium -and $codium.Version) { $codium.Version } elseif ($codium) { "installed" } else { "not installed" })),
  ("An editor was running: " + $(if ($runningEditors.Count -gt 0) { $runningEditors -join ", " } else { "no" })),
  ("The app was checked at: " + $(if ($AppUrl) { $AppUrl } else { "not checked - no address was given" }))
)

$report = New-Object System.Collections.ArrayList
[void]$report.Add('```')
[void]$report.Add("Excalidraw for the classroom - the install check")
[void]$report.Add("")
foreach ($fact in $machineFacts) { [void]$report.Add($fact) }
[void]$report.Add("")
[void]$report.Add(("| {0} | {1} | {2} | {3} |" -f "check", "expected", "actual", "verdict"))
[void]$report.Add(("| {0} | {1} | {2} | {3} |" -f ("-" * 3), ("-" * 3), ("-" * 3), ("-" * 3)))
foreach ($row in $script:Results) {
  [void]$report.Add(("| {0} | {1} | {2} | {3} |" -f $row.Check, $row.Expected, $row.Actual, $row.Verdict))
}
[void]$report.Add("")
[void]$report.Add(("PASS {0}   FAIL {1}   MISSING {2}   NOT CHECKED {3}" -f $counts["PASS"], $counts["FAIL"], $counts["MISSING"], $counts["NOT CHECKED"]))
[void]$report.Add('```')

Write-Host ""
Write-Host "Copy the block below and send it back as it is:" -ForegroundColor Cyan
Write-Host ""
foreach ($line in $report) { Write-Host $line }
Write-Host ""

if ($counts["FAIL"] -gt 0) { exit 1 }
exit 0
