# The virtual display helper: the displays on this machine, and the window
# that goes on one of them.
#
# The extension spawns this and reads its stdout. Every line is ONE json
# object, so the reader never has to guess where a record ends:
#
#   -Mode Enumerate          one object per display on the machine
#   -Mode Find               one object: the window the RULE finds
#   -Mode Place              one object: what the placement did
#
# WHY a helper and not a library: the extension has NO runtime dependency of
# its own, and PowerShell is on every Windows machine - the same reason the
# capture helper (capture.ps1) is a PowerShell script.
#
# WHY the displays are enumerated and not guessed: the teacher may have NO
# virtual display at all, and the feature has to say so plainly and fall back
# to the desktop (D-145). A silent failure is not an option, and a crash is
# not an option either - so every mode answers with a fact.
#
# WHY the window is found BY RULE (D-112, D-113): the presenter's window is
# NOT remembered by its handle. The handle changes when the browser recreates
# its window, and `MainWindowHandle` is 0 for a hidden or a minimised one.
# The rule is the window's TITLE - the presenter names its own window
# "Excalidraw - Presenter view" - and the lookup does not care whether the
# window is in front: a window on a virtual display is found exactly like a
# window on the desktop.
#
# WHY the placement does not activate the window: SWP_NOACTIVATE. The teacher
# is typing in their editor while the presenter's window moves to the virtual
# display, and a window that grabs the focus while it moves takes their
# keystrokes away. The rule: **the presenter's window may move, and it may
# never take the focus.**
#
# Arguments: -Mode <Enumerate|Find|Place> -TitleLike <substring>
#            -ProcessName <name> -Handle <n> -X -Y -Width -Height
param(
  [ValidateSet('Enumerate', 'Find', 'Place')][string]$Mode = 'Enumerate',
  [string]$TitleLike = '',
  [string]$ProcessName = '',
  [long]$Handle = 0,
  [int]$X = 0,
  [int]$Y = 0,
  [int]$Width = 0,
  [int]$Height = 0
)

$ErrorActionPreference = 'Stop'

$code = @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public class VdCap {
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left, Top, Right, Bottom; }

  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct DISPLAY_DEVICE {
    public int cb;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string DeviceName;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string DeviceString;
    public int StateFlags;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string DeviceID;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string DeviceKey;
  }

  // DEVMODEW, exactly as the SDK declares it: the union after dmFields is
  // spelled out, because a struct that does not match the native one is
  // refused by the OS - and a refused mode means no resolution at all.
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct DEVMODE {
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string dmDeviceName;
    public short dmSpecVersion;
    public short dmDriverVersion;
    public short dmSize;
    public short dmDriverExtra;
    public int dmFields;
    public int dmPositionX;
    public int dmPositionY;
    public int dmDisplayOrientation;
    public int dmDisplayFixedOutput;
    public short dmColor;
    public short dmDuplex;
    public short dmYResolution;
    public short dmTTOption;
    public short dmCollate;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string dmFormName;
    public short dmLogPixels;
    public int dmBitsPerPel;
    public int dmPelsWidth;
    public int dmPelsHeight;
    public int dmDisplayFlags;
    public int dmDisplayFrequency;
    public int dmICMMethod;
    public int dmICMIntent;
    public int dmMediaType;
    public int dmDitherType;
    public int dmReserved1;
    public int dmReserved2;
    public int dmPanningWidth;
    public int dmPanningHeight;
  }

  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  static extern bool EnumDisplayDevices(string lpDevice, uint iDevNum, ref DISPLAY_DEVICE device, uint flags);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  static extern bool EnumDisplaySettings(string deviceName, int modeNum, ref DEVMODE dm);

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
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")]
  static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int x, int y, int cx, int cy, uint flags);

  /// The display devices the OS reports for one adapter.
  public static DISPLAY_DEVICE[] DisplayDevices(string adapter) {
    List<DISPLAY_DEVICE> found = new List<DISPLAY_DEVICE>();
    for (uint i = 0; i < 64; i++) {
      DISPLAY_DEVICE device = new DISPLAY_DEVICE();
      device.cb = Marshal.SizeOf(typeof(DISPLAY_DEVICE));
      if (!EnumDisplayDevices(adapter, i, ref device, 0)) break;
      found.Add(device);
    }
    return found.ToArray();
  }

  /// Every display ADAPTER on the machine.
  ///
  /// It is its own method because the adapter list is enumerated with a NULL
  /// device name, and PowerShell turns a null into an empty string on the way
  /// in - and an empty device name enumerates nothing at all.
  public static DISPLAY_DEVICE[] Adapters() {
    List<DISPLAY_DEVICE> found = new List<DISPLAY_DEVICE>();
    for (uint i = 0; i < 64; i++) {
      DISPLAY_DEVICE device = new DISPLAY_DEVICE();
      device.cb = Marshal.SizeOf(typeof(DISPLAY_DEVICE));
      if (!EnumDisplayDevices(null, i, ref device, 0)) break;
      found.Add(device);
    }
    return found.ToArray();
  }

  /// The mode a display is in RIGHT NOW: its size and where it sits.
  ///
  /// It is returned as a plain object rather than through an `out` parameter,
  /// because PowerShell binds `out` parameters by reference and a struct that
  /// comes back empty is a display with no resolution - which is a silent
  /// failure, and the one thing this helper must never do.
  public class ScreenMode {
    public int Width;
    public int Height;
    public int X;
    public int Y;
  }

  public static ScreenMode CurrentMode(string deviceName) {
    DEVMODE dm = new DEVMODE();
    dm.dmSize = (short)Marshal.SizeOf(typeof(DEVMODE));
    if (!EnumDisplaySettings(deviceName, -1, ref dm)) {
      return null;
    }
    ScreenMode mode = new ScreenMode();
    mode.Width = dm.dmPelsWidth;
    mode.Height = dm.dmPelsHeight;
    mode.X = dm.dmPositionX;
    mode.Y = dm.dmPositionY;
    return mode;
  }

  public class WindowInfo {
    public IntPtr Handle;
    public uint Pid;
    public string Title;
    public string Class;
    public bool Visible;
    public int X, Y, Width, Height;
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
      RECT rect;
      bool hasRect = GetWindowRect(hwnd, out rect);
      found.Add(new WindowInfo {
        Handle = hwnd,
        Pid = pid,
        Title = length > 0 ? text.ToString() : "",
        Class = classLength > 0 ? cls.ToString() : "",
        Visible = IsWindowVisible(hwnd) && !IsIconic(hwnd),
        X = hasRect ? rect.Left : 0,
        Y = hasRect ? rect.Top : 0,
        Width = hasRect ? rect.Right - rect.Left : 0,
        Height = hasRect ? rect.Bottom - rect.Top : 0
      });
      return true;
    }, IntPtr.Zero);
    return found.ToArray();
  }

  /// SWP_NOACTIVATE (16) + SWP_NOZORDER (4) + SWP_SHOWWINDOW (64)
  ///
  /// NOACTIVATE is the important one: the window moves and it does NOT take
  /// the focus, so the teacher's keystrokes stay in their editor.
  public static bool Place(IntPtr hwnd, int x, int y, int width, int height) {
    if (!IsWindow(hwnd)) return false;
    return SetWindowPos(hwnd, IntPtr.Zero, x, y, width, height, 16 | 4 | 64);
  }
}
'@
Add-Type -TypeDefinition $code

