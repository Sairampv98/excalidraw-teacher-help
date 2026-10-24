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
# WHY an adapter with NO current mode is still reported (D-146): a virtual
# display driver can be INSTALLED and its monitor DETACHED - VDD Control keeps
# a monitor detached until the teacher sets its mode to Extend, and until then
# the monitor is not part of the desktop's coordinate space, so no window can
# be placed on it. Skipping that adapter made the tool say "there is no virtual
# display" to a teacher who had already installed one. The rule: **a driver
# that is installed but not attached is still a fact, and the fact names the
# click.** So a VIRTUAL adapter with no mode is reported as a detached virtual
# display, with the reason that says what to do. An adapter with no mode that
# is NOT virtual (the other outputs of the same GPU) is not a display at all,
# and it is still not reported.
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
# WHY the placement is MEASURED and not believed (D-147): SetWindowPos returns
# TRUE on a MAXIMISED window and the window does not move - Windows puts it
# back to the work area of the display it was on. A tool that believes the
# return value tells the teacher their window is on the projector when it is
# not. So a maximised window is un-maximised first (by the style route, which
# never activates anything), the rect is READ BACK afterwards, and the answer
# is the measured one. The rule: **a move that did not happen is never
# reported as one.**
#
# WHY a window can come BACK (D-149): the feature is not a one-way door. The
# same helper puts a window back on the primary display, and -Maximise puts
# the window back into the maximised state it was in before it moved.
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
  [int]$Height = 0,
  [switch]$Maximise
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
  /// the focus, so the teacher's keystrokes stay in their editor (D-147).
  public const uint SWP_NOACTIVATE = 16;
  public const uint SWP_NOZORDER = 4;
  public const uint SWP_SHOWWINDOW = 64;
  /// SWP_FRAMECHANGED (32): the frame is recalculated after the style changed.
  public const uint SWP_FRAMECHANGED = 32;

  /// ShowWindow: SW_MAXIMIZE (3) and SW_RESTORE (9).
  ///
  /// SW_MAXIMIZE does NOT activate the window, so the focus stays where the
  /// teacher left it. SW_RESTORE DOES activate a window that was MINIMISED -
  /// so it is never used on a minimised window (D-147).
  public const int SW_MAXIMIZE = 3;
  public const int SW_RESTORE = 9;

  /// The window styles and the window long index.
  ///
  /// WS_MAXIMIZE is the bit that says "this window is maximised". It is read
  /// and cleared by the STYLE route, which never activates anything.
  public const int WS_MAXIMIZE = 0x01000000;
  public const int GWL_STYLE = -16;

  /// The adapter's own flags: is it on the desktop, and is it the primary one?
  public const int DISPLAY_DEVICE_ATTACHED_TO_DESKTOP = 0x1;
  public const int DISPLAY_DEVICE_PRIMARY_DEVICE = 0x4;

  [DllImport("user32.dll", EntryPoint = "GetWindowLongW")]
  static extern int GetWindowLong(IntPtr hwnd, int index);

  [DllImport("user32.dll", EntryPoint = "SetWindowLongW")]
  static extern int SetWindowLong(IntPtr hwnd, int index, int value);

  [DllImport("user32.dll")]
  static extern bool ShowWindow(IntPtr hwnd, int command);

  /// How far the measured rect may be from the requested one, in pixels.
  public const int PLACE_TOLERANCE = 2;

  /// What a placement DID - measured, never believed (D-147).
  ///
  /// SetWindowPos returns TRUE on a MAXIMISED window and the window does not
  /// move: Windows puts it back to the work area of the display it was on. So
  /// the return value is not the answer - the rect is READ BACK afterwards and
  /// the answer is the measured one.
  public class Placement {
    /// is the window where it was asked to be?
    public bool Placed;
    /// did the move call itself succeed?
    public bool Moved;
    /// was the window maximised BEFORE the move?
    public bool WasMaximised;
    /// was the window un-maximised to make the move possible?
    public bool Restored;
    /// is the window maximised now?
    public bool Maximised;
    /// was the window minimised, and therefore left alone?
    public bool Minimised;
    /// the MEASURED rect
    public int X, Y, Width, Height;
    /// why it did not land, when it did not
    public string Reason = "";
  }

  /// The window's rect, READ BACK.
  public static RECT RectOf(IntPtr hwnd) {
    RECT rect;
    if (!GetWindowRect(hwnd, out rect)) rect = new RECT();
    return rect;
  }

  /// Is the window MAXIMISED?
  public static bool IsMaximised(IntPtr hwnd) {
    return (GetWindowLong(hwnd, GWL_STYLE) & WS_MAXIMIZE) != 0;
  }

  /// Un-maximise a window WITHOUT taking the focus.
  ///
  /// SW_RESTORE puts the window back into the size and place it had before it
  /// was maximised - and it is the route that WORKS: clearing the style bit
  /// alone leaves the window on its old rectangle, and the move that follows
  /// is then undone by the window itself.
  ///
  /// SW_RESTORE activates a window that was MINIMISED, so it is never called
  /// on one: the caller has already left a minimised window alone (D-147).
  public static bool UnMaximise(IntPtr hwnd) {
    if (!IsMaximised(hwnd)) return false;
    ShowWindow(hwnd, SW_RESTORE);
    return !IsMaximised(hwnd);
  }

  /// Put a window on a rectangle, and MEASURE what happened.
  ///
  /// The rule (D-147): **a move that did not happen is never reported as one.**
  /// So the window is read back and the measured rect is the answer.
  public static Placement Place(IntPtr hwnd, int x, int y, int width, int height, bool maximise) {
    Placement result = new Placement();

    if (!IsWindow(hwnd)) {
      result.Reason = "the window is not there any more";
      return result;
    }

    if (IsIconic(hwnd)) {
      // A MINIMISED window is left alone: restoring it would ACTIVATE it and
      // take the teacher's keystrokes away (D-147).
      result.Minimised = true;
      RECT here = RectOf(hwnd);
      result.X = here.Left;
      result.Y = here.Top;
      result.Width = here.Right - here.Left;
      result.Height = here.Bottom - here.Top;
      result.Reason = "the window is minimised, so it was left where it was - restore it and try again";
      return result;
    }

    result.WasMaximised = IsMaximised(hwnd);
    uint flags = SWP_NOACTIVATE | SWP_NOZORDER | SWP_SHOWWINDOW;

    if (result.WasMaximised) {
      // A maximised window does not move: Windows re-maximises it to the work
      // area of the display it is on. So it is un-maximised FIRST - without
      // taking the focus.
      if (UnMaximise(hwnd)) {
        result.Restored = true;
        flags |= SWP_FRAMECHANGED;
      }
    }

    result.Moved = SetWindowPos(hwnd, IntPtr.Zero, x, y, width, height, flags);

    if (maximise) {
      // SW_MAXIMIZE does not activate the window, so the focus stays where
      // the teacher left it, and the window maximises on the display it is
      // now on.
      ShowWindow(hwnd, SW_MAXIMIZE);
      result.Maximised = IsMaximised(hwnd);
    }

    RECT rect = RectOf(hwnd);
    result.X = rect.Left;
    result.Y = rect.Top;
    result.Width = rect.Right - rect.Left;
    result.Height = rect.Bottom - rect.Top;

    if (maximise) {
      // A maximised window fills the WORK AREA of its display, so its rect is
      // not the one that was asked for: what matters is that it is maximised
      // and that it is ON the display that was asked for.
      result.Placed = result.Moved && result.Maximised && Inside(result, x, y, width, height);
    }
    else {
      result.Placed = result.Moved && Near(result.X, x) && Near(result.Y, y) &&
                      Near(result.Width, width) && Near(result.Height, height);
    }

    if (!result.Placed) {
      result.Reason = string.Format(
        "the window stayed where it was ({0}x{1} at {2},{3}) instead of {4}x{5} at {6},{7}",
        result.Width, result.Height, result.X, result.Y, width, height, x, y);
    }

    return result;
  }

  /// Is the measured rect close enough to the wanted one?
  static bool Near(int measured, int wanted) {
    return Math.Abs(measured - wanted) <= PLACE_TOLERANCE;
  }

  /// Is the measured window's middle inside the rectangle that was asked for?
  static bool Inside(Placement placement, int x, int y, int width, int height) {
    int middleX = placement.X + placement.Width / 2;
    int middleY = placement.Y + placement.Height / 2;
    return middleX >= x - PLACE_TOLERANCE && middleX <= x + width + PLACE_TOLERANCE &&
           middleY >= y - PLACE_TOLERANCE && middleY <= y + height + PLACE_TOLERANCE;
  }
}
'@
Add-Type -TypeDefinition $code

