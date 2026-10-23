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
# WHY the window is found BY RULE, and re-resolved (D-112, D-113):
#
#   The window is NOT remembered by its handle. `Get-Process`'s
#   `MainWindowHandle` is 0 for a hidden or a minimised window, and the handle
#   CHANGES when the editor recreates its window - a "Reload Window" does
#   exactly that. A helper that holds ONE handle therefore ends up holding a
#   DEAD one, and `PrintWindow` on a dead handle is a BLACK PICTURE - which
#   the panel then shows as a black rectangle, for the rest of the session.
#
#   So the helper keeps the RULE (the editor's process, the window's title)
#   and re-resolves the HANDLE whenever the window is not usable, or the
#   picture comes back empty. It does NOT exit when there is no window: it
#   waits, and it says what is wrong. "Not in front" and "not there" are
#   different facts, and neither of them is "broken".
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
using System.Collections.Generic;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Text;

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

  // --- the window's own top-level windows (D-113) ---
  //
  // `MainWindowHandle` cannot be used to FIND the window: it is 0 for a
  // hidden or a minimised window, so the lookup loses the editor the moment
  // the browser takes the focus. The windows are therefore ENUMERATED, and
  // the title rule decides which one is the editor's.
  public delegate bool EnumProc(IntPtr hwnd, IntPtr lParam);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc proc, IntPtr lParam);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  static extern int GetWindowTextW(IntPtr h, StringBuilder text, int max);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  static extern int GetClassNameW(IntPtr h, StringBuilder text, int max);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsWindow(IntPtr h);

  /// One top-level window: its handle, the process that owns it, its title.
  public class WindowInfo {
    public IntPtr Handle;
    public uint Pid;
    public string Title;
    public string Class;
  }

  /// EVERY top-level window on the machine, with its owner and its title.
  public static WindowInfo[] TopLevelWindows() {
    List<WindowInfo> found = new List<WindowInfo>();
    EnumWindows(delegate(IntPtr hwnd, IntPtr lParam) {
      uint pid;
      GetWindowThreadProcessId(hwnd, out pid);
      StringBuilder text = new StringBuilder(1024);
      int length = GetWindowTextW(hwnd, text, text.Capacity);
      StringBuilder cls = new StringBuilder(256);
      int classLength = GetClassNameW(hwnd, cls, cls.Capacity);
      found.Add(new WindowInfo {
        Handle = hwnd,
        Pid = pid,
        Title = length > 0 ? text.ToString() : "",
        Class = classLength > 0 ? cls.ToString() : ""
      });
      return true;
    }, IntPtr.Zero);
    return found.ToArray();
  }

  /// Is the window still a window? A window that was recreated leaves a DEAD
  /// handle behind, and `PrintWindow` on a dead handle is a black picture.
  public static bool Alive(IntPtr hwnd) { return IsWindow(hwnd); }

  /// Is the window on screen? A hidden window is not visible, and a
  /// minimised one is not either - and neither of them is "there".
  public static bool OnScreen(IntPtr hwnd) {
    return IsWindowVisible(hwnd) && !IsIconic(hwnd);
  }
}
'@
Add-Type -TypeDefinition $code -ReferencedAssemblies 'System.Drawing'

