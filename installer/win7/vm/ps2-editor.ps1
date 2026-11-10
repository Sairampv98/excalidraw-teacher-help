# D-481: the helpers against the REAL editor on Windows 7: VSCodium 1.70 is installed for the user, opened, and the
# window helper finds its window and the capture helper draws it. Written for PowerShell 2.0.
# The disc holds this script, the extension's `media` folder and VSCodiumUserSetup-ia32-1.70.2.22230.exe:
#   powershell -ExecutionPolicy Bypass -File ps2-editor.ps1
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$m = Join-Path $here 'media'
$log = Join-Path $env:TEMP 'ps2-editor.txt'
if (Test-Path $log) { Remove-Item $log }
$script:bad = 0
function Say($text) { $text; Add-Content -Path $log -Value $text }
function Check($name, $condition, $detail) {
  if ($condition) { Say ("ok      " + $name) } else { Say ("NOT OK  " + $name + "   " + $detail); $script:bad++ }
}
function Helper($file, $arguments) {
  $out = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $m $file) @arguments 2>&1 | Out-String
  $out.Trim()
}
function Num($text, $name) { if ($text -match ('"' + $name + '":(-?[0-9]+)')) { [long]$matches[1] } else { $null } }

$setup = Get-ChildItem $here -Filter 'VSCodiumUserSetup-*.exe' | Select-Object -First 1
$exe = Join-Path $env:LOCALAPPDATA 'Programs\VSCodium\VSCodium.exe'
if (-not (Test-Path $exe)) {
  Say ('installing ' + $setup.Name)
  $install = Start-Process $setup.FullName -ArgumentList '/VERYSILENT /NORESTART /MERGETASKS=!runcode' -PassThru -Wait
}
Check 'VSCodium is installed' (Test-Path $exe) $exe

# a machine with no graphics card (a virtual machine) cannot start the editor's GPU process: -Software says to draw without it
$flags = ''
if ($args -contains '-Software') { $flags = '--disable-gpu' }
try { Get-Process VSCodium -ErrorAction SilentlyContinue | Stop-Process -Force } catch { }
Start-Sleep -Seconds 3
$editor = Start-Process $exe -ArgumentList $flags -PassThru
Start-Sleep -Seconds 25

$text = Helper 'window.ps1' @('-Mode', 'Find', '-ProcessName', 'VSCodium')
Check 'window Find: the editor window is found' (($text -match '"found":true') -and (Num $text 'width') -gt 0) $text

$info = New-Object System.Diagnostics.ProcessStartInfo
$info.FileName = 'powershell.exe'
$info.Arguments = '-NoProfile -ExecutionPolicy Bypass -File "' + (Join-Path $m 'capture.ps1') + '" -ProcessName VSCodium -Fps 3 -MaxFrames 3'
$info.UseShellExecute = $false
$info.RedirectStandardOutput = $true
$p = [System.Diagnostics.Process]::Start($info)
$null = Start-Process cmd.exe -WindowStyle Hidden -ArgumentList ('/c ping -n 60 127.0.0.1 >nul & taskkill /f /pid ' + $p.Id)
$memory = New-Object System.IO.MemoryStream
$buffer = New-Object byte[] 65536
$stream = $p.StandardOutput.BaseStream
while ($true) {
  $read = $stream.Read($buffer, 0, $buffer.Length)
  if ($read -le 0) { break }
  $memory.Write($buffer, 0, $read)
}
$bytes = $memory.ToArray()
$head = [System.Text.Encoding]::ASCII.GetString($bytes, 0, [math]::Min(60, $bytes.Length))
$jpegs = 0
for ($i = 0; $i -lt $bytes.Length - 2; $i++) { if ($bytes[$i] -eq 255 -and $bytes[$i + 1] -eq 216 -and $bytes[$i + 2] -eq 255) { $jpegs++ } }
Check 'capture: the real editor window is drawn as JPEG frames' ($jpegs -ge 3) ('found ' + $jpegs + ' in ' + $bytes.Length + ' bytes; ' + $head)
# the bytes are saved so the picture can be looked at
[System.IO.File]::WriteAllBytes((Join-Path $env:TEMP 'ps2-editor.bin'), $bytes)

try { Stop-Process -Id $editor.Id -Force } catch { }
Say ''
if ($script:bad -eq 0) { Say 'all ok' } else { Say ('NOT OK: ' + $script:bad + ' failed') }
