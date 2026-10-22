# The capture helper: the editor's OWN window, as a stream of JPEG frames.
#
# The extension spawns this ONCE and reads the frames off its stdout. The
# helper writes:
#
#   - ONE header line first: `HEADER <width> <height>`, so the reader learns
#     the frame's size before the frames arrive. It is the SCALED size,
#     because that is the size of the picture that is written;
#   - then, for every frame, the JPEG's bytes prefixed with their length as
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
#   - `PrintWindow` asks the window to render ITSELF into a device context.
#     It understands DirectComposition, and it draws the editor even when
#     something is on top of it.
#
# WHY the CLIENT area (flags 3 = PW_CLIENTONLY + PW_RENDERFULLCONTENT):
#
#   The window rectangle carries the OS title bar and the borders, and the
#   teacher wants to see the EDITOR. `GetClientRect` gives the client area's
#   size and `ClientToScreen` its origin on the screen, so the picture is the
#   editor and nothing else. Measured on this machine on 2026-10-22 against a
#   live VS Code window: 1282x674 for a 1297x681 window, mean luminance
#   215.899 - the same content the whole-window capture had.
#
# WHY JPEG, and WHY scaled:
#
#   The picture is shown in a panel that is a fraction of the window's size,
#   and it is served as an MJPEG stream, so the bytes on the wire matter.
#   Measured on the same window: PNG 115,884 B (154,512 B base64), JPEG q85
#   116,166 B, q75 93,736 B, q60 73,922 B, q45 63,591 B, and q60 at 0.75
#   scale 45,091 B. The mean luminance stays ~232 at every setting, so the
#   picture is still real content.
#
# Arguments: -ProcessName <name> -TitleLike <substring> -Fps <n> -Quality <n>
#            -Scale <n> -MaxFrames <n>
#   -MaxFrames 0 means "until the extension kills the helper".
param(
  [string]$ProcessName = 'Code',
  [string]$TitleLike = '',
  [int]$Fps = 6,
  [int]$Quality = 60,
  [double]$Scale = 0.75,
  [int]$MaxFrames = 0
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$code = @'
using System;
using System.Drawing;
using System.Runtime.InteropServices;

public class PwCap {
  [DllImport("user32.dll")] static extern bool GetClientRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] static extern bool ClientToScreen(IntPtr h, ref POINT p);
  [DllImport("user32.dll")] static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint flags);
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)]
  public struct POINT { public int X, Y; }

  // The CLIENT rectangle, on the screen: GetClientRect gives the size, and
  // ClientToScreen gives where the client area starts. The window's own
  // rectangle would carry the title bar and the borders.
  public static int[] ClientRect(IntPtr hwnd) {
    RECT r;
    if (!GetClientRect(hwnd, out r)) return new int[] {0,0,0,0};
    POINT origin = new POINT();
    origin.X = 0; origin.Y = 0;
    ClientToScreen(hwnd, ref origin);
    return new int[] { origin.X, origin.Y, r.Right - r.Left, r.Bottom - r.Top };
  }

  // flags 3 = PW_CLIENTONLY (1) + PW_RENDERFULLCONTENT (2): the client area,
  // rendered by the window itself, even when something is on top of it.
  public static bool Shot(IntPtr hwnd, Bitmap bmp) {
    using (Graphics g = Graphics.FromImage(bmp)) {
      IntPtr hdc = g.GetHdc();
      try { return PrintWindow(hwnd, hdc, 3); } finally { g.ReleaseHdc(hdc); }
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

# the CLIENT area, not the window: the title bar and the borders are not the
# editor, and they are not in the picture either
$g = [PwCap]::ClientRect($hwnd)
$w = $g[2]; $h = $g[3]
if ($w -le 0 -or $h -le 0) { Write-Output 'BAD_RECT'; exit 3 }

if ($Scale -le 0) { $Scale = 1.0 }
$outW = [int][Math]::Round($w * $Scale)
$outH = [int][Math]::Round($h * $Scale)
if ($outW -lt 1) { $outW = 1 }
if ($outH -lt 1) { $outH = 1 }

# a header line, so the reader can learn the size before the frames. It
# carries the SCALED size: the size of the picture that is written.
Write-Output ('HEADER ' + $outW + ' ' + $outH)
[Console]::Out.Flush()

$stream = [Console]::OpenStandardOutput()
$delay = [int](1000 / $Fps)
if ($delay -lt 1) { $delay = 1 }

# 24 bits per pixel: the JPEG encoder has no alpha channel, and a 32bpp
# bitmap makes GDI+ fail with a generic error.
$format = [System.Drawing.Imaging.PixelFormat]::Format24bppRgb
$bmp = New-Object System.Drawing.Bitmap($w, $h, $format)
$scaled = New-Object System.Drawing.Bitmap($outW, $outH, $format)
$mem = New-Object System.IO.MemoryStream

# the JPEG encoder, and the quality it is asked for
$codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() |
  Where-Object { $_.MimeType -eq 'image/jpeg' } |
  Select-Object -First 1
if (-not $codec) { Write-Output 'NO_JPEG_CODEC'; exit 4 }

$params = New-Object System.Drawing.Imaging.EncoderParameters(1)
$params.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter(
  [System.Drawing.Imaging.Encoder]::Quality, [long]$Quality)

for ($i = 0; ($MaxFrames -le 0) -or ($i -lt $MaxFrames); $i++) {
  $mem.SetLength(0)
  if (-not [PwCap]::Shot($hwnd, $bmp)) { Write-Output 'SHOT_FAILED'; break }

  # the downscale: a bilinear DrawImage into the smaller bitmap
  $gfx = [System.Drawing.Graphics]::FromImage($scaled)
  try {
    $gfx.InterpolationMode =
      [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBilinear
    $gfx.PixelOffsetMode =
      [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $gfx.DrawImage($bmp, 0, 0, $outW, $outH)
  } finally {
    $gfx.Dispose()
  }

  $scaled.Save($mem, $codec, $params)
  $bytes = $mem.ToArray()
  $stream.Write([BitConverter]::GetBytes([int]$bytes.Length), 0, 4)
  $stream.Write($bytes, 0, $bytes.Length)
  $stream.Flush()
  Start-Sleep -Milliseconds $delay
}

$stream.Flush()
$stream.Close()
Write-Output ('DONE ' + $MaxFrames)
