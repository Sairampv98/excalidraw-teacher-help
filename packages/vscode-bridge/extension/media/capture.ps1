# The capture helper: the editor's OWN window, as a stream of PNG frames.
#
# The extension spawns this ONCE and reads the frames off its stdout. The
# helper writes:
#
#   - ONE header line first: `HEADER <width> <height>`, so the reader learns
#     the frame's size before the frames arrive;
#   - then, for every frame, the PNG's bytes prefixed with their length as
#     four little-endian bytes.
#
# WHY PrintWindow and not a screen capture:
#
#   - A screen capture shows only what is VISIBLE, so an editor that is behind
#     the browser shows the browser.
#   - `ffmpeg`'s gdigrab cannot draw an Electron window at all: VS Code and
#     VSCodium render through DirectComposition, and gdigrab's window mode
#     BitBlts from the window's own device context, which does not hold the
#     GPU-composited surface - the result is a BLACK rectangle.
#   - `PrintWindow` with PW_RENDERFULLCONTENT (2) asks the window to render
#     ITSELF into a device context. It understands DirectComposition, and it
#     draws the editor even when something is on top of it.
#
# Arguments: -ProcessName <name> -TitleLike <substring> -Fps <n> -MaxFrames <n>
#   -MaxFrames 0 means "until the extension kills the helper".
param(
  [string]$ProcessName = 'Code',
  [string]$TitleLike = '',
  [int]$Fps = 6,
  [int]$MaxFrames = 0
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$code = @'
using System;
using System.Drawing;
using System.Runtime.InteropServices;

public class PwCap {
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint flags);
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left, Top, Right, Bottom; }
  public static int[] Rect(IntPtr hwnd) {
    RECT r;
    if (!GetWindowRect(hwnd, out r)) return new int[] {0,0,0,0};
    return new int[] { r.Left, r.Top, r.Right - r.Left, r.Bottom - r.Top };
  }
  public static bool Shot(IntPtr hwnd, Bitmap bmp) {
    using (Graphics g = Graphics.FromImage(bmp)) {
      IntPtr hdc = g.GetHdc();
      try { return PrintWindow(hwnd, hdc, 2); } finally { g.ReleaseHdc(hdc); }
    }
  }
}
'@
Add-Type -TypeDefinition $code -ReferencedAssemblies 'System.Drawing'

# The editor's OWN window: the process named by the extension, and the one
# whose title holds the workspace folder's name. The title carries a dirty
# marker in front of it, so it is matched as a SUBSTRING and not exactly.
$procs = Get-Process -Name $ProcessName -ErrorAction SilentlyContinue |
  Where-Object { $_.MainWindowHandle -ne 0 }

$proc = $null
if ($TitleLike) {
  $proc = $procs |
    Where-Object { $_.MainWindowTitle -like ('*' + $TitleLike + '*') } |
    Select-Object -First 1
}

if (-not $proc) {
  # no title matched: the process's first main window is the fallback
  $proc = $procs | Select-Object -First 1
}

if (-not $proc) {
  Write-Output ('NO_WINDOW ' + $ProcessName)
  exit 2
}

$hwnd = [IntPtr]$proc.MainWindowHandle
$g = [PwCap]::Rect($hwnd)
$w = $g[2]; $h = $g[3]
if ($w -le 0 -or $h -le 0) { Write-Output 'BAD_RECT'; exit 3 }

# a header line, so the reader can learn the size before the frames
Write-Output ('HEADER ' + $w + ' ' + $h)
[Console]::Out.Flush()

$stream = [Console]::OpenStandardOutput()
$delay = [int](1000 / $Fps)
if ($delay -lt 1) { $delay = 1 }

$bmp = New-Object System.Drawing.Bitmap($w, $h)
$mem = New-Object System.IO.MemoryStream

for ($i = 0; ($MaxFrames -le 0) -or ($i -lt $MaxFrames); $i++) {
  $mem.SetLength(0)
  if (-not [PwCap]::Shot($hwnd, $bmp)) { Write-Output 'SHOT_FAILED'; break }
  $bmp.Save($mem, [System.Drawing.Imaging.ImageFormat]::Png)
  $bytes = $mem.ToArray()
  $stream.Write([BitConverter]::GetBytes([int]$bytes.Length), 0, 4)
  $stream.Write($bytes, 0, $bytes.Length)
  $stream.Flush()
  Start-Sleep -Milliseconds $delay
}

$stream.Flush()
$stream.Close()
Write-Output ('DONE ' + $MaxFrames)
