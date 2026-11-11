<#
.SYNOPSIS
  What runs INSIDE the Windows Sandbox for the setup proof (D-369).

.DESCRIPTION
  A fresh Windows Sandbox has no editor and no package manager. This runs the
  engine as a teacher would - with the editor missing - and writes down what
  happened where the host can read it: C:\Out\result.json, and every line the
  engine said in C:\Out\proof.log.

  The launcher (run-sandbox-proof.ps1) writes C:\Out\config.json and copies
  the bridge there.
#>

$ErrorActionPreference = 'Continue'

$out = 'C:\Out'
$setup = 'C:\Setup'
$log = Join-Path $out 'proof.log'
$config = ConvertFrom-Json -InputObject (Get-Content -LiteralPath (Join-Path $out 'config.json') -Raw)

function Note {
  param([string]$Text)
  Add-Content -LiteralPath $log -Value ((Get-Date).ToString('HH:mm:ss') + ' ' + $Text)
}

Note 'the sandbox is up'

$before = [ordered]@{
  winget      = [bool](Get-Command winget -ErrorAction SilentlyContinue)
  scoop       = [bool](Get-Command scoop -ErrorAction SilentlyContinue)
  curl        = [bool](Get-Command curl.exe -ErrorAction SilentlyContinue)
  code        = [bool](Get-Command code -ErrorAction SilentlyContinue)
  codium      = [bool](Get-Command codium -ErrorAction SilentlyContinue)
  codeFolder  = (Test-Path (Join-Path $env:LOCALAPPDATA 'Programs\Microsoft VS Code'))
  codiumFolder = (Test-Path (Join-Path $env:LOCALAPPDATA 'Programs\VSCodium'))
}

Note ('before: ' + (ConvertTo-Json -InputObject $before -Compress))

$arguments = @(
  '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $setup 'EditorSetup.ps1'),
  '-Mode', 'Run', '-Yes', '-NoOpen', '-Json',
  '-Editor', $config.editor,
  '-Groups', $config.groups,
  '-Ladder', $config.ladder,
  '-VsixPath', (Join-Path $out 'bridge.vsix')
)

$lines = & powershell.exe @arguments 2>&1
$code = $LASTEXITCODE

foreach ($line in $lines) {
  Add-Content -LiteralPath $log -Value ("$line")
}

# what is true afterwards, found by looking
$cli = $null

foreach ($candidate in @(
    (Join-Path $env:LOCALAPPDATA 'Programs\Microsoft VS Code\bin\code.cmd'),
    (Join-Path $env:LOCALAPPDATA 'Programs\VSCodium\bin\codium.cmd')
  )) {
  if ((Test-Path -LiteralPath $candidate) -and ($candidate -match $(if ($config.editor -eq 'codium') { 'codium' } else { 'code\.cmd' }))) {
    $cli = $candidate
  }
}

$version = ''
$profileExtensions = @()
$profiles = ''

if ($cli) {
  $version = (@(& $cli --version 2>$null))[0]
  $profileExtensions = @(& $cli --profile $config.profile --list-extensions --show-versions 2>$null)
  $storage = Join-Path (Join-Path $env:APPDATA $(if ($config.editor -eq 'codium') { 'VSCodium' } else { 'Code' })) 'User\globalStorage\storage.json'

  if (Test-Path -LiteralPath $storage) {
    # a plain string: what Get-Content returns carries the whole drive with it
    $profiles = [string](Get-Content -LiteralPath $storage -Raw)
  }
}

$result = [ordered]@{
  editor            = $config.editor
  before            = $before
  engineExitCode    = $code
  installedCli      = $cli
  editorVersion     = $version
  profileExtensions = $profileExtensions
  storageJson       = $profiles
  engineLines       = @($lines | ForEach-Object { "$_" })
}

Set-Content -LiteralPath (Join-Path $out 'result.json') -Value (ConvertTo-Json -InputObject $result -Depth 6) -Encoding UTF8
Note 'the result is written'
