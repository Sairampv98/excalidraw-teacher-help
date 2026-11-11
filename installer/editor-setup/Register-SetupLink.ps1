<#
.SYNOPSIS
  Makes the browser able to open the setup: registers the excalidraw-setup://
  link for this user (D-364).

.DESCRIPTION
  The page's "Set up my editor" button is a link, excalidraw-setup://install?...
  The browser asks "Open Excalidraw Setup?" - once, and again if it forgets -
  and then opens Open-SetupLink.ps1 with the link.

  This writes the registration under HKEY_CURRENT_USER only: no administrator,
  nothing for other users of the machine, nothing outside the user's own
  registry. -Remove takes it away.

.PARAMETER Folder
  Where Open-SetupLink.ps1 and EditorSetup.ps1 are. Defaults to the folder of
  this script.

.PARAMETER Remove
  Takes the registration away.
#>

[CmdletBinding()]
param(
  [string]$Folder = '',
  [switch]$Remove,
  # for a test: the registry key to use instead of the real one
  [string]$KeyPath = 'HKCU:\Software\Classes\excalidraw-setup'
)

$ErrorActionPreference = 'Stop'

# the folder of this script, unless one was given
if ($Folder -eq '') {
  $Folder = Split-Path -Parent $MyInvocation.MyCommand.Path
}

if ($Remove) {
  if (Test-Path -LiteralPath $KeyPath) {
    Remove-Item -LiteralPath $KeyPath -Recurse -Force
  }

  [Console]::Out.WriteLine('The setup link is no longer registered.')
  exit 0
}

$helper = Join-Path $Folder 'Open-SetupLink.ps1'

if (-not (Test-Path -LiteralPath $helper)) {
  [Console]::Error.WriteLine("Open-SetupLink.ps1 is not in $Folder")
  exit 1
}

New-Item -Path $KeyPath -Force | Out-Null
Set-ItemProperty -LiteralPath $KeyPath -Name '(default)' -Value 'URL:Excalidraw Setup'
Set-ItemProperty -LiteralPath $KeyPath -Name 'URL Protocol' -Value ''

$command = Join-Path (Join-Path $KeyPath 'shell') 'open\command'
New-Item -Path $command -Force | Out-Null

# the link is the one argument, in quotes: what the browser put in it is data,
# and the helper reads it against a closed list
Set-ItemProperty -LiteralPath $command -Name '(default)' -Value ('powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "{0}" "%1"' -f $helper)

[Console]::Out.WriteLine('The setup link is registered for this user.')
exit 0
