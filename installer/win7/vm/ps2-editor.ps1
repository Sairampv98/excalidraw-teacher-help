# D-481, D-493: the helpers against the REAL editor on Windows 7: VSCodium 1.70 is installed for the user, opened, and the
# window helper finds its window and the capture helper draws it - by PrintWindow, or, where PrintWindow draws nothing and
# this is Windows 7, by the SCREEN COPY (STATUS SCREEN_COPY). Written for PowerShell 2.0.
# The disc holds this script, the extension's `media` folder and VSCodiumUserSetup-ia32-1.70.2.22230.exe:
#   powershell -ExecutionPolicy Bypass -File ps2-editor.ps1 [-Software]
# The editor's window must be visible and not covered while the capture runs: the script opens it and leaves it in front.
# It checks the free disk first and stops when there is too little, and it starts only a throwaway editor of its own (its own
# --user-data-dir and --extensions-dir): never the owner's editor.
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

# the machine: its Windows and its free disk (a full system drive has stopped these proofs before)
$os = Get-WmiObject Win32_OperatingSystem
Say ('machine: ' + $os.Caption + ' ' + $os.Version + ' ' + $os.OSArchitecture)
$drive = Get-WmiObject Win32_LogicalDisk -Filter ("DeviceID='" + $env:SystemDrive + "'")
$freeGB = [math]::Round($drive.FreeSpace / 1GB, 1)
Say ('free disk on ' + $env:SystemDrive + ': ' + $freeGB + ' GB')
if ($freeGB -lt 2) { Say 'NOT OK: less than 2 GB free, so nothing is installed or started'; exit 2 }
$video = Get-WmiObject Win32_VideoController | ForEach-Object { $_.Name }
Say ('graphics: ' + ($video -join ', '))

$setup = Get-ChildItem $here -Filter 'VSCodiumUserSetup-*.exe' | Select-Object -First 1
$exe = Join-Path $env:LOCALAPPDATA 'Programs\VSCodium\VSCodium.exe'
if (-not (Test-Path $exe)) {
  Say ('installing ' + $setup.Name)
  $install = Start-Process $setup.FullName -ArgumentList '/VERYSILENT /NORESTART /MERGETASKS=!runcode' -PassThru -Wait
}
Check 'VSCodium is installed' (Test-Path $exe) $exe

# a machine with no graphics card (a virtual machine) cannot start the editor's GPU process: -Software says to draw without it
$flags = '--user-data-dir "' + (Join-Path $env:TEMP 'ps2-editor-data') + '" --extensions-dir "' + (Join-Path $env:TEMP 'ps2-editor-ext') + '"'
if ($args -contains '-Software') { $flags = $flags + ' --disable-gpu' }
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

# the stream: a header line, then chunks of four length bytes and the bytes - a JPEG starts with 0xFF, a status is text
$firstLine = 0
while ($firstLine -lt $bytes.Length -and $bytes[$firstLine] -ne 10) { $firstLine++ }
$at = $firstLine + 1
$jpegs = @()
$statuses = @()
while ($at + 4 -le $bytes.Length) {
  $length = [BitConverter]::ToUInt32($bytes, $at)
  if ($length -le 0 -or $at + 4 + $length -gt $bytes.Length) { break }
  $chunk = New-Object byte[] $length
  [Array]::Copy($bytes, $at + 4, $chunk, 0, $length)
  if ($chunk[0] -eq 255) { $jpegs += , $chunk } else { $statuses += [System.Text.Encoding]::ASCII.GetString($chunk) }
  $at += 4 + $length
}
Say ('capture said: ' + ($statuses -join ' | '))
Check 'capture: the real editor window is drawn as JPEG frames' ($jpegs.Count -ge 3) ('found ' + $jpegs.Count + ' in ' + $bytes.Length + ' bytes; ' + $head + ' ' + ($statuses -join ' | '))

# the picture is a real one and not a black rectangle: the mean brightness of the last frame (D-493)
if ($jpegs.Count -gt 0) {
  Add-Type -AssemblyName System.Drawing
  $last = $jpegs[$jpegs.Count - 1]
  $picture = New-Object System.Drawing.Bitmap (New-Object System.IO.MemoryStream (, $last))
  $sum = 0; $count = 0
  $stepX = [Math]::Max(1, [int]($picture.Width / 16)); $stepY = [Math]::Max(1, [int]($picture.Height / 16))
  for ($x = 0; $x -lt $picture.Width; $x += $stepX) { for ($y = 0; $y -lt $picture.Height; $y += $stepY) { $c = $picture.GetPixel($x, $y); $sum += ($c.R + $c.G + $c.B) / 3; $count++ } }
  $mean = [math]::Round($sum / [math]::Max(1, $count), 1)
  Say ('picture: ' + $picture.Width + ' x ' + $picture.Height + ', mean brightness ' + $mean + ' of 255')
  Check 'capture: the picture is not black' ($mean -gt 6) ('mean ' + $mean)
  $picture.Dispose()
  [System.IO.File]::WriteAllBytes((Join-Path $env:TEMP 'ps2-editor.jpg'), $last)
}
$copied = ($statuses -join ' ') -match 'STATUS SCREEN_COPY(?!_)'
if ($copied) { Say 'how: the SCREEN COPY (PrintWindow drew nothing; SCREEN_COPY was said)' } else { Say 'how: PrintWindow drew the picture (SCREEN_COPY was not said)' }
# the bytes are saved so the picture can be looked at
[System.IO.File]::WriteAllBytes((Join-Path $env:TEMP 'ps2-editor.bin'), $bytes)

try { Stop-Process -Id $editor.Id -Force } catch { }
Say ''
if ($script:bad -eq 0) { Say 'all ok' } else { Say ('NOT OK: ' + $script:bad + ' failed') }