# The editor's OWN window, found BY RULE (D-113).
#
# The rule is the one the project already uses elsewhere: the process the
# extension named, and the workspace folder's name in the window's title. The
# title carries a dirty marker in front of it, so it is matched as a
# SUBSTRING and not exactly.
#
# The answer is a fact, and it has three parts:
#   - Found:    there is a window of that process, and it is the editor's;
#   - Visible:  it is ON SCREEN (not hidden, not minimised);
#   - Handle:   the handle to draw.
function Find-EditorWindow {
  $owned = @{}
  Get-Process -Name $ProcessName -ErrorAction SilentlyContinue | ForEach-Object {
    $owned[[uint32]$_.Id] = $true
  }

  $windows = @()
  foreach ($candidate in [PwCap]::TopLevelWindows()) {
    if ($owned.ContainsKey($candidate.Pid)) { $windows += $candidate }
  }

  # A console window is not the editor's window. The editor's own process owns
  # one, and it is never on screen - so without this the fall-back below would
  # pick it and say "not visible" while the editor's window is right there.
  $windows = @($windows | Where-Object { $_.Class -ne 'ConsoleWindowClass' })

  if ($windows.Count -eq 0) {
    return @{ Found = $false; Visible = $false; Handle = [IntPtr]::Zero }
  }

  $titled = @()
  if ($TitleLike) {
    $titled = @($windows | Where-Object {
      $_.Title -and
      ($_.Title.IndexOf($TitleLike, [System.StringComparison]::OrdinalIgnoreCase) -ge 0)
    })
  }

  if ($titled.Count -eq 0) {
    # no title matched: the process's own windows are the fall-back
    $titled = $windows
  }

  $onScreen = @($titled | Where-Object { [PwCap]::OnScreen($_.Handle) })
  if ($onScreen.Count -gt 0) {
    return @{ Found = $true; Visible = $true; Handle = $onScreen[0].Handle }
  }

  # the window is THERE, but it is not on screen. That is a different, stated
  # fact from "there is no window" - and it is not a broken capture.
  return @{ Found = $true; Visible = $false; Handle = $titled[0].Handle }
}

# Is the picture EMPTY?
#
# A window that is not on screen (or a handle that has died) gives back a
# picture that is essentially black. A black rectangle is NOT a live view, so
# such a picture is never published - the helper says what is wrong instead.
# The cost is 64 samples of the picture, against a frame that costs about
# 12 ms to draw.
function Test-Empty([System.Drawing.Bitmap]$bitmap) {
  $sum = 0
  $count = 0
  $stepX = [Math]::Max(1, [int]($bitmap.Width / 8))
  $stepY = [Math]::Max(1, [int]($bitmap.Height / 8))

  for ($x = 0; $x -lt $bitmap.Width; $x += $stepX) {
    for ($y = 0; $y -lt $bitmap.Height; $y += $stepY) {
      $pixel = $bitmap.GetPixel($x, $y)
      $sum += ($pixel.R + $pixel.G + $pixel.B)
      $count += 1
    }
  }

  if ($count -eq 0) { return $true }

  # the average of the three channels, below 2, is black
  return (($sum / $count) -lt 6)
}

if ($Scale -le 0) { $Scale = 1.0 }

# 24 bits per pixel: the JPEG encoder has no alpha channel, and a 32bpp
# bitmap makes GDI+ fail with a generic error.
$format = [System.Drawing.Imaging.PixelFormat]::Format24bppRgb

# the JPEG encoder, and the quality it is asked for
$codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() |
  Where-Object { $_.MimeType -eq 'image/jpeg' } |
  Select-Object -First 1
if (-not $codec) { Write-Output 'NO_JPEG_CODEC'; exit 4 }

$params = New-Object System.Drawing.Imaging.EncoderParameters(1)
$params.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter(
  [System.Drawing.Imaging.Encoder]::Quality, [long]$Quality)

$stream = [Console]::OpenStandardOutput()
$delay = [int](1000 / $Fps)
if ($delay -lt 1) { $delay = 1 }

# the JPEG's bytes, on their way out
$mem = New-Object System.IO.MemoryStream

# The state the helper is in, and the window it is looking at.
#
# '' means "there is a picture", and nothing is said about it: the frames
# themselves are the news. Every other value is a fact the panel has to be
# able to SAY (D-75), and it is said when it CHANGES.
$state = ''
$hwnd = [IntPtr]::Zero
$w = 0
$h = 0
$outW = 0
$outH = 0
$bmp = $null
$scaled = $null
$headerWritten = $false
$nextResolveAt = [DateTime]::MinValue

# A STATUS travels as a TEXT line before the header has been written (the
# reader is still reading lines then), and as a CHUNK after it (the reader is
# reading frames then). A JPEG never begins with the text "STATUS ", so the
# reader can tell the two apart.
function Write-Status([string]$code) {
  $text = 'STATUS ' + $code

  if ($headerWritten) {
    $payload = [System.Text.Encoding]::UTF8.GetBytes($text)
    $stream.Write([BitConverter]::GetBytes([int]$payload.Length), 0, 4)
    $stream.Write($payload, 0, $payload.Length)
    $stream.Flush()
  } else {
    Write-Output $text
    [Console]::Out.Flush()
  }
}

