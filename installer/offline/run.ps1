# The proof: the offline setup in a Windows Sandbox with NO networking.
#
# This is what runs inside the Sandbox. It is mapped in from the host as
# C:\Sandbox, and everything it writes lands in the host's folder, so the
# result can be read from the host afterwards.
#
# It proves three things:
#
#   1. the setup runs with no network and still finds its payload;
#   2. it serves the app, and a request for the app's HTML comes back 200;
#   3. it installs what it can, from the payload, and says so.
#
# And it proves the FIRST thing that has to be true: that the machine really
# has no internet. The .wsb asks for no networking, but a Sandbox that is
# still settling can answer a request, so the network is taken down FROM
# INSIDE as well - and then probed three ways. If any probe answers, the
# proof says so and the proof is NOT valid.
#
# The answers to the setup's questions are read from answers.txt, so the run
# is the same every time. The default answers install Node.js - the smallest
# thing in the payload - and skip the rest.

$ErrorActionPreference = 'Continue'

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$log = Join-Path $here 'sandbox-result.txt'
$setupLog = Join-Path $here 'setup-output.txt'
$answers = Join-Path $here 'answers.txt'
$port = 4173

# the executable that is in this folder - the newest one, so a rebuild can be
# dropped in without touching the script
$setup = (Get-ChildItem -LiteralPath $here -Filter 'OfflineSetup*.exe' -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1).FullName

function Say {
    param([string]$text)
    $text | Out-File -FilePath $log -Append -Encoding utf8
}

Set-Content -Path $log -Value ('the offline setup in a Windows Sandbox with NO networking')
Add-Content -Path $log -Value ('started: ' + (Get-Date -Format o))
Add-Content -Path $log -Value ('sandbox: ' + $env:COMPUTERNAME)
Add-Content -Path $log -Value ''

# ---------------------------------------------------------------------------
# let the machine settle before believing anything about the network
# ---------------------------------------------------------------------------
Say 'THE NETWORK, AS THE SANDBOX SET IT UP'

Start-Sleep -Seconds 45

try {
    Get-NetAdapter | ForEach-Object { Say ('   adapter: ' + $_.Name + '  ' + $_.InterfaceDescription + '  ' + $_.Status) }
} catch { Say ('   the adapters could not be listed: ' + $_.Exception.Message) }

try {
    Get-NetRoute -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue | ForEach-Object { Say ('   default route: ' + $_.InterfaceAlias + ' -> ' + $_.NextHop) }
} catch { Say ('   the routes could not be listed: ' + $_.Exception.Message) }

try {
    Say ('   proxy: ' + [System.Net.WebRequest]::DefaultWebProxy.GetProxy('https://www.microsoft.com'))
} catch { Say ('   the proxy could not be read: ' + $_.Exception.Message) }

# was the internet there BEFORE anything was done to it? The .wsb asks for no
# networking, and the answer belongs in the record.
try {
    $before = Invoke-WebRequest -Uri 'https://www.microsoft.com' -TimeoutSec 12 -UseBasicParsing -ErrorAction Stop
    Say ('   an HTTP request to the internet ANSWERED (' + $before.StatusCode + ') - the .wsb setting alone did NOT take the internet away')
} catch {
    Say ('   an HTTP request to the internet failed: ' + $_.Exception.Message)
}

Say ''

# ---------------------------------------------------------------------------
# take the network down from INSIDE, so the proof does not depend on the
# .wsb setting alone
# ---------------------------------------------------------------------------
Say 'TAKING THE NETWORK DOWN FROM INSIDE'

try {
    New-NetFirewallRule -DisplayName 'offline-proof-block-all-outbound' -Direction Outbound -Action Block -Profile Any -ErrorAction Stop | Out-Null
    Say '   an outbound firewall rule was added: every outgoing packet is dropped'
} catch {
    Say ('   the firewall rule could not be added: ' + $_.Exception.Message)
}

try {
    $routed = Get-NetRoute -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty InterfaceAlias -Unique

    foreach ($name in $routed) {
        Disable-NetAdapter -Name $name -Confirm:$false -ErrorAction Stop
        Say ('   the adapter with the default route was disabled: ' + $name)
    }
} catch {
    Say ('   the routed adapter could not be disabled: ' + $_.Exception.Message)
}

Start-Sleep -Seconds 10
Say ''

# ---------------------------------------------------------------------------
# is there really no network? three ways.
# ---------------------------------------------------------------------------
Say 'THE NETWORK, AFTER THAT'

$online = $false

# 1. a DNS name
try {
    $addresses = [System.Net.Dns]::GetHostAddresses('www.microsoft.com')
    Say ('   DNS resolved www.microsoft.com to ' + (($addresses | ForEach-Object { $_.ToString() }) -join ', '))
    $online = $true
} catch {
    Say ('   DNS did not resolve www.microsoft.com: ' + $_.Exception.Message)
}

