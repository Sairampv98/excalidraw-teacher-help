<#
.SYNOPSIS
  Runs the offline proof in a Windows Sandbox that is FRESH.

.DESCRIPTION
  The proof needs a sandbox that has just started. Windows Sandbox REUSES a
  running virtual machine, and a live session keeps the configuration of the
  session it was started with - so a sandbox that is already alive can carry a
  network the .wsb asked to be gone.

  This script therefore:

    1. stops any Windows Sandbox that is running, and waits for it to be gone;
    2. writes the .wsb for the folder the proof is in - the shipped .wsb names
       one machine's path, and the proof has to run wherever the payload is;
    3. starts the sandbox with that .wsb;
    4. waits for the result, prints it, and says whether the proof is valid.

  It only touches Windows Sandbox. It never kills an editor, it installs
  nothing, and it needs no administrator rights.

.PARAMETER PayloadDir
  The folder that holds the payload, the answers file and run.ps1. It is
  mapped into the sandbox as C:\Sandbox.

.PARAMETER SandboxExe
  The Windows Sandbox program. The default is the one Windows ships.

.PARAMETER TimeoutMinutes
  How long to wait for the proof to finish.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File installer\offline\run-offline-proof.ps1
#>
#requires -Version 5.1
[CmdletBinding()]
param(
    [string]$PayloadDir = "",
    [string]$SandboxExe = "C:\Windows\System32\WindowsSandbox.exe",
    [int]$TimeoutMinutes = 30
)

$ErrorActionPreference = 'Continue'

$here = Split-Path -Parent $MyInvocation.MyCommand.Path

if (-not $PayloadDir) {
    $PayloadDir = $here
}

$PayloadDir = (Resolve-Path -LiteralPath $PayloadDir).Path
$wsb = Join-Path $PayloadDir 'offline-proof.wsb'
$result = Join-Path $PayloadDir 'sandbox-result.txt'

function Say {
    param([string]$text)
    Write-Host $text
}

Say ('the offline proof, in a fresh Windows Sandbox')
Say ('  the payload folder: ' + $PayloadDir)
Say ''

# ---------------------------------------------------------------------------
# 1. stop a sandbox that is already running
# ---------------------------------------------------------------------------

$running = @(Get-Process -Name 'WindowsSandbox' -ErrorAction SilentlyContinue)

if ($running.Count -eq 0) {
    Say '  no Windows Sandbox was running - the one this starts will be fresh'
} else {
    Say ('  a Windows Sandbox is already running (' + $running.Count + ' of them) - it is stopped first')
    Say '    a live sandbox keeps the configuration of the session it was started with,'

    foreach ($process in $running) {
        try {
            # the polite way first: closing the window shuts the virtual
            # machine down cleanly
            $null = $process.CloseMainWindow()
        } catch {
            # a sandbox with no window is already on its way out
        }
    }

    $waited = 0

    while ($waited -lt 60) {
        Start-Sleep -Seconds 1
        $waited++

        $left = @(Get-Process -Name 'WindowsSandbox' -ErrorAction SilentlyContinue)

        if ($left.Count -eq 0) {
            break
        }
    }

    $left = @(Get-Process -Name 'WindowsSandbox' -ErrorAction SilentlyContinue)

    if ($left.Count -gt 0) {
        Say ('    the sandbox did not close by itself - it is stopped the hard way')

        foreach ($process in $left) {
            try {
                Stop-Process -Id $process.Id -Force -ErrorAction Stop
            } catch {
                Say ('    it could not be stopped: ' + $_.Exception.Message)
            }
        }

        Start-Sleep -Seconds 5
    }

    $left = @(Get-Process -Name 'WindowsSandbox' -ErrorAction SilentlyContinue)

    if ($left.Count -gt 0) {
        Say '    a Windows Sandbox is STILL running, so the proof would not be about a fresh one.'
        Say '    Close it by hand and run this again.'
        exit 1
    }

    Say '    it is gone'
}

Say ''

# ---------------------------------------------------------------------------
# 2. the .wsb for THIS folder
# ---------------------------------------------------------------------------

# the shipped .wsb names one machine's path. This writes the one for the
# folder the proof is actually in, so the proof runs wherever the payload is.
$wsbText = @"
<Configuration>
  <VGpu>Disable</VGpu>
  <Networking>None</Networking>
  <MappedFolders>
    <MappedFolder>
      <HostFolder>$PayloadDir</HostFolder>
      <SandboxFolder>C:\Sandbox</SandboxFolder>
      <ReadOnly>false</ReadOnly>
    </MappedFolder>
  </MappedFolders>
  <LogonCommand>
    <Command>powershell.exe -ExecutionPolicy Bypass -File C:\Sandbox\run.ps1</Command>
  </LogonCommand>
</Configuration>
"@

Set-Content -Path $wsb -Value $wsbText -Encoding UTF8
Say ('  the sandbox file: ' + $wsb)

# the result of the PREVIOUS run must not be mistaken for this one
if (Test-Path -LiteralPath $result) {
    try {
        Remove-Item -LiteralPath $result -Force -ErrorAction Stop
    } catch {
        Say ('  the old result could not be removed, so the timestamps are compared instead: ' + $_.Exception.Message)
    }
}

Say ''

# ---------------------------------------------------------------------------
# 3. start it
# ---------------------------------------------------------------------------

if (-not (Test-Path -LiteralPath $SandboxExe)) {
    Say ('  Windows Sandbox is not on this machine: ' + $SandboxExe)
    Say '  It is an optional feature of Windows: "Windows Sandbox" in "Turn Windows features on or off".'
    exit 1
}

Say '  the sandbox is starting - it takes a minute'

try {
    Start-Process -FilePath $SandboxExe -ArgumentList @('"' + $wsb + '"') -ErrorAction Stop
} catch {
    Say ('  the sandbox could not be started: ' + $_.Exception.Message)
    exit 1
}

# ---------------------------------------------------------------------------
# 4. wait for the result
# ---------------------------------------------------------------------------

Say '  waiting for the proof to finish'

$deadline = (Get-Date).AddMinutes($TimeoutMinutes)
$done = $false

while ((Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 10

    if (Test-Path -LiteralPath $result) {
        $content = Get-Content -LiteralPath $result -Raw -ErrorAction SilentlyContinue

        if ($content -and $content -match 'finished:') {
            $done = $true
            break
        }
    }
}

if (-not $done) {
    Say ('  the proof did not finish within ' + $TimeoutMinutes + ' minutes.')
    Say '  The sandbox is still open - the result may be in ' + $result
    exit 1
}

Say ''
Say '============================================================'
Get-Content -LiteralPath $result | ForEach-Object { Write-Host $_ }
Say '============================================================'
Say ''

$content = Get-Content -LiteralPath $result -Raw

if ($content -match 'THE MACHINE IS OFFLINE') {
    Say 'THE PROOF IS VALID: the machine really had no internet, and the setup worked on it.'
    exit 0
}

Say 'THE PROOF IS NOT VALID: the machine was not offline.'
exit 1