for ($i = 0; ($MaxFrames -le 0) -or ($i -lt $MaxFrames); $i++) {
  $now = [DateTime]::UtcNow

  # --- the window, RE-RESOLVED whenever it is not usable (D-112) ---
  #
  # It is not remembered by its handle: a window that was hidden, minimised or
  # RECREATED (a Reload Window does exactly that) leaves a dead handle behind,
  # and `PrintWindow` on a dead handle is a black picture.
  $onScreen = ($hwnd -ne [IntPtr]::Zero) -and [PwCap]::Alive($hwnd) -and [PwCap]::OnScreen($hwnd)

  if ((-not $onScreen) -and ($now -ge $nextResolveAt)) {
    # the re-resolution is rate-limited: a window that stays empty must not
    # cost an enumeration on every frame
    $nextResolveAt = $now.AddMilliseconds(500)

    $found = Find-EditorWindow

    if (-not $found.Found) {
      # there is NO window: a fact about this moment, and the helper WAITS
      $hwnd = [IntPtr]::Zero
      $newState = 'NO_WINDOW'
    } elseif (-not $found.Visible) {
      # the window is THERE, but it is not on screen: a different fact (D-113)
      $hwnd = [IntPtr]::Zero
      $newState = 'WINDOW_NOT_VISIBLE'
    } else {
      $hwnd = $found.Handle
      $rect = [PwCap]::ClientRect($hwnd)
      $w = $rect[2]
      $h = $rect[3]

      if ($w -le 0 -or $h -le 0) {
        # the window has no size yet - it is being created
        $hwnd = [IntPtr]::Zero
        $newState = 'BAD_RECT'
      } else {
        $outW = [int][Math]::Round($w * $Scale)
        $outH = [int][Math]::Round($h * $Scale)
        if ($outW -lt 1) { $outW = 1 }
        if ($outH -lt 1) { $outH = 1 }

        # the bitmaps follow the window's size
        if ($bmp) { $bmp.Dispose(); $bmp = $null }
        if ($scaled) { $scaled.Dispose(); $scaled = $null }
        $bmp = New-Object System.Drawing.Bitmap($w, $h, $format)
        $scaled = New-Object System.Drawing.Bitmap($outW, $outH, $format)

        # a header line, so the reader can learn the size before the frames.
        # It carries the SCALED size: the size of the picture that is written.
        if (-not $headerWritten) {
          Write-Output ('HEADER ' + $outW + ' ' + $outH)
          [Console]::Out.Flush()
          $headerWritten = $true
        } else {
          # the window was RECREATED and it is another size: the reader is
          # told again, in the same shape it already knows
          $payload = [System.Text.Encoding]::UTF8.GetBytes('HEADER ' + $outW + ' ' + $outH)
          $stream.Write([BitConverter]::GetBytes([int]$payload.Length), 0, 4)
          $stream.Write($payload, 0, $payload.Length)
          $stream.Flush()
        }

        $newState = ''
      }
    }

    if ($newState -ne $state) {
      $state = $newState
      if ($state) { Write-Status $state }
    }
  }

  if ($hwnd -eq [IntPtr]::Zero) {
    # there is nothing to draw, and the state has already been said
    Start-Sleep -Milliseconds $delay
    continue
  }

  # --- the capture ---
  $mem.SetLength(0)

  if (-not [PwCap]::Shot($hwnd, $bmp)) {
    # the handle is DEAD: the window was recreated. The window is re-resolved.
    $hwnd = [IntPtr]::Zero
    if ($state -ne 'SHOT_FAILED') {
      $state = 'SHOT_FAILED'
      Write-Status $state
    }
    Start-Sleep -Milliseconds $delay
    continue
  }

  if (Test-Empty $bmp) {
    # an EMPTY picture is not a picture: a black rectangle is not a live view
    $hwnd = [IntPtr]::Zero
    if ($state -ne 'NO_PICTURE') {
      $state = 'NO_PICTURE'
      Write-Status $state
    }
    Start-Sleep -Milliseconds $delay
    continue
  }

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

  # there is a picture: the state is nothing to say, and the frames are the
  # news
  if ($state -ne '') {
    $state = ''
  }

  Start-Sleep -Milliseconds $delay
}

$stream.Flush()
$stream.Close()
Write-Output ('DONE ' + $MaxFrames)