# 2. a raw TCP connection to a public address
foreach ($target in @(@('1.1.1.1', 443), @('8.8.8.8', 53))) {
    try {
        $client = New-Object System.Net.Sockets.TcpClient
        $task = $client.ConnectAsync($target[0], [int]$target[1])

        if ($task.Wait(6000) -and $client.Connected) {
            Say ('   a TCP connection to ' + $target[0] + ':' + $target[1] + ' SUCCEEDED')
            $online = $true
        } else {
            Say ('   a TCP connection to ' + $target[0] + ':' + $target[1] + ' did not answer')
        }

        $client.Close()
    } catch {
        Say ('   a TCP connection to ' + $target[0] + ':' + $target[1] + ' failed: ' + $_.Exception.Message)
    }
}

# 3. an HTTP request
try {
    $response = Invoke-WebRequest -Uri 'https://www.microsoft.com' -TimeoutSec 12 -UseBasicParsing -ErrorAction Stop
    Say ('   an HTTP request to the internet ANSWERED (' + $response.StatusCode + ') - the machine is NOT offline!')
    $online = $true
} catch {
    Say ('   an HTTP request to the internet failed: ' + $_.Exception.Message)
}

Say ''

if ($online) {
    Say 'THE MACHINE IS NOT OFFLINE - THIS PROOF IS NOT VALID.'
} else {
    Say 'THE MACHINE IS OFFLINE. Every way of asking the internet failed.'
}

Say ''

# ---------------------------------------------------------------------------
# 1. the setup runs, and finds its payload
# ---------------------------------------------------------------------------
Say 'THE SETUP'

if (-not (Test-Path -LiteralPath $setup)) {
    Say ('  the setup is NOT here: ' + $setup)
    Say '  the proof cannot run.'
    exit 1
}

if (-not (Test-Path -LiteralPath $answers)) {
    Set-Content -Path $answers -Value ("y`nn`nn`nn`nn`nn`n")
}

Say ('  running: ' + $setup)
Say ''

$process = Start-Process -FilePath $setup `
    -ArgumentList @('-NoBrowser', '-Port', $port) `
    -RedirectStandardInput $answers `
    -RedirectStandardOutput $setupLog `
    -RedirectStandardError (Join-Path $here 'setup-error.txt') `
    -PassThru -WindowStyle Hidden

# ---------------------------------------------------------------------------
# 2. the app is served, and the HTML comes back 200
# ---------------------------------------------------------------------------
Say 'THE APP'

$status = 0
$body = ''
$ready = $false

for ($attempt = 1; $attempt -le 180; $attempt++) {
    Start-Sleep -Seconds 2

    if ($process.HasExited -and $attempt -gt 5) {
        Say ('  the setup stopped early (exit code ' + $process.ExitCode + ')')
        break
    }

    try {
        $response = Invoke-WebRequest -Uri ('http://127.0.0.1:' + $port + '/') -TimeoutSec 5 -UseBasicParsing -ErrorAction Stop
        $status = $response.StatusCode
        $body = $response.Content
        $ready = $true
        break
    } catch {
        # not up yet
    }
}

if ($ready) {
    Say ('  GET http://127.0.0.1:' + $port + '/  ->  ' + $status)
    Say ('  the HTML is ' + $body.Length + ' characters long')
    Say ('  it is the app: ' + ($body -match '<title>Excalidraw Whiteboard</title>'))
    Say ('  it loads the app''s own script: ' + ($body -match '/assets/index-'))

    $script = [regex]::Match($body, '/assets/index-[^"]+\.js').Value

    if ($script) {
        try {
            $js = Invoke-WebRequest -Uri ('http://127.0.0.1:' + $port + $script) -TimeoutSec 30 -UseBasicParsing
            Say ('  the app''s own script ' + $script + ' -> ' + $js.StatusCode + '  (' + $js.RawContentLength + ' bytes)')
        } catch {
            Say ('  the app''s own script could not be fetched: ' + $_.Exception.Message)
        }
    }
} else {
    Say ('  the app did NOT answer on port ' + $port)
}

Say ''

# ---------------------------------------------------------------------------
# 3. what the setup installed, and what it said
# ---------------------------------------------------------------------------
Say 'WHAT THE SETUP SAID'

if (Test-Path -LiteralPath $setupLog) {
    Get-Content -LiteralPath $setupLog | ForEach-Object { Say ('  ' + $_) }
} else {
    Say '  there is no output from the setup'
}

Say ''
Say ('the setup''s exit code: ' + $(if ($process.HasExited) { $process.ExitCode } else { 'it is still serving' }))
Say ('finished: ' + (Get-Date -Format o))

# the setup serves the app until it is stopped
if (-not $process.HasExited) {
    Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
}
