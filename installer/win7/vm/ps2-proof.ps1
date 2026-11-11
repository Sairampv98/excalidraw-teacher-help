# AC-576 / D-481: the proof on Windows 7 (PowerShell 2.0) that the editor-window helpers run.
# It opens Notepad (a stand-in for the editor's window) and runs the three helpers against it:
#   window.ps1 (Primary, Displays, Find, Place), capture.ps1 (the picture) and input.ps1 (a typed text).
# This script is itself written for PowerShell 2.0. It is run from the disc with the extension's `media` folder beside it:
#   powershell -ExecutionPolicy Bypass -File ps2-proof.ps1
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$m = Join-Path $here 'media'
$log = Join-Path $env:TEMP 'ps2-proof.txt'
if (Test-Path $log) { Remove-Item $log }
$script:bad = 0

function Say($text) { $text; Add-Content -Path $log -Value $text }
function Check($name, $condition, $detail) {
  if ($condition) { Say ("ok      " + $name) }
  else { Say ("NOT OK  " + $name + "   " + $detail); $script:bad++ }
}
function Helper($file, $arguments) {
  $out = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $m $file) @arguments 2>&1 | Out-String
  $out.Trim()
}

# a number out of the helper's JSON line
function Num($text, $name) { if ($text -match ('"' + $name + '":(-?[0-9]+)')) { [long]$matches[1] } else { $null } }

Say ("PowerShell " + $PSVersionTable.PSVersion + "   CLR " + [Environment]::Version + "   ConvertTo-Json there: " + [bool](Get-Command ConvertTo-Json -ErrorAction SilentlyContinue))

$notepad = Start-Process notepad.exe -PassThru
Start-Sleep -Seconds 4

# window.ps1
$text = Helper 'window.ps1' @('-Mode', 'Primary')
Check 'window Primary: the work area' ((Num $text 'width') -gt 0 -and (Num $text 'height') -gt 0) $text

$text = Helper 'window.ps1' @('-Mode', 'Displays')
Check 'window Displays: at least one display' ($text.Contains('"displays":[{')) $text

$text = Helper 'window.ps1' @('-Mode', 'Find', '-ProcessName', 'notepad')
$handle = Num $text 'handle'
Check 'window Find: Notepad found' (($text -match '"found":true') -and $handle -gt 0) $text

$text = Helper 'window.ps1' @('-Mode', 'Place', '-Handle', [string]$handle, '-X', '40', '-Y', '60', '-Width', '520', '-Height', '380')
Check 'window Place: placed' ($text -match '"placed":true') $text

$text = Helper 'window.ps1' @('-Mode', 'Find', '-ProcessName', 'notepad')
$x = Num $text 'x'
$y = Num $text 'y'
Check 'window Find again: it stands where it was placed' ($x -ne $null -and [math]::Abs($x - 40) -le 20 -and [math]::Abs($y - 60) -le 20) $text

# capture.ps1: the header line, then a length and a JPEG for each frame. Its stdout is read as BYTES through a
# pipe, the way the extension reads it (a redirect to a file is not how it runs).
$info = New-Object System.Diagnostics.ProcessStartInfo
$info.FileName = 'powershell.exe'
$info.Arguments = '-NoProfile -ExecutionPolicy Bypass -File "' + (Join-Path $m 'capture.ps1') + '" -ProcessName notepad -Fps 5 -MaxFrames 3'
$info.UseShellExecute = $false
$info.RedirectStandardOutput = $true
$info.RedirectStandardError = $false
$p = [System.Diagnostics.Process]::Start($info)
# a watchdog: if the helper never ends and never writes, the read below would wait for ever
$null = Start-Process cmd.exe -WindowStyle Hidden -ArgumentList ('/c ping -n 45 127.0.0.1 >nul & taskkill /f /pid ' + $p.Id)
$memory = New-Object System.IO.MemoryStream
$buffer = New-Object byte[] 65536
$deadline = [DateTime]::Now.AddSeconds(40)
$stream = $p.StandardOutput.BaseStream
while ([DateTime]::Now -lt $deadline) {
  $read = $stream.Read($buffer, 0, $buffer.Length)
  if ($read -le 0) { break }
  $memory.Write($buffer, 0, $read)
}
if (-not $p.HasExited) { $p.Kill() }
$bytes = $memory.ToArray()
$head = [System.Text.Encoding]::ASCII.GetString($bytes, 0, [math]::Min(40, $bytes.Length))
Check 'capture: the HEADER line comes first' ($head.StartsWith('HEADER ')) $head
$jpegs = 0
for ($i = 0; $i -lt $bytes.Length - 2; $i++) { if ($bytes[$i] -eq 255 -and $bytes[$i + 1] -eq 216 -and $bytes[$i + 2] -eq 255) { $jpegs++ } }
Check 'capture: three JPEG frames' ($jpegs -ge 3) ('found ' + $jpegs + ' in ' + $bytes.Length + ' bytes; ' + $head)
# D-493: Notepad draws itself for PrintWindow, so the screen copy must NOT be used for it (and never be said)
$whole = [System.Text.Encoding]::ASCII.GetString($bytes)
Check 'capture: a window that draws itself is not copied from the screen' (-not $whole.Contains('SCREEN_COPY')) 'SCREEN_COPY was said for Notepad'

# input.ps1: it compiles, and a typed text gets a route
$text = Helper 'input.ps1' @('-SelfTest')
Check 'input SelfTest: compiles' ($text -eq 'OK') $text
$b64 = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes('hello from the board'))
$text = ('T ' + $b64) | & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $m 'input.ps1') -ProcessName notepad -TitleLike Notepad 2>&1 | Out-String
Check 'input: a route is chosen for the window' ($text -match 'ROUTE (background|focus)') $text.Trim()

Start-Sleep -Seconds 1
try { Stop-Process -Id $notepad.Id -Force } catch { }
Say ''
if ($script:bad -eq 0) { Say 'all ok' } else { Say ('NOT OK: ' + $script:bad + ' failed') }
Say ('(the same lines are in ' + $log + ')')
