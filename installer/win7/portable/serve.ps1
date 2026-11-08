# A tiny web server for the whiteboard, written for PowerShell 2.0 (the one Windows 7 has).
# It serves the folder `app` on http://127.0.0.1:8123/ and stops when it is asked to
# (http://127.0.0.1:8123/__quit). It uses a plain socket on this computer only, so it needs
# no installation and no administrator rights (the usual web-server classes of Windows
# refuse to listen without them on older Windows).
param([int]$Port = 8123)

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = [IO.Path]::GetFullPath((Join-Path $here 'app'))
$logFile = Join-Path $here 'serve.log'

$types = @{
  '.html' = 'text/html; charset=utf-8'; '.js' = 'text/javascript; charset=utf-8'; '.mjs' = 'text/javascript; charset=utf-8';
  '.css' = 'text/css; charset=utf-8'; '.json' = 'application/json'; '.wasm' = 'application/wasm';
  '.svg' = 'image/svg+xml'; '.png' = 'image/png'; '.jpg' = 'image/jpeg'; '.gif' = 'image/gif'; '.ico' = 'image/x-icon';
  '.woff2' = 'font/woff2'; '.woff' = 'font/woff'; '.ttf' = 'font/ttf'; '.txt' = 'text/plain; charset=utf-8';
  '.webmanifest' = 'application/manifest+json'; '.map' = 'application/json'; '.mp4' = 'video/mp4'; '.pdf' = 'application/pdf'
}

function Log($m) { try { Add-Content -Path $logFile -Value ((Get-Date).ToString('HH:mm:ss') + ' ' + $m) } catch { } }

$listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, $Port)
try { $listener.Start() } catch {
  Log ("cannot listen on $Port : " + $_.Exception.Message)
  Write-Host "Cannot listen on port $Port : $($_.Exception.Message)"
  exit 2
}
Log "listening on 127.0.0.1:$Port"
Write-Host "The whiteboard is served at http://127.0.0.1:$Port/  (close this window to stop)"

function Send($stream, $status, $contentType, [byte[]]$body, $headOnly) {
  $head = "HTTP/1.1 $status`r`nContent-Type: $contentType`r`nContent-Length: " + $body.Length + "`r`nConnection: close`r`nCache-Control: no-cache`r`n`r`n"
  $h = [Text.Encoding]::ASCII.GetBytes($head)
  $stream.Write($h, 0, $h.Length)
  if (-not $headOnly -and $body.Length -gt 0) { $stream.Write($body, 0, $body.Length) }
  $stream.Flush()
}

# the connections that have been opened and have not sent a whole request yet (a browser opens
# spare ones that never send anything, so no connection may be waited for)
$waiting = New-Object System.Collections.ArrayList
$quit = $false

while (-not $quit) {
  while ($listener.Pending()) {
    $c = $listener.AcceptTcpClient()
    $item = @{ client = $c; buffer = ''; born = Get-Date }
    [void]$waiting.Add($item)
  }

  $done = New-Object System.Collections.ArrayList
  foreach ($item in $waiting) {
    $c = $item.client
    try {
      if ($c.Available -gt 0) {
        $stream = $c.GetStream()
        $buf = New-Object byte[] $c.Available
        [void]$stream.Read($buf, 0, $buf.Length)
        $item.buffer += [Text.Encoding]::ASCII.GetString($buf)
      }
      if ($item.buffer.Contains("`r`n`r`n")) {
        $stream = $c.GetStream()
        $line = $item.buffer.Split("`r`n")[0]
        $parts = $line.Split(' ')
        $method = $parts[0]
        $headOnly = ($method -eq 'HEAD')
        $rawPath = '/'
        if ($parts.Length -gt 1) { $rawPath = $parts[1] }
        $q = $rawPath.IndexOf('?'); if ($q -ge 0) { $rawPath = $rawPath.Substring(0, $q) }
        $path = [Uri]::UnescapeDataString($rawPath)

        if ($path -eq '/__ping') { Send $stream '200 OK' 'text/plain' ([Text.Encoding]::UTF8.GetBytes('ok')) $headOnly }
        elseif ($path -eq '/__quit') { Send $stream '200 OK' 'text/plain' ([Text.Encoding]::UTF8.GetBytes('bye')) $false; $quit = $true }
        elseif ($method -ne 'GET' -and $method -ne 'HEAD') { Send $stream '405 Method Not Allowed' 'text/plain' ([Text.Encoding]::UTF8.GetBytes('no')) $false }
        else {
          $file = [IO.Path]::GetFullPath((Join-Path $root $path.TrimStart('/').Replace('/', '\')))
          if (-not $file.StartsWith($root, [StringComparison]::OrdinalIgnoreCase)) {
            Send $stream '403 Forbidden' 'text/plain' ([Text.Encoding]::UTF8.GetBytes('no')) $false
          } else {
            if (-not [IO.File]::Exists($file)) { $file = Join-Path $root 'index.html' }
            $ext = [IO.Path]::GetExtension($file).ToLower()
            $type = 'application/octet-stream'
            if ($types.ContainsKey($ext)) { $type = $types[$ext] }
            Send $stream '200 OK' $type ([IO.File]::ReadAllBytes($file)) $headOnly
          }
        }
        [void]$done.Add($item)
      } elseif (((Get-Date) - $item.born).TotalSeconds -gt 60) {
        [void]$done.Add($item)
      }
    } catch {
      Log ('request failed: ' + $_.Exception.Message)
      [void]$done.Add($item)
    }
  }
  foreach ($item in $done) {
    try { $item.client.Close() } catch { }
    $waiting.Remove($item)
  }
  if (-not $quit) { Start-Sleep -Milliseconds 5 }
}

$listener.Stop()
Log 'stopped'