function Write-Json($value) {
  # one json object per line, so the reader never has to guess where a
  # record ends - and nothing else is ever written to stdout
  Write-Output (ConvertTo-Json -InputObject $value -Compress -Depth 4)
}

try {
  if ($Mode -eq 'Enumerate') {
    # every display adapter, and the display device that is attached to it
    foreach ($adapter in [VdCap]::Adapters()) {
      $screen = [VdCap]::CurrentMode($adapter.DeviceName)

      if ($null -eq $screen) {
        # no mode: this output has no display attached to it. It is not a
        # screen, so it is not reported as one.
        continue
      }

      $name = ''
      $deviceId = ''
      $deviceKey = ''
      $deviceFlags = 0
      $attached = $false
      $primary = $false

      foreach ($display in [VdCap]::DisplayDevices($adapter.DeviceName)) {
        $name = $display.DeviceString
        $deviceId = $display.DeviceID
        $deviceKey = $display.DeviceKey
        $deviceFlags = $display.StateFlags
        # 1 = ATTACHED_TO_DESKTOP, 2 = PRIMARY_DEVICE
        $attached = (($display.StateFlags -band 1) -ne 0)
        $primary = (($display.StateFlags -band 2) -ne 0)
        break
      }

      Write-Json ([ordered]@{
        device      = $adapter.DeviceName
        name        = $name
        adapter     = $adapter.DeviceString
        adapterId   = $adapter.DeviceID
        adapterKey  = $adapter.DeviceKey
        deviceId    = $deviceId
        deviceKey   = $deviceKey
        width       = $screen.Width
        height      = $screen.Height
        x           = $screen.X
        y           = $screen.Y
        attached    = $attached
        primary     = $primary
        adapterFlags = $adapter.StateFlags
        deviceFlags  = $deviceFlags
      })
    }
  }
  elseif ($Mode -eq 'Find') {
    $owned = @{}
    if ($ProcessName) {
      Get-Process -Name $ProcessName -ErrorAction SilentlyContinue | ForEach-Object {
        $owned[[uint32]$_.Id] = $true
      }
    }

    $matches = @()
    foreach ($candidate in [VdCap]::TopLevelWindows()) {
      if ($ProcessName -and -not $owned.ContainsKey($candidate.Pid)) { continue }
      if ($candidate.Class -eq 'ConsoleWindowClass') { continue }
      if (-not $candidate.Title) { continue }
      if ($TitleLike -and ($candidate.Title.IndexOf($TitleLike, [System.StringComparison]::OrdinalIgnoreCase) -lt 0)) { continue }
      $matches += $candidate
    }

    if ($matches.Count -eq 0) {
      Write-Json ([ordered]@{ found = $false; reason = 'NO_WINDOW' })
    }
    else {
      # the first one that is ON SCREEN wins; a window that is there but
      # hidden is a different, stated fact (D-113)
      $onScreen = @($matches | Where-Object { $_.Visible })
      $chosen = if ($onScreen.Count -gt 0) { $onScreen[0] } else { $matches[0] }
      Write-Json ([ordered]@{
        found   = $true
        visible = ($onScreen.Count -gt 0)
        handle  = $chosen.Handle.ToInt64()
        title   = $chosen.Title
        pid     = $chosen.Pid
        x       = $chosen.X
        y       = $chosen.Y
        width   = $chosen.Width
        height  = $chosen.Height
      })
    }
  }
  elseif ($Mode -eq 'Place') {
    $placed = [VdCap]::Place([IntPtr]::new($Handle), $X, $Y, $Width, $Height)
    Write-Json ([ordered]@{
      placed = $placed
      handle = $Handle
      x      = $X
      y      = $Y
      width  = $Width
      height = $Height
    })
  }
}
catch {
  # a failure is a MESSAGE, not a silence: the panel has to be able to say
  # why there is no virtual display (D-75)
  Write-Json ([ordered]@{ error = $_.Exception.Message })
  exit 1
}
