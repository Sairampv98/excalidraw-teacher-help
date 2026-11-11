<#
.SYNOPSIS
  The first run: fetches the setup from the page's own site, registers the
  link, and opens the plan (D-364).

.DESCRIPTION
  The page offers this three ways, and they are the same program:

    - the link itself (excalidraw-setup://...), once this has been run;
    - a downloaded ExcalidrawSetup.cmd, which runs this;
    - a command to copy into PowerShell:
        powershell -NoProfile -ExecutionPolicy Bypass -Command
          "& ([scriptblock]::Create((irm '<site>/setup/Bootstrap.ps1'))) -Base '<site>/setup' -Link '<link>'"

  It puts EditorSetup.ps1, Open-SetupLink.ps1 and Register-SetupLink.ps1 in
  %LOCALAPPDATA%\ExcalidrawSetup, registers the link for this user, and runs
  Open-SetupLink.ps1 with the link - which shows the plan and asks.

  Nothing here installs an editor: that is what the plan's "Set up" button does.

.PARAMETER Base
  The address the three files are fetched from.

.PARAMETER Link
  The setup link to open afterwards.
#>

[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Base,
  [string]$Link = '',
  [string]$Folder = (Join-Path $env:LOCALAPPDATA 'ExcalidrawSetup'),
  [switch]$NoWindow
)

$ErrorActionPreference = 'Stop'

# the files come from a site the teacher chose, over https - or from this
# machine over http
if ($Base -notmatch '^(https://[A-Za-z0-9.-]+(:\d+)?(/[^\s"'']*)?|http://(127\.0\.0\.1|localhost)(:\d+)?(/[^\s"'']*)?)$') {
  [Console]::Error.WriteLine('The address the setup is fetched from is not one this will use: ' + $Base)
  exit 1
}

New-Item -ItemType Directory -Force -Path $Folder | Out-Null

[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

foreach ($name in @('EditorSetup.ps1', 'Open-SetupLink.ps1', 'Register-SetupLink.ps1')) {
  $to = Join-Path $Folder $name
  $url = $Base.TrimEnd('/') + '/' + $name

  [Console]::Out.WriteLine('fetching ' + $url)

  if (Get-Command curl.exe -ErrorAction SilentlyContinue) {
    & curl.exe -L --fail --silent --show-error --retry 3 -o $to $url

    if ($LASTEXITCODE -ne 0) {
      [Console]::Error.WriteLine('could not fetch ' + $url)
      exit 1
    }
  }
  else {
    Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $to
  }
}

& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Folder 'Register-SetupLink.ps1') -Folder $Folder

if ($Link -ne '') {
  $args_ = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $Folder 'Open-SetupLink.ps1'), '-Link', $Link)

  if ($NoWindow) { $args_ += '-NoWindow' }

  & powershell.exe @args_
  exit $LASTEXITCODE
}

exit 0