function Write-Json($value) {
  # one json object per line, so the reader never has to guess where a
  # record ends - and nothing else is ever written to stdout
  Write-Output (ConvertTo-Json -InputObject $value -Compress -Depth 4)
}

function Test-VirtualText($text) {
  # The rule that tells a VIRTUAL display from a real one - the same rule the
  # extension applies to what this helper reports: an indirect display driver
  # says so in its own name ("Virtual Display Driver"), in its id, or in its
  # key in the registry.
  if (-not $text) { return $false }
  return ($text -match '(?i)virtual|indirect|\bidd\b')
}

try {
  if ($Mode -eq 'Enumerate') {
    # every display adapter, and the display device that is attached to it
    foreach ($adapter in [VdCap]::Adapters()) {
      # is this adapter a VIRTUAL display? an indirect display driver says so
      # in its own name, its id or its registry key
      $virtual = (Test-VirtualText $adapter.DeviceString) -or
                 (Test-VirtualText $adapter.DeviceID) -or
                 (Test-VirtualText $adapter.DeviceKey) -or
                 (($adapter.StateFlags -band 16) -ne 0)

      $screen = [VdCap]::CurrentMode($adapter.DeviceName)
      $detached = ($null -eq $screen)

      if ($detached -and -not $virtual) {
        # no mode, and not a virtual display: this output has nothing
        # attached to it at all. It is not a screen, so it is not reported
        # as one.
        continue
      }

      $name = ''
      $deviceId = ''
      $deviceKey = ''
      $deviceFlags = 0

      foreach ($display in [VdCap]::DisplayDevices($adapter.DeviceName)) {
        $name = $display.DeviceString
        $deviceId = $display.DeviceID
        $deviceKey = $display.DeviceKey
        $deviceFlags = $display.StateFlags
        break
      }

      # The ADAPTER's own flags are the OS's word for "this display is on the
      # desktop" and "this display is the primary one". The monitor's flags
      # are the monitor's own business - a virtual display's monitor claims to
      # be primary too, and it is not.
      $attached = (($adapter.StateFlags -band 1) -ne 0)
      $primary = (($adapter.StateFlags -band 4) -ne 0)

      if ($detached) {
        # a VIRTUAL display whose monitor is NOT attached to the desktop:
        # there is no mode, so it has no size and no place, and no window
        # can be placed on it yet. It is reported anyway (D-146) - the driver
        # is installed, that is a fact, and the fact names the click.
        $width = 0
        $height = 0
        $x = 0
        $y = 0
        $attached = $false
        $primary = $false
        $reason = 'the virtual display is installed but its monitor is DETACHED - open VDD Control and set the monitor to Extend, and it joins the desktop'
      }
      else {
        $width = $screen.Width
        $height = $screen.Height
        $x = $screen.X
        $y = $screen.Y
        $reason = ''
      }

      Write-Json ([ordered]@{
        device      = $adapter.DeviceName
        name        = $name
        adapter     = $adapter.DeviceString
        adapterId   = $adapter.DeviceID
        adapterKey  = $adapter.DeviceKey
        deviceId    = $deviceId
        deviceKey   = $deviceKey
        width       = $width
        height      = $height
        x           = $x
        y           = $y
        attached    = $attached
        primary     = $primary
        virtual     = $virtual
        detached    = $detached
        reason      = $reason
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
    $result = [VdCap]::Place([IntPtr]::new($Handle), $X, $Y, $Width, $Height, [bool]$Maximise)

    # The MEASURED rect, and the truth about the move: a move that did not
    # happen is never reported as one (D-147).
    Write-Json ([ordered]@{
      placed      = $result.Placed
      moved       = $result.Moved
      wasMaximised = $result.WasMaximised
      restored    = $result.Restored
      maximised   = $result.Maximised
      minimised   = $result.Minimised
      handle      = $Handle
      measuredX   = $result.X
      measuredY   = $result.Y
      measuredWidth  = $result.Width
      measuredHeight = $result.Height
      reason      = $result.Reason
    })
  }
}
catch {
  # a failure is a MESSAGE, not a silence: the panel has to be able to say
  # why there is no virtual display (D-75)
  Write-Json ([ordered]@{ error = $_.Exception.Message })
  exit 1
}
