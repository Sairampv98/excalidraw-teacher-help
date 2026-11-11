<#
.SYNOPSIS
  Proves the setup in a Windows Sandbox that has no editor (D-369).

.DESCRIPTION
  1. stops a Windows Sandbox that is running (a live one keeps its old setup);
  2. writes a .wsb that maps this folder in, read only, and a folder for the
     result, which the sandbox writes to;
  3. starts the sandbox, which runs sandbox-run.ps1: the engine, with the
     editor missing and the network on;
  4. waits for the result, prints what happened, and closes the sandbox.

  It touches nothing on this machine but Windows Sandbox and its own result
  folder: no editor is installed here, no editor of the teacher's is run.

.PARAMETER Editor
  code or codium: the editor the proof installs.

.PARAMETER Groups
  The language groups the proof puts in the profile. js needs no download.

.PARAMETER Ladder
  The rungs of the install the proof may use.

.PARAMETER Vsix
  The bridge extension to install. Defaults to the one the extension's build
  script makes.

.PARAMETER TimeoutMinutes
  How long to wait.
#>

[CmdletBinding()]
param(
  [ValidateSet('code', 'codium')][string]$Editor = 'codium',
  [string]$Groups = 'js',
  [string]$Ladder = 'winget,scoop,direct',
  [string]$Vsix = '',
  [int]$TimeoutMinutes = 25,
  [string]$SandboxExe = 'C:\Windows\System32\WindowsSandbox.exe',
  [string]$OutDir = ''
)

$ErrorActionPreference = 'Continue'

$here = Split-Path -Parent $MyInvocation.MyCommand.Path

if ($OutDir -eq '') {
  $OutDir = Join-Path $env:TEMP ('editor-setup-proof-' + $Editor)
}

function Say([string]$Text) { Write-Host $Text }

if (-not (Test-Path -LiteralPath $SandboxExe)) {
  Say 'Windows Sandbox is not installed on this machine (turn it on in "Windows features").'
  exit 1
}

if ($Vsix -eq '') {
  $found = Get-ChildItem -LiteralPath (Join-Path $here '..\..\packages\vscode-bridge') -Filter '*.vsix' -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1

  if ($found) { $Vsix = $found.FullName }
}

if ($Vsix -eq '' -or -not (Test-Path -LiteralPath $Vsix)) {
  Say 'No bridge .vsix was found: build it (node packages/vscode-bridge/scripts/build-vsix.mjs) or pass -Vsix.'
  exit 1
}

# a sandbox that is running is stopped first
foreach ($process in @(Get-Process -Name 'WindowsSandbox*' -ErrorAction SilentlyContinue)) {
  try { $null = $process.CloseMainWindow() } catch { }
}

for ($i = 0; $i -lt 60 -and @(Get-Process -Name 'WindowsSandbox*' -ErrorAction SilentlyContinue).Count -gt 0; $i++) {
  Start-Sleep -Seconds 1
}

foreach ($process in @(Get-Process -Name 'WindowsSandbox*' -ErrorAction SilentlyContinue)) {
  Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
}

if (Test-Path -LiteralPath $OutDir) {
  Remove-Item -LiteralPath $OutDir -Recurse -Force
}

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
Copy-Item -LiteralPath $Vsix -Destination (Join-Path $OutDir 'bridge.vsix')

$config = [ordered]@{ editor = $Editor; groups = $Groups; ladder = $Ladder; profile = 'excalidraw' }
Set-Content -LiteralPath (Join-Path $OutDir 'config.json') -Value (ConvertTo-Json -InputObject $config) -Encoding UTF8

$wsbPath = Join-Path $OutDir 'proof.wsb'
$setupFolder = (Resolve-Path -LiteralPath $here).Path

$wsb = @"
<Configuration>
  <VGpu>Disable</VGpu>
  <Networking>Default</Networking>
  <MemoryInMB>4096</MemoryInMB>
  <MappedFolders>
    <MappedFolder>
      <HostFolder>$setupFolder</HostFolder>
      <SandboxFolder>C:\Setup</SandboxFolder>
      <ReadOnly>true</ReadOnly>
    </MappedFolder>
    <MappedFolder>
      <HostFolder>$OutDir</HostFolder>
      <SandboxFolder>C:\Out</SandboxFolder>
      <ReadOnly>false</ReadOnly>
    </MappedFolder>
  </MappedFolders>
  <LogonCommand>
    <Command>powershell.exe -ExecutionPolicy Bypass -File C:\Setup\sandbox-run.ps1</Command>
  </LogonCommand>
</Configuration>
"@

Set-Content -LiteralPath $wsbPath -Value $wsb -Encoding UTF8

Say ('the setup proof, in a fresh Windows Sandbox (' + $Editor + ')')
Say ('  result folder: ' + $OutDir)

Start-Process -FilePath $SandboxExe -ArgumentList ('"' + $wsbPath + '"')

$result = Join-Path $OutDir 'result.json'
$deadline = (Get-Date).AddMinutes($TimeoutMinutes)

while (-not (Test-Path -LiteralPath $result) -and (Get-Date) -lt $deadline) {
  Start-Sleep -Seconds 5
}

if (-not (Test-Path -LiteralPath $result)) {
  Say ('no result after ' + $TimeoutMinutes + ' minutes - the proof did not finish')
  exit 1
}

# the sandbox may still be writing: it is read when it can be
$read = $null

for ($i = 0; $i -lt 60 -and $null -eq $read; $i++) {
  Start-Sleep -Seconds 2

  try {
    $read = ConvertFrom-Json -InputObject ([System.IO.File]::ReadAllText($result))
  }
  catch {
    $read = $null
  }
}

if ($null -eq $read) {
  Say 'the result could not be read'
  exit 1
}

Say ''
Say 'before the setup, in the sandbox:'
Say ('  ' + (ConvertTo-Json -InputObject $read.before -Compress))
Say ''
Say 'what the setup said:'

foreach ($line in $read.engineLines) {
  try {
    $obj = ConvertFrom-Json -InputObject $line

    if ($obj.step -ne 'plan') { Say ('  [' + $obj.status + '] ' + $obj.step + ': ' + $obj.text) }
  }
  catch { Say ('  ' + $line) }
}

Say ''
Say ('engine exit code: ' + $read.engineExitCode)
Say ('editor now:       ' + $read.installedCli + '  ' + $read.editorVersion)
Say 'extensions in the profile:'

foreach ($e in @($read.profileExtensions)) { Say ('  ' + $e) }

# the sandbox is closed: asked first, then stopped - it keeps a virtual machine's
# memory for as long as it is open
foreach ($process in @(Get-Process -Name 'WindowsSandbox*' -ErrorAction SilentlyContinue)) {
  try { $null = $process.CloseMainWindow() } catch { }
}

Start-Sleep -Seconds 3

foreach ($process in @(Get-Process -Name 'WindowsSandbox*' -ErrorAction SilentlyContinue)) {
  Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
}

$ok = ($read.engineExitCode -eq 0) -and $read.installedCli -and (@($read.profileExtensions) -match 'excalidraw-bridge').Count -gt 0

Say ''
Say $(if ($ok) { 'PROOF: the editor was installed from nothing and the profile holds the bridge.' } else { 'PROOF FAILED.' })
exit $(if ($ok) { 0 } else { 1 })
